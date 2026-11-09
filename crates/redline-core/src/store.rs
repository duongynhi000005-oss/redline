//! The local cache: one SQLite database per Redmine server and user.
//!
//! Every screen reads from here, so the UI is instant and works offline. Rows
//! keep Redmine's JSON as it came, which lets older caches survive model
//! changes; the columns beside it are only what queries need.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::{Error, Result};
use crate::models::*;

/// Bump when the schema changes, and add a step to [`migrate`].
const SCHEMA_VERSION: i32 = 1;

/// Everything about the server that changes rarely.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub user: Option<User>,
    pub projects: Vec<Project>,
    pub statuses: Vec<IssueStatus>,
    pub trackers: Vec<Tracker>,
    pub priorities: Vec<IssuePriority>,
    pub versions: Vec<Version>,
    pub memberships: Vec<Membership>,
}

/// A handle to the cache. Cheap to clone; all clones share one connection.
#[derive(Clone)]
pub struct Store {
    conn: Arc<Mutex<Connection>>,
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Store")
    }
}

impl Store {
    /// Opens (or creates) the cache at `path`.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| Error::Storage(e.to_string()))?;
        }
        Self::init(Connection::open(path).map_err(storage)?)
    }

    /// A throwaway cache in memory, for tests.
    pub fn in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory().map_err(storage)?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(storage)?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(storage)?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(storage)?;
        migrate(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        // A panic while holding the lock leaves SQLite consistent (every write
        // is a transaction), so a poisoned lock is safe to reuse.
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ----- Key-value settings and cursors --------------------------------

    pub fn get_value<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let raw: Option<String> = self
            .conn()
            .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .optional()
            .map_err(storage)?;
        raw.map(|s| serde_json::from_str(&s).map_err(|e| Error::Storage(e.to_string())))
            .transpose()
    }

    pub fn set_value<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let json = to_json(value)?;
        self.conn()
            .execute(
                "INSERT INTO kv (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, json],
            )
            .map_err(storage)?;
        Ok(())
    }

    // ----- Metadata ------------------------------------------------------

    /// Replaces all metadata in one transaction.
    pub fn replace_metadata(&self, meta: &Metadata) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction().map_err(storage)?;
        for table in [
            "projects",
            "statuses",
            "trackers",
            "priorities",
            "versions",
            "memberships",
        ] {
            tx.execute(&format!("DELETE FROM {table}"), [])
                .map_err(storage)?;
        }
        for (pos, p) in meta.projects.iter().enumerate() {
            tx.execute(
                "INSERT INTO projects (id, position, json) VALUES (?1, ?2, ?3)",
                params![p.id as i64, pos as i64, to_json(p)?],
            )
            .map_err(storage)?;
        }
        for (table, rows) in [
            ("statuses", ids_json(&meta.statuses, |s| s.id)?),
            ("trackers", ids_json(&meta.trackers, |t| t.id)?),
            ("priorities", ids_json(&meta.priorities, |p| p.id)?),
        ] {
            for (pos, (id, json)) in rows.into_iter().enumerate() {
                tx.execute(
                    &format!("INSERT INTO {table} (id, position, json) VALUES (?1, ?2, ?3)"),
                    params![id as i64, pos as i64, json],
                )
                .map_err(storage)?;
            }
        }
        for v in &meta.versions {
            // Shared versions appear under several projects; keep one row.
            tx.execute(
                "INSERT OR REPLACE INTO versions (id, project_id, json) VALUES (?1, ?2, ?3)",
                params![v.id as i64, v.project.id as i64, to_json(v)?],
            )
            .map_err(storage)?;
        }
        for m in &meta.memberships {
            tx.execute(
                "INSERT OR REPLACE INTO memberships (id, project_id, json) VALUES (?1, ?2, ?3)",
                params![m.id as i64, m.project.id as i64, to_json(m)?],
            )
            .map_err(storage)?;
        }
        if let Some(user) = &meta.user {
            tx.execute(
                "INSERT INTO kv (key, value) VALUES ('user', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [to_json(user)?],
            )
            .map_err(storage)?;
        }
        tx.commit().map_err(storage)
    }

    pub fn metadata(&self) -> Result<Metadata> {
        let conn = self.conn();
        Ok(Metadata {
            user: kv_get(&conn, "user")?,
            projects: rows(&conn, "SELECT json FROM projects ORDER BY position")?,
            statuses: rows(&conn, "SELECT json FROM statuses ORDER BY position")?,
            trackers: rows(&conn, "SELECT json FROM trackers ORDER BY position")?,
            priorities: rows(&conn, "SELECT json FROM priorities ORDER BY position")?,
            versions: rows(&conn, "SELECT json FROM versions ORDER BY id")?,
            memberships: rows(&conn, "SELECT json FROM memberships ORDER BY id")?,
        })
    }

    // ----- Issues --------------------------------------------------------

    /// Inserts or updates issues. Returns the ids that are new or changed
    /// (a different `updated_on` than the cached copy).
    pub fn upsert_issues(&self, issues: &[Issue]) -> Result<Vec<u64>> {
        let mut changed = Vec::new();
        let mut conn = self.conn();
        let tx = conn.transaction().map_err(storage)?;
        for issue in issues {
            let previous: Option<String> = tx
                .query_row(
                    "SELECT updated_on FROM issues WHERE id = ?1",
                    [issue.id as i64],
                    |r| r.get(0),
                )
                .optional()
                .map_err(storage)?;
            if previous.as_deref() == Some(issue.updated_on.as_str()) {
                continue;
            }
            // List responses carry no journals; keep the ones we have.
            let mut stored = issue.clone();
            stored.journals = None;
            stored.allowed_statuses = None;
            tx.execute(
                "INSERT INTO issues (id, project_id, updated_on, json) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id,
                   updated_on = excluded.updated_on, json = excluded.json",
                params![
                    issue.id as i64,
                    issue.project.id as i64,
                    issue.updated_on,
                    to_json(&stored)?
                ],
            )
            .map_err(storage)?;
            changed.push(issue.id);
        }
        tx.commit().map_err(storage)?;
        Ok(changed)
    }

    /// Every cached issue, newest change first.
    pub fn issues(&self) -> Result<Vec<Issue>> {
        rows(
            &self.conn(),
            "SELECT json FROM issues ORDER BY updated_on DESC, id DESC",
        )
    }

    pub fn issue(&self, id: u64) -> Result<Option<Issue>> {
        let conn = self.conn();
        let json: Option<String> = conn
            .query_row("SELECT json FROM issues WHERE id = ?1", [id as i64], |r| {
                r.get(0)
            })
            .optional()
            .map_err(storage)?;
        json.map(|s| from_json(&s)).transpose()
    }

    pub fn issue_ids(&self) -> Result<Vec<u64>> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare("SELECT id FROM issues ORDER BY id")
            .map_err(storage)?;
        let ids = stmt
            .query_map([], |r| r.get::<_, i64>(0).map(|v| v as u64))
            .map_err(storage)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(storage)?;
        Ok(ids)
    }

    pub fn remove_issues(&self, ids: &[u64]) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction().map_err(storage)?;
        for id in ids {
            tx.execute("DELETE FROM issues WHERE id = ?1", [*id as i64])
                .map_err(storage)?;
            tx.execute("DELETE FROM journals WHERE issue_id = ?1", [*id as i64])
                .map_err(storage)?;
        }
        tx.commit().map_err(storage)
    }

    pub fn count_issues(&self) -> Result<u64> {
        self.conn()
            .query_row("SELECT COUNT(*) FROM issues", [], |r| r.get::<_, i64>(0))
            .map(|n| n as u64)
            .map_err(storage)
    }

    // ----- Journals ------------------------------------------------------

    pub fn set_journals(
        &self,
        issue_id: u64,
        updated_on: &str,
        journals: &[Journal],
    ) -> Result<()> {
        self.conn()
            .execute(
                "INSERT INTO journals (issue_id, issue_updated_on, json) VALUES (?1, ?2, ?3)
                 ON CONFLICT(issue_id) DO UPDATE SET issue_updated_on = excluded.issue_updated_on,
                   json = excluded.json",
                params![issue_id as i64, updated_on, to_json(&journals)?],
            )
            .map_err(storage)?;
        Ok(())
    }

    /// Cached journals and the issue `updated_on` they were fetched for.
    pub fn journals(&self, issue_id: u64) -> Result<Option<(String, Vec<Journal>)>> {
        let row: Option<(String, String)> = self
            .conn()
            .query_row(
                "SELECT issue_updated_on, json FROM journals WHERE issue_id = ?1",
                [issue_id as i64],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(storage)?;
        row.map(|(at, json)| Ok((at, from_json(&json)?)))
            .transpose()
    }
}

fn migrate(conn: &Connection) -> Result<()> {
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(storage)?;
    if version > SCHEMA_VERSION {
        return Err(Error::Storage(
            "this cache was written by a newer Redline; it will be rebuilt".into(),
        ));
    }
    if version < 1 {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE projects (id INTEGER PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL);
             CREATE TABLE statuses (id INTEGER PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL);
             CREATE TABLE trackers (id INTEGER PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL);
             CREATE TABLE priorities (id INTEGER PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL);
             CREATE TABLE versions (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, json TEXT NOT NULL);
             CREATE TABLE memberships (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, json TEXT NOT NULL);
             CREATE TABLE issues (
               id INTEGER PRIMARY KEY,
               project_id INTEGER NOT NULL,
               updated_on TEXT NOT NULL,
               json TEXT NOT NULL
             );
             CREATE INDEX issues_by_project ON issues (project_id);
             CREATE INDEX issues_by_update ON issues (updated_on);
             CREATE TABLE journals (
               issue_id INTEGER PRIMARY KEY,
               issue_updated_on TEXT NOT NULL,
               json TEXT NOT NULL
             );
             PRAGMA user_version = 1;
             COMMIT;",
        )
        .map_err(storage)?;
    }
    Ok(())
}

fn storage(e: rusqlite::Error) -> Error {
    Error::Storage(e.to_string())
}

fn to_json<T: Serialize + ?Sized>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|e| Error::Storage(e.to_string()))
}

fn from_json<T: DeserializeOwned>(s: &str) -> Result<T> {
    serde_json::from_str(s).map_err(|e| Error::Storage(e.to_string()))
}

fn ids_json<T: Serialize>(items: &[T], id: impl Fn(&T) -> u64) -> Result<Vec<(u64, String)>> {
    items.iter().map(|i| Ok((id(i), to_json(i)?))).collect()
}

fn rows<T: DeserializeOwned>(conn: &Connection, sql: &str) -> Result<Vec<T>> {
    let mut stmt = conn.prepare(sql).map_err(storage)?;
    let raw = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(storage)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(storage)?;
    raw.iter().map(|s| from_json(s)).collect()
}

fn kv_get<T: DeserializeOwned>(conn: &Connection, key: &str) -> Result<Option<T>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .map_err(storage)?;
    raw.map(|s| from_json(&s)).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn issue(id: u64, updated_on: &str) -> Issue {
        serde_json::from_value(json!({
            "id": id,
            "project": {"id": 1, "name": "Web"},
            "tracker": {"id": 1, "name": "Bug"},
            "status": {"id": 1, "name": "New"},
            "priority": {"id": 2, "name": "Normal"},
            "subject": format!("Issue {id}"),
            "created_on": "2026-11-01T00:00:00Z",
            "updated_on": updated_on
        }))
        .unwrap()
    }

    #[test]
    fn reports_only_new_or_changed_issues() {
        let store = Store::in_memory().unwrap();
        let changed = store
            .upsert_issues(&[
                issue(1, "2026-11-01T00:00:00Z"),
                issue(2, "2026-11-01T00:00:00Z"),
            ])
            .unwrap();
        assert_eq!(changed, vec![1, 2]);
        let changed = store
            .upsert_issues(&[
                issue(1, "2026-11-01T00:00:00Z"),
                issue(2, "2026-11-02T00:00:00Z"),
            ])
            .unwrap();
        assert_eq!(changed, vec![2]);
        assert_eq!(store.count_issues().unwrap(), 2);
        assert_eq!(store.issues().unwrap()[0].id, 2, "newest change first");
    }

    #[test]
    fn keeps_values_and_metadata() {
        let store = Store::in_memory().unwrap();
        store.set_value("cursor", &"2026-11-01T00:00:00Z").unwrap();
        assert_eq!(
            store.get_value::<String>("cursor").unwrap().as_deref(),
            Some("2026-11-01T00:00:00Z")
        );
        let meta = Metadata {
            statuses: vec![
                IssueStatus {
                    id: 1,
                    name: "New".into(),
                    is_closed: false,
                },
                IssueStatus {
                    id: 5,
                    name: "Closed".into(),
                    is_closed: true,
                },
            ],
            ..Default::default()
        };
        store.replace_metadata(&meta).unwrap();
        assert_eq!(store.metadata().unwrap().statuses, meta.statuses);
    }

    #[test]
    fn survives_reopening_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache").join("redline.sqlite");
        Store::open(&path)
            .unwrap()
            .upsert_issues(&[issue(7, "2026-11-01T00:00:00Z")])
            .unwrap();
        let reopened = Store::open(&path).unwrap();
        assert_eq!(reopened.issue(7).unwrap().unwrap().subject, "Issue 7");
    }

    #[test]
    fn removes_issues_and_their_journals() {
        let store = Store::in_memory().unwrap();
        store
            .upsert_issues(&[issue(1, "2026-11-01T00:00:00Z")])
            .unwrap();
        store.set_journals(1, "2026-11-01T00:00:00Z", &[]).unwrap();
        store.remove_issues(&[1]).unwrap();
        assert!(store.issue(1).unwrap().is_none());
        assert!(store.journals(1).unwrap().is_none());
    }
}
