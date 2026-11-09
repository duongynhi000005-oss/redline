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
const SCHEMA_VERSION: i32 = 2;

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
    /// Roles and their permissions, so Redline offers only what Redmine allows.
    pub roles: Vec<Role>,
    /// What time can be logged as, active ones only. Named as Redmine names it, like
    /// the rest of the data the UI reads.
    #[serde(rename = "time_entry_activities")]
    pub time_entry_activities: Vec<TimeEntryActivity>,
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
        tx.execute(
            "INSERT INTO kv (key, value) VALUES ('roles', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [to_json(&meta.roles)?],
        )
        .map_err(storage)?;
        tx.execute(
            "INSERT INTO kv (key, value) VALUES ('time_entry_activities', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [to_json(&meta.time_entry_activities)?],
        )
        .map_err(storage)?;
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
            roles: kv_get(&conn, "roles")?.unwrap_or_default(),
            time_entry_activities: kv_get(&conn, "time_entry_activities")?.unwrap_or_default(),
        })
    }

    // ----- Issues --------------------------------------------------------

    /// Inserts or updates issues. Returns the ids that are new or changed.
    ///
    /// An issue counts as changed when anything Redline keeps differs, not
    /// only `updated_on`: Redmine doesn't touch `updated_on` when a relation
    /// is added or removed. Extras a list doesn't carry (watchers, children,
    /// attachments) are kept from the cached copy until a fresh copy has them.
    pub fn upsert_issues(&self, issues: &[Issue]) -> Result<Vec<u64>> {
        let mut changed = Vec::new();
        let mut conn = self.conn();
        let tx = conn.transaction().map_err(storage)?;
        for issue in issues {
            let previous: Option<String> = tx
                .query_row(
                    "SELECT json FROM issues WHERE id = ?1",
                    [issue.id as i64],
                    |r| r.get(0),
                )
                .optional()
                .map_err(storage)?;
            let mut stored = issue.clone();
            // Journals live in their own table; allowed statuses go stale.
            stored.journals = None;
            stored.allowed_statuses = None;
            if let Some(previous) = previous.as_deref().and_then(|p| from_json::<Issue>(p).ok()) {
                if issue.updated_on < previous.updated_on {
                    continue;
                }
                stored.watchers = stored.watchers.or_else(|| previous.watchers.clone());
                stored.children = stored.children.or_else(|| previous.children.clone());
                stored.attachments = stored.attachments.or_else(|| previous.attachments.clone());
                stored.relations = stored.relations.or_else(|| previous.relations.clone());
                if stored == previous {
                    continue;
                }
            }
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
    if version < 2 {
        // Version 2 keeps each issue's relations. Forget the sync cursor so
        // the next sync pulls every issue again, this time with them.
        conn.execute_batch(
            "BEGIN;
             DELETE FROM kv WHERE key = 'issues_cursor';
             PRAGMA user_version = 2;
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

    #[test]
    fn metadata_names_fields_as_the_ui_reads_them() {
        let meta = Metadata {
            time_entry_activities: vec![TimeEntryActivity {
                id: 9,
                name: "Development".into(),
                is_default: true,
                active: true,
            }],
            ..Default::default()
        };
        let value = serde_json::to_value(&meta).unwrap();
        assert_eq!(value["time_entry_activities"][0]["name"], "Development");
        assert!(value.get("roles").is_some());
    }

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

    #[test]
    fn notices_relation_changes_without_a_new_updated_on() {
        let store = Store::in_memory().unwrap();
        let plain = issue(1, "2026-11-02T00:00:00Z");
        assert_eq!(
            store.upsert_issues(std::slice::from_ref(&plain)).unwrap(),
            vec![1]
        );

        let mut related = plain.clone();
        related.relations = Some(vec![crate::models::Relation {
            id: 9,
            issue_id: 1,
            issue_to_id: 2,
            relation_type: "blocks".into(),
            delay: None,
        }]);
        assert_eq!(
            store.upsert_issues(std::slice::from_ref(&related)).unwrap(),
            vec![1]
        );
        assert_eq!(
            store.upsert_issues(std::slice::from_ref(&related)).unwrap(),
            Vec::<u64>::new()
        );

        let mut unrelated = plain.clone();
        unrelated.relations = Some(vec![]);
        assert_eq!(store.upsert_issues(&[unrelated]).unwrap(), vec![1]);
        assert_eq!(store.issue(1).unwrap().unwrap().relations, Some(vec![]));
    }

    #[test]
    fn keeps_details_a_list_does_not_carry() {
        let store = Store::in_memory().unwrap();
        let mut detailed = issue(1, "2026-11-02T00:00:00Z");
        detailed.watchers = Some(vec![crate::models::Named {
            id: 3,
            name: "Sam".into(),
        }]);
        store.upsert_issues(&[detailed]).unwrap();

        // The same issue from a list: no watchers key, nothing changed.
        let listed = issue(1, "2026-11-02T00:00:00Z");
        assert!(store.upsert_issues(&[listed]).unwrap().is_empty());
        assert_eq!(store.issue(1).unwrap().unwrap().watchers.unwrap().len(), 1);

        // An older copy never replaces a newer one.
        let older = issue(1, "2026-11-01T00:00:00Z");
        assert!(store.upsert_issues(&[older]).unwrap().is_empty());
    }

    #[test]
    fn upgrading_to_version_2_pulls_every_issue_again() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.sqlite");
        {
            let store = Store::open(&path).unwrap();
            store
                .set_value("issues_cursor", &"2026-11-02T00:00:00Z")
                .unwrap();
            store.set_value("other", &1).unwrap();
            store.conn().pragma_update(None, "user_version", 1).unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.get_value::<String>("issues_cursor").unwrap(), None);
        assert_eq!(store.get_value::<i32>("other").unwrap(), Some(1));
    }
}
