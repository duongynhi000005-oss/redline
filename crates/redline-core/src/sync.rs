//! Pull-based sync between a Redmine server and the local cache.
//!
//! Redmine has no push API, so Redline polls:
//!
//! 1. **Metadata** (projects, statuses, trackers, priorities, versions and
//!    memberships) on sign-in and now and then after.
//! 2. **Issue delta**: issues updated since a cursor, oldest first, in pages
//!    of 100, with their relations. The first run pulls everything the user
//!    can see.
//! 3. **Details** (journals and allowed statuses) for one issue when it's
//!    opened, cached until the issue changes.
//! 4. **Pruning**: issues deleted or hidden on the server never show up in a
//!    delta, so cached ids are re-checked in batches now and then. Relation
//!    changes don't touch `updated_on` either, so the same pass refreshes
//!    relations; opening an issue refreshes its own.

use std::collections::HashSet;

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::Serialize;
use tokio::task::JoinSet;

use crate::client::{Client, IssueQuery, PAGE_SIZE};
use crate::error::{Error, Result};
use crate::mentions;
use crate::models::{Issue, IssueStatusRef, Journal, NewRelation, Relation};
use crate::store::{Metadata, Store};

const CURSOR_KEY: &str = "issues_cursor";

/// How far behind the newest `updated_on` the next delta starts. Covers
/// clock differences and several edits in the same second; issues that
/// haven't really changed are skipped by comparing `updated_on`.
const CURSOR_OVERLAP: Duration = Duration::seconds(60);

/// At most this many search hits get their comments read to confirm a
/// mention, so one lookup can't turn into hundreds of requests.
const MAX_MENTION_CHECKS: usize = 10;

/// What one issue sync did.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    /// Issues that are new or changed in the cache.
    pub changed: Vec<u64>,
    /// Issues Redmine sent, changed or not.
    pub fetched: u64,
    /// True when this was the first, full pull.
    pub initial: bool,
}

/// An issue with what's only available one issue at a time.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetails {
    pub issue: Issue,
    pub journals: Vec<Journal>,
    /// Statuses this user may move the issue to. `None` on servers older
    /// than 5.0, where Redline has to try the change and see.
    pub allowed_statuses: Option<Vec<IssueStatusRef>>,
}

/// Syncs one server into one cache.
#[derive(Debug, Clone)]
pub struct Syncer {
    client: Client,
    store: Store,
}

impl Syncer {
    pub fn new(client: Client, store: Store) -> Self {
        Self { client, store }
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    /// Refreshes all metadata and replaces the cached copy.
    pub async fn sync_metadata(&self) -> Result<Metadata> {
        let (user, projects, statuses, trackers, priorities) = tokio::try_join!(
            self.client.current_user(),
            self.client.projects(),
            self.client.issue_statuses(),
            self.client.trackers(),
            self.client.issue_priorities(),
        )?;

        // Versions and members per project that tracks issues. The client's
        // concurrency limit keeps this polite.
        let mut tasks = JoinSet::new();
        for project in projects.iter().filter(|p| tracks_issues(p)) {
            let client = self.client.clone();
            let id = project.id;
            tasks.spawn(async move {
                let versions = client.versions(id).await;
                let members = client.memberships(id).await;
                (versions, members)
            });
        }
        let mut versions = Vec::new();
        let mut memberships = Vec::new();
        let mut seen_versions = HashSet::new();
        while let Some(joined) = tasks.join_next().await {
            let (v, m) = joined.map_err(|e| Error::Network(e.to_string()))?;
            // A project can hide its members or versions from some roles;
            // that isn't a reason to fail the whole sync.
            for version in ok_unless_forbidden(v)? {
                if seen_versions.insert(version.id) {
                    versions.push(version);
                }
            }
            memberships.extend(ok_unless_forbidden(m)?);
        }
        versions.sort_by_key(|v| v.id);
        memberships.sort_by_key(|m| m.id);

        let meta = Metadata {
            user: Some(user),
            projects,
            statuses,
            trackers,
            priorities: priorities.into_iter().filter(|p| p.active).collect(),
            versions,
            memberships,
        };
        self.store.replace_metadata(&meta)?;
        Ok(meta)
    }

    /// Pulls issues changed since the last sync (or everything, the first
    /// time) into the cache.
    pub async fn sync_issues(&self) -> Result<SyncReport> {
        let cursor: Option<String> = self.store.get_value(CURSOR_KEY)?;
        let since = cursor.as_deref().map(|c| rewind(c, CURSOR_OVERLAP));
        let mut report = SyncReport {
            initial: cursor.is_none(),
            ..Default::default()
        };
        let mut newest = cursor.clone();
        let mut offset = 0;
        loop {
            let page = self
                .client
                .issues(&IssueQuery {
                    updated_since: since.clone(),
                    include: vec!["relations"],
                    offset,
                    limit: Some(PAGE_SIZE),
                    ..Default::default()
                })
                .await?;
            let count = page.items.len() as u64;
            report.fetched += count;
            for issue in &page.items {
                if newest
                    .as_deref()
                    .is_none_or(|n| issue.updated_on.as_str() > n)
                {
                    newest = Some(issue.updated_on.clone());
                }
            }
            report
                .changed
                .extend(self.store.upsert_issues(&page.items)?);
            offset += count;
            if count == 0 || offset >= page.total_count {
                break;
            }
        }
        if let Some(newest) = newest {
            self.store.set_value(CURSOR_KEY, &newest)?;
        }
        Ok(report)
    }

    /// Drops cached issues that the server no longer returns (deleted, moved
    /// out of reach, or made private). Returns the ids dropped.
    pub async fn prune_deleted(&self) -> Result<Vec<u64>> {
        let ids = self.store.issue_ids()?;
        let mut gone = Vec::new();
        for batch in ids.chunks(PAGE_SIZE as usize) {
            let page = self
                .client
                .issues(&IssueQuery {
                    issue_ids: batch.to_vec(),
                    // Relation changes don't touch `updated_on`, so this pass
                    // is also when other people's relation changes arrive.
                    include: vec!["relations"],
                    limit: Some(PAGE_SIZE),
                    ..Default::default()
                })
                .await?;
            let present: HashSet<u64> = page.items.iter().map(|i| i.id).collect();
            gone.extend(batch.iter().copied().filter(|id| !present.contains(id)));
            self.store.upsert_issues(&page.items)?;
        }
        self.store.remove_issues(&gone)?;
        Ok(gone)
    }

    /// Fetches one issue with its journals and allowed statuses, and
    /// refreshes the cache with it.
    pub async fn issue_details(&self, id: u64) -> Result<IssueDetails> {
        let issue = match self
            .client
            .issue(
                id,
                &[
                    "journals",
                    "watchers",
                    "children",
                    "relations",
                    "attachments",
                    "allowed_statuses",
                ],
            )
            .await
        {
            Ok(issue) => issue,
            Err(Error::NotFound) => {
                self.store.remove_issues(&[id])?;
                return Err(Error::NotFound);
            }
            Err(e) => return Err(e),
        };
        let journals = issue.journals.clone().unwrap_or_default();
        let allowed_statuses = issue.allowed_statuses.clone();
        self.store.upsert_issues(std::slice::from_ref(&issue))?;
        self.store.set_journals(id, &issue.updated_on, &journals)?;
        Ok(IssueDetails {
            issue,
            journals,
            allowed_statuses,
        })
    }

    /// Re-reads issues (with relations) into the cache. Returns the ids that
    /// changed. Ids the server doesn't return are left alone.
    pub async fn refresh_issues(&self, ids: &[u64]) -> Result<Vec<u64>> {
        let page = self
            .client
            .issues(&IssueQuery {
                issue_ids: ids.to_vec(),
                include: vec!["relations"],
                limit: Some(PAGE_SIZE),
                ..Default::default()
            })
            .await?;
        self.store.upsert_issues(&page.items)
    }

    /// Relates two issues, then refreshes both. Returns the relation and the
    /// ids that changed in the cache.
    pub async fn add_relation(
        &self,
        issue_id: u64,
        relation: &NewRelation,
    ) -> Result<(Relation, Vec<u64>)> {
        let created = self.client.create_relation(issue_id, relation).await?;
        let changed = self
            .refresh_issues(&[issue_id, relation.issue_to_id])
            .await?;
        Ok((created, changed))
    }

    /// Removes a relation, then refreshes both issues it joined.
    pub async fn remove_relation(&self, relation: &Relation) -> Result<Vec<u64>> {
        match self.client.delete_relation(relation.id).await {
            // Already gone: refreshing is all that's left to do.
            Ok(()) | Err(Error::NotFound) => {}
            Err(e) => return Err(e),
        }
        self.refresh_issues(&[relation.issue_id, relation.issue_to_id])
            .await
    }

    /// Issues whose description or comments mention `#id`, newest first.
    ///
    /// Uses Redmine's search (which also reads comments) and the cache.
    /// Search matches text loosely, so `#12` also finds `#123`; each hit is
    /// checked against its description, or its comments when the description
    /// doesn't say. Works offline from the cache alone.
    pub async fn mentions_of(&self, id: u64) -> Result<Vec<u64>> {
        let mut found: Vec<u64> = Vec::new();
        let mut unsure: Vec<u64> = Vec::new();
        match self.client.search_issues(&format!("#{id}")).await {
            Ok(results) => {
                for hit in results
                    .iter()
                    .filter(|r| r.kind.starts_with("issue") && r.id != id)
                {
                    let description = match self.store.issue(hit.id)? {
                        Some(cached) => cached.description,
                        None => hit.description.clone(),
                    };
                    if description
                        .as_deref()
                        .is_some_and(|d| mentions::mentions(d, id))
                    {
                        found.push(hit.id);
                    } else {
                        unsure.push(hit.id);
                    }
                }
            }
            // No search permission, or offline: the cache still knows a lot.
            Err(Error::Forbidden | Error::Network(_) | Error::NotFound) => {}
            Err(e) => return Err(e),
        }
        // Hits whose description doesn't mention it matched in a comment
        // (or matched `#123`). Read their comments to tell.
        let mut checks = JoinSet::new();
        for other in unsure.into_iter().take(MAX_MENTION_CHECKS) {
            let syncer = self.clone();
            checks.spawn(async move {
                let journals = match syncer.cached_issue_details(other)? {
                    Some(details) => details.journals,
                    None => syncer.issue_details(other).await?.journals,
                };
                Ok::<_, Error>((other, journals))
            });
        }
        while let Some(joined) = checks.join_next().await {
            if let Ok(Ok((other, journals))) = joined
                && journals.iter().any(|j| {
                    j.notes
                        .as_deref()
                        .is_some_and(|n| mentions::mentions(n, id))
                })
            {
                found.push(other);
            }
        }
        // Cached descriptions and comments, for what search didn't return.
        for issue in self.store.issues()? {
            if issue.id == id || found.contains(&issue.id) {
                continue;
            }
            let in_description = issue
                .description
                .as_deref()
                .is_some_and(|d| mentions::mentions(d, id));
            let in_comments = || -> Result<bool> {
                Ok(self.store.journals(issue.id)?.is_some_and(|(_, journals)| {
                    journals.iter().any(|j| {
                        j.notes
                            .as_deref()
                            .is_some_and(|n| mentions::mentions(n, id))
                    })
                }))
            };
            if in_description || in_comments()? {
                found.push(issue.id);
            }
        }
        // Newest first, the way search returns them.
        let order: Vec<u64> = self.store.issues()?.iter().map(|i| i.id).collect();
        found.sort_by_key(|f| order.iter().position(|o| o == f).unwrap_or(usize::MAX));
        found.dedup();
        Ok(found)
    }

    /// Cached details for an issue, if its journals are as new as the issue.
    pub fn cached_issue_details(&self, id: u64) -> Result<Option<IssueDetails>> {
        let Some(issue) = self.store.issue(id)? else {
            return Ok(None);
        };
        Ok(match self.store.journals(id)? {
            Some((at, journals)) if at == issue.updated_on => Some(IssueDetails {
                issue,
                journals,
                allowed_statuses: None,
            }),
            _ => None,
        })
    }
}

fn tracks_issues(project: &crate::models::Project) -> bool {
    // Closed and archived projects still show their issues; only skip ones
    // with issue tracking switched off. An empty list means the server didn't
    // say, so assume yes.
    project.enabled_modules.is_empty()
        || project
            .enabled_modules
            .iter()
            .any(|m| m.name == "issue_tracking")
}

fn ok_unless_forbidden<T>(result: Result<Vec<T>>) -> Result<Vec<T>> {
    match result {
        Ok(items) => Ok(items),
        Err(Error::Forbidden | Error::NotFound) => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

/// `timestamp` minus `by`, in the format Redmine's filters accept. Leaves an
/// unparseable timestamp as it is.
fn rewind(timestamp: &str, by: Duration) -> String {
    match DateTime::parse_from_rfc3339(timestamp) {
        Ok(t) => (t.with_timezone(&Utc) - by).to_rfc3339_opts(SecondsFormat::Secs, true),
        Err(_) => timestamp.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewinds_the_cursor_in_redmine_format() {
        assert_eq!(
            rewind("2026-11-09T03:35:32Z", Duration::seconds(60)),
            "2026-11-09T03:34:32Z"
        );
        assert_eq!(rewind("garbage", Duration::seconds(60)), "garbage");
    }
}
