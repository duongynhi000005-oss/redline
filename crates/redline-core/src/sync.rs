//! Pull-based sync between a Redmine server and the local cache.
//!
//! Redmine has no push API, so Redline polls:
//!
//! 1. **Metadata** on sign-in and now and then after, in two parts: the
//!    core (projects, statuses, trackers, priorities and the like, a handful
//!    of requests), then each project's versions and members, a few projects
//!    at a time, the user's own projects first.
//! 2. **Issue delta**: issues updated since a cursor, oldest first, in pages
//!    of 100, with their relations.
//! 3. **Backfill**: the first sync reads the most recently changed issues
//!    first, so what people are working on shows straight away, then the
//!    rest a page at a time, open issues before closed ones. Its place is
//!    saved, so it carries on after a restart.
//!
//! All of it goes through the client's background lane, so what someone is
//! waiting on (opening an issue, saving a change) goes first, and the
//! client's pacer keeps it to the server's limits.
//!
//! Besides those:
//!
//! - **Details** (journals and allowed statuses) for one issue when it's
//!   opened, cached until the issue changes.
//! - **Pruning**: issues deleted or hidden on the server never show up in a
//!   delta, so cached ids are re-checked in batches now and then. Relation
//!   changes don't touch `updated_on` either, so the same pass refreshes
//!   relations; opening an issue refreshes its own.

use std::collections::{BTreeMap, HashSet};

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;

use crate::client::{Client, IssueQuery, PAGE_SIZE, Page};
use crate::error::{Error, Result};
use crate::mentions;
use crate::models::{
    Found, Issue, IssueChanges, IssueJournals, IssueStatusRef, Journal, NewRelation, Project,
    ProjectChanges, Relation, SearchResult, SearchScope, TimeEntry, TimeEntryChanges, Upload, User,
    Version, VersionChanges,
};
use crate::store::{Metadata, Store};

const CURSOR_KEY: &str = "issues_cursor";
const BACKFILL_KEY: &str = "issues_backfill";

/// The most issues a saved query shows; past this, the list says how many
/// more Redmine has.
const QUERY_LIMIT: usize = 500;

/// Search results per page.
const SEARCH_PAGE: u32 = 25;

/// Pages of a delta read at once after the first. The client's pacer
/// decides how many really go out together.
const PARALLEL_PAGES: usize = 4;

/// How many issues consecutive sync pages share; see
/// [`Syncer::sync_issues_with`].
const PAGE_OVERLAP: u64 = 10;

/// How far behind the newest `updated_on` the next delta starts. Covers
/// clock differences and several edits in the same second; issues that
/// haven't really changed are skipped by comparing `updated_on`.
const CURSOR_OVERLAP: Duration = Duration::seconds(60);

/// At most this many search hits get their comments read to confirm a
/// mention, so one lookup can't turn into hundreds of requests.
const MAX_MENTION_CHECKS: usize = 10;

/// A file to attach, read by the caller.
#[derive(Debug, Clone)]
pub struct NewFile {
    pub filename: String,
    pub content_type: Option<String>,
    pub bytes: Vec<u8>,
}

/// What one issue sync did.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    /// Issues that are new or changed in the cache.
    pub changed: Vec<u64>,
    /// Issues Redmine sent, changed or not.
    pub fetched: u64,
    /// True when this was part of the first sync, which reads every issue.
    pub initial: bool,
    /// True when older issues are left to read; the next sync goes on.
    pub remaining: bool,
}

/// Where the first sync has got to reading older issues.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct Backfill {
    /// Open issues first, then closed ones.
    open: bool,
    offset: u64,
    /// Every issue the user could see when it started, for progress.
    total: u64,
}

/// One page of a sync, as it lands in the cache.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    /// Issues on this page that are new or changed in the cache.
    pub changed: Vec<u64>,
    /// How far through the list this sync has read.
    pub fetched: u64,
    /// Issues this sync expects to read.
    pub total: u64,
    /// True while the first sync is still reading older issues.
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
    /// Whether the signed-in user watches the issue. `None` when Redmine
    /// wouldn't say.
    pub watching: Option<bool>,
}

/// Syncs one server into one cache.
#[derive(Debug, Clone)]
pub struct Syncer {
    client: Client,
    /// The same client in the background lane, for sync.
    background: Client,
    store: Store,
}

impl Syncer {
    pub fn new(client: Client, store: Store) -> Self {
        Self {
            background: client.background(),
            client,
            store,
        }
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    /// Refreshes all metadata and replaces the cached copy: the core, then
    /// every project's versions and members.
    pub async fn sync_metadata(&self) -> Result<Metadata> {
        let meta = self.sync_core_metadata().await?;
        let projects = projects_needing_details(&meta);
        self.sync_project_details(&projects).await
    }

    /// Refreshes what every screen needs, in a handful of requests: the
    /// user, projects, statuses, trackers, priorities, roles, time
    /// activities and saved queries. Versions and members already cached
    /// are kept (those of projects that are gone are dropped); refresh them
    /// with [`Syncer::sync_project_details`].
    pub async fn sync_core_metadata(&self) -> Result<Metadata> {
        let client = &self.background;
        let (user, projects, statuses, trackers, priorities) = tokio::try_join!(
            client.current_user(),
            client.projects(),
            client.issue_statuses(),
            client.trackers(),
            client.issue_priorities(),
        )?;
        // Any user may read roles; a locked-down server may still refuse.
        let roles = ok_unless_forbidden(client.roles().await)?;
        let time_entry_activities = ok_unless_forbidden(client.time_entry_activities().await)?
            .into_iter()
            .filter(|a| a.active)
            .collect();
        let queries = ok_unless_forbidden(client.queries().await)?;

        let cached = self.store.metadata()?;
        let present: HashSet<u64> = projects.iter().map(|p| p.id).collect();
        let meta = Metadata {
            user: Some(user),
            priorities: priorities.into_iter().filter(|p| p.active).collect(),
            statuses,
            trackers,
            versions: cached.versions,
            memberships: cached
                .memberships
                .into_iter()
                .filter(|m| present.contains(&m.project.id))
                .collect(),
            projects,
            roles,
            time_entry_activities,
            queries,
        };
        self.store.replace_metadata(&meta)?;
        Ok(meta)
    }

    /// Reads the versions and members of `project_ids` and merges them into
    /// the cached metadata. Projects that hide them from this user are
    /// skipped.
    pub async fn sync_project_details(&self, project_ids: &[u64]) -> Result<Metadata> {
        let mut tasks = JoinSet::new();
        for &id in project_ids {
            let client = self.background.clone();
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

        // Read again: other work may have changed the metadata meanwhile.
        let mut meta = self.store.metadata()?;
        let read: HashSet<u64> = project_ids.iter().copied().collect();
        meta.versions
            .retain(|v| !read.contains(&v.project.id) && !seen_versions.contains(&v.id));
        meta.versions.extend(versions);
        meta.versions.sort_by_key(|v| v.id);
        meta.memberships.retain(|m| !read.contains(&m.project.id));
        meta.memberships.extend(memberships);
        meta.memberships.sort_by_key(|m| m.id);
        self.store.replace_metadata(&meta)?;
        Ok(meta)
    }

    /// Pulls issues changed since the last sync into the cache. The first
    /// time, reads every issue, most recently changed first.
    pub async fn sync_issues(&self) -> Result<SyncReport> {
        self.sync_issues_with(|_| {}).await
    }

    /// Like [`Syncer::sync_issues`], calling `on_page` as each page lands in
    /// the cache, in order, so a long first sync can show issues as they
    /// arrive.
    pub async fn sync_issues_with(&self, on_page: impl FnMut(&SyncProgress)) -> Result<SyncReport> {
        self.sync_issues_paced(usize::MAX, on_page).await
    }

    /// One step of a sync: the changes since the last one, then at most
    /// `older_pages` pages of older issues while the first sync is still
    /// reading them. [`SyncReport::remaining`] says whether there's more.
    ///
    /// The first sync reads the most recently changed issues, then open
    /// issues, then closed ones, newest first. Pages overlap by
    /// [`PAGE_OVERLAP`] issues, so issues created, edited or deleted while
    /// it reads don't make it skip any; edits made meanwhile also arrive
    /// with the next delta. Its place is saved after each page.
    pub async fn sync_issues_paced(
        &self,
        older_pages: usize,
        mut on_page: impl FnMut(&SyncProgress),
    ) -> Result<SyncReport> {
        let cursor: Option<String> = self.store.get_value(CURSOR_KEY)?;
        let mut backfill: Option<Backfill> = self.store.get_value(BACKFILL_KEY)?;
        let mut report = SyncReport::default();

        match cursor {
            Some(cursor) => self.sync_delta(cursor, &mut report, &mut on_page).await?,
            None => {
                // The most recently changed issues, whatever their status:
                // what someone opening Redline for the first time wants to see.
                let page = self
                    .background
                    .issues(&IssueQuery {
                        include: vec!["relations"],
                        newest_first: true,
                        limit: Some(PAGE_SIZE),
                        ..Default::default()
                    })
                    .await?;
                let more = (page.items.len() as u64) < page.total_count;
                let total = page.total_count;
                let mut newest = None;
                report.initial = true;
                self.take_page(0, page, &mut newest, &mut report, total, &mut on_page)?;
                if more {
                    let start = Backfill {
                        open: true,
                        offset: 0,
                        total,
                    };
                    self.store.set_value(BACKFILL_KEY, &start)?;
                    backfill = Some(start);
                } else {
                    self.store.remove_value(BACKFILL_KEY)?;
                    backfill = None;
                }
            }
        }

        self.read_older(backfill, older_pages, &mut report, &mut on_page)
            .await?;
        Ok(report)
    }

    /// Reads up to `pages` pages of older issues while the first sync is
    /// still filling the cache, without asking for changes first.
    pub async fn sync_older_issues(
        &self,
        pages: usize,
        mut on_page: impl FnMut(&SyncProgress),
    ) -> Result<SyncReport> {
        let backfill: Option<Backfill> = self.store.get_value(BACKFILL_KEY)?;
        let mut report = SyncReport::default();
        self.read_older(backfill, pages, &mut report, &mut on_page)
            .await?;
        Ok(report)
    }

    async fn read_older(
        &self,
        mut backfill: Option<Backfill>,
        older_pages: usize,
        report: &mut SyncReport,
        on_page: &mut impl FnMut(&SyncProgress),
    ) -> Result<()> {
        let mut pages = 0;
        while let Some(mut place) = backfill {
            if pages >= older_pages {
                break;
            }
            pages += 1;
            report.initial = true;
            let page = self
                .background
                .issues(&IssueQuery {
                    include: vec!["relations"],
                    open: Some(place.open),
                    newest_first: true,
                    offset: place.offset,
                    limit: Some(PAGE_SIZE),
                    ..Default::default()
                })
                .await?;
            let got = page.items.len() as u64;
            let done = got == 0 || place.offset + got >= page.total_count;
            report.fetched += got;
            let changed = self.store.upsert_issues(&page.items)?;
            report.changed.extend(&changed);
            if done && !place.open {
                backfill = None;
                self.store.remove_value(BACKFILL_KEY)?;
            } else {
                if done {
                    place = Backfill {
                        open: false,
                        offset: 0,
                        ..place
                    };
                } else {
                    // Step by what the server really sends per page, which
                    // can be less than asked for.
                    place.offset += if got > 2 * PAGE_OVERLAP {
                        got - PAGE_OVERLAP
                    } else {
                        got
                    };
                }
                self.store.set_value(BACKFILL_KEY, &place)?;
                backfill = Some(place);
            }
            let total = backfill.map_or(0, |b| b.total);
            let cached = self.store.count_issues()?;
            on_page(&SyncProgress {
                changed,
                fetched: if backfill.is_some() {
                    cached.min(total)
                } else {
                    cached
                },
                total: if backfill.is_some() { total } else { cached },
                initial: backfill.is_some(),
            });
        }
        report.remaining = backfill.is_some();
        Ok(())
    }

    /// Reads issues changed since `cursor`, oldest first, so the cursor can
    /// move after each page.
    ///
    /// After the first page, up to [`PARALLEL_PAGES`] pages are read at
    /// once. Pages overlap by [`PAGE_OVERLAP`] issues: the list is sorted by
    /// `updated_on`, so an issue edited mid-sync jumps to the end and every
    /// later issue shifts back one place, and without the overlap the issue
    /// at a page boundary would be skipped for good. The cursor is saved
    /// after each page, so a sync that fails part-way picks up from there.
    async fn sync_delta(
        &self,
        cursor: String,
        report: &mut SyncReport,
        on_page: &mut impl FnMut(&SyncProgress),
    ) -> Result<()> {
        let since = Some(rewind(&cursor, CURSOR_OVERLAP));
        let mut newest = Some(cursor);

        let first = fetch_issue_page(self.background.clone(), since.clone(), 0).await?;
        let got = first.items.len() as u64;
        let mut total = first.total_count;
        self.take_page(0, first, &mut newest, report, total, on_page)?;
        if got == 0 || got >= total {
            return Ok(());
        }

        let step = if got > 2 * PAGE_OVERLAP {
            got - PAGE_OVERLAP
        } else {
            got
        };
        let mut next = step;
        let mut expect = step;
        let mut tasks = JoinSet::new();
        let mut landed = BTreeMap::new();
        loop {
            while tasks.len() < PARALLEL_PAGES && next < total {
                let client = self.background.clone();
                let since = since.clone();
                let offset = next;
                tasks.spawn(async move { (offset, fetch_issue_page(client, since, offset).await) });
                next += step;
            }
            let Some(joined) = tasks.join_next().await else {
                break;
            };
            let (offset, page) = joined.map_err(|e| Error::Network(e.to_string()))?;
            // Dropping `tasks` on an error cancels the pages still in flight.
            landed.insert(offset, page?);
            while let Some(page) = landed.remove(&expect) {
                let empty = page.items.is_empty();
                // Issues created during the sync grow the list; go on to the end.
                total = total.max(page.total_count);
                self.take_page(expect, page, &mut newest, report, total, on_page)?;
                expect += step;
                if empty {
                    // Issues deleted during the sync shrank the list.
                    total = total.min(expect);
                }
            }
        }
        Ok(())
    }

    /// Caches one page of a sync, moves the cursor past it and reports it.
    fn take_page(
        &self,
        offset: u64,
        page: Page<Issue>,
        newest: &mut Option<String>,
        report: &mut SyncReport,
        total: u64,
        on_page: &mut impl FnMut(&SyncProgress),
    ) -> Result<()> {
        report.fetched += page.items.len() as u64;
        let reached = offset + page.items.len() as u64;
        for issue in &page.items {
            if newest
                .as_deref()
                .is_none_or(|n| issue.updated_on.as_str() > n)
            {
                *newest = Some(issue.updated_on.clone());
            }
        }
        let changed = self.store.upsert_issues(&page.items)?;
        if let Some(newest) = newest {
            self.store.set_value(CURSOR_KEY, newest)?;
        }
        report.changed.extend(&changed);
        on_page(&SyncProgress {
            changed,
            fetched: reached.min(total),
            total,
            initial: report.initial,
        });
        Ok(())
    }

    /// Fails with [`Error::Unauthorized`] when Redmine no longer accepts the
    /// API key. Redmine answers lists for an unknown key as if for an
    /// anonymous visitor, so a sync can't notice by itself.
    pub async fn check_key(&self) -> Result<()> {
        self.background.check_key().await
    }

    /// Drops cached issues that the server no longer returns (deleted, moved
    /// out of reach, or made private). Returns the ids dropped.
    pub async fn prune_deleted(&self) -> Result<Vec<u64>> {
        // With a key Redmine no longer accepts, every issue would look
        // deleted and the whole cache would go.
        self.background.check_key().await?;
        let ids = self.store.issue_ids()?;
        let mut gone = Vec::new();
        for batch in ids.chunks(PAGE_SIZE as usize) {
            let page = self
                .background
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
                    "changesets",
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
        let watching = self.watching(&issue).await;
        Ok(IssueDetails {
            issue,
            journals,
            allowed_statuses,
            watching,
        })
    }

    /// Whether the signed-in user watches an issue: from its watchers when
    /// the role may see them, otherwise by asking for the issue among the
    /// ones the user watches, which any user may do.
    async fn watching(&self, issue: &Issue) -> Option<bool> {
        let me = self.store.metadata().ok()?.user?.id;
        if let Some(watchers) = &issue.watchers {
            return Some(watchers.iter().any(|w| w.id == me));
        }
        let page = self
            .client
            .issues(&IssueQuery {
                issue_ids: vec![issue.id],
                watched_by_me: true,
                limit: Some(1),
                ..Default::default()
            })
            .await
            .ok()?;
        Some(!page.items.is_empty())
    }

    /// Adds or removes a watcher, then re-reads the issue.
    pub async fn set_watcher(
        &self,
        issue_id: u64,
        user_id: u64,
        watching: bool,
    ) -> Result<IssueDetails> {
        if watching {
            self.client.add_watcher(issue_id, user_id).await?;
        } else {
            match self.client.remove_watcher(issue_id, user_id).await {
                // Not watching already: nothing left to do but re-read.
                Ok(()) | Err(Error::NotFound) => {}
                Err(e) => return Err(e),
            }
        }
        self.issue_details(issue_id).await
    }

    /// Uploads files and attaches them to an issue, with an optional
    /// comment, then re-reads the issue.
    pub async fn attach_files(
        &self,
        issue_id: u64,
        files: Vec<NewFile>,
        notes: Option<String>,
    ) -> Result<IssueDetails> {
        let mut uploads = Vec::with_capacity(files.len());
        for file in files {
            let token = self.client.upload(&file.filename, file.bytes).await?;
            uploads.push(Upload {
                token,
                filename: file.filename,
                content_type: file.content_type,
            });
        }
        let changes = IssueChanges {
            uploads: Some(uploads),
            notes: notes.filter(|n| !n.trim().is_empty()),
            ..Default::default()
        };
        self.client.update_issue(issue_id, &changes).await?;
        self.issue_details(issue_id).await
    }

    /// Deletes an attachment, then re-reads the issue it was on.
    pub async fn delete_attachment(
        &self,
        issue_id: u64,
        attachment_id: u64,
    ) -> Result<IssueDetails> {
        match self.client.delete_attachment(attachment_id).await {
            Ok(()) | Err(Error::NotFound) => {}
            Err(e) => return Err(e),
        }
        self.issue_details(issue_id).await
    }

    /// Logs time, then re-reads the issue it's on so its spent time is current.
    /// Creates a version and adds it to the cached metadata.
    pub async fn create_version(
        &self,
        project_id: u64,
        changes: &VersionChanges,
    ) -> Result<Version> {
        let version = self.client.create_version(project_id, changes).await?;
        self.cache_version(Some(version.clone()), version.id)?;
        Ok(version)
    }

    /// Changes a version and refreshes the cached copy.
    pub async fn update_version(&self, id: u64, changes: &VersionChanges) -> Result<Version> {
        self.client.update_version(id, changes).await?;
        let version = self.client.version(id).await?;
        self.cache_version(Some(version.clone()), id)?;
        Ok(version)
    }

    /// One version as Redmine shows it on its own page, with the spent and
    /// estimated hours that the project's list of versions leaves out.
    /// Creates a project (a sub-team) and refreshes the metadata, so the new
    /// team has its trackers, modules and members.
    pub async fn create_project(&self, fields: &ProjectChanges) -> Result<Project> {
        let project = self.client.create_project(fields).await?;
        self.sync_core_metadata().await?;
        let meta = self.sync_project_details(&[project.id]).await?;
        Ok(meta
            .projects
            .into_iter()
            .find(|p| p.id == project.id)
            .unwrap_or(project))
    }

    /// Changes a project and refreshes the metadata.
    pub async fn update_project(&self, id: u64, changes: &ProjectChanges) -> Result<Metadata> {
        self.client.update_project(id, changes).await?;
        self.sync_core_metadata().await?;
        self.sync_project_details(&[id]).await
    }

    /// Closes or reopens a project (and its sub-projects) and refreshes the
    /// metadata.
    pub async fn set_project_closed(&self, id: u64, closed: bool) -> Result<Metadata> {
        self.client.set_project_closed(id, closed).await?;
        let meta = self.sync_core_metadata().await?;
        // Sub-projects close and reopen with it.
        let mut affected = vec![id];
        let mut i = 0;
        while i < affected.len() {
            let parent = affected[i];
            affected.extend(
                meta.projects
                    .iter()
                    .filter(|p| p.parent.as_ref().is_some_and(|q| q.id == parent))
                    .map(|p| p.id),
            );
            i += 1;
        }
        self.sync_project_details(&affected).await
    }

    /// Deletes a project, refreshes the metadata and drops its issues from
    /// the cache. Returns the issue ids dropped.
    pub async fn delete_project(&self, id: u64) -> Result<Vec<u64>> {
        match self.client.delete_project(id).await {
            Ok(()) | Err(Error::NotFound) => {}
            Err(e) => return Err(e),
        }
        self.sync_core_metadata().await?;
        self.prune_deleted().await
    }

    /// Another user, as Redmine shows them to this user.
    pub async fn user(&self, id: u64) -> Result<User> {
        self.client.user(id).await
    }

    pub async fn version(&self, id: u64) -> Result<Version> {
        self.client.version(id).await
    }

    /// Deletes a version and drops it from the cached metadata.
    pub async fn delete_version(&self, id: u64) -> Result<()> {
        match self.client.delete_version(id).await {
            Ok(()) | Err(Error::NotFound) => {}
            Err(e) => return Err(e),
        }
        self.cache_version(None, id)
    }

    fn cache_version(&self, version: Option<Version>, id: u64) -> Result<()> {
        let mut meta = self.store.metadata()?;
        meta.versions.retain(|v| v.id != id);
        if let Some(version) = version {
            meta.versions.push(version);
        }
        meta.versions.sort_by_key(|v| v.id);
        self.store.replace_metadata(&meta)
    }

    pub async fn log_time(&self, entry: &TimeEntryChanges) -> Result<TimeEntry> {
        let created = self.client.create_time_entry(entry).await?;
        self.refresh_spent(created.issue.iter().map(|i| i.id)).await;
        Ok(created)
    }

    /// Changes a time entry. Re-reads the issues it was and is on.
    pub async fn update_time_entry(
        &self,
        id: u64,
        changes: &TimeEntryChanges,
    ) -> Result<TimeEntry> {
        let before = self.client.time_entry(id).await?;
        self.client.update_time_entry(id, changes).await?;
        let after = self.client.time_entry(id).await?;
        self.refresh_spent(before.issue.iter().chain(after.issue.iter()).map(|i| i.id))
            .await;
        Ok(after)
    }

    /// Deletes a time entry. Returns the issue it was on, re-read.
    pub async fn delete_time_entry(&self, id: u64) -> Result<Option<u64>> {
        let entry = self.client.time_entry(id).await?;
        self.client.delete_time_entry(id).await?;
        let issue = entry.issue.map(|i| i.id);
        self.refresh_spent(issue).await;
        Ok(issue)
    }

    /// Spent time isn't a change Redmine dates, so a sync wouldn't pick it
    /// up; read the issues again. Best effort: the time is logged either way.
    async fn refresh_spent(&self, ids: impl IntoIterator<Item = u64>) {
        let ids: HashSet<u64> = ids.into_iter().collect();
        for id in ids {
            let _ = self.issue_details(id).await;
        }
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

    /// Changes or removes a comment, then re-reads its issue.
    pub async fn update_comment(
        &self,
        issue_id: u64,
        journal_id: u64,
        notes: &str,
    ) -> Result<IssueDetails> {
        self.client.update_journal(journal_id, notes).await?;
        self.issue_details(issue_id).await
    }

    /// Deletes an issue. Redmine deletes its sub-issues too, so they leave
    /// the cache with it, and its parent is re-read for its new totals.
    /// Returns the ids removed and the ids changed.
    pub async fn delete_issue(&self, id: u64) -> Result<(Vec<u64>, Vec<u64>)> {
        let cached = self.store.issues()?;
        let parent = cached
            .iter()
            .find(|i| i.id == id)
            .and_then(|i| i.parent.as_ref().map(|p| p.id));
        match self.client.delete_issue(id).await {
            Ok(()) | Err(Error::NotFound) => {}
            Err(e) => return Err(e),
        }
        let mut removed = vec![id];
        let mut i = 0;
        while i < removed.len() {
            let under = removed[i];
            removed.extend(
                cached
                    .iter()
                    .filter(|c| c.parent.as_ref().is_some_and(|p| p.id == under))
                    .map(|c| c.id),
            );
            i += 1;
        }
        self.store.remove_issues(&removed)?;
        // The parent's totals and the other ends of its relations change too.
        let mut touched: Vec<u64> = parent.into_iter().collect();
        for issue in &cached {
            for r in issue.relations.iter().flatten() {
                let other = if removed.contains(&r.issue_id) {
                    r.issue_to_id
                } else if removed.contains(&r.issue_to_id) {
                    r.issue_id
                } else {
                    continue;
                };
                if !removed.contains(&other) && !touched.contains(&other) {
                    touched.push(other);
                }
            }
        }
        touched.retain(|id| !removed.contains(id));
        let changed = if touched.is_empty() {
            vec![]
        } else {
            self.refresh_issues(&touched).await?
        };
        Ok((removed, changed))
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
    /// Runs a saved query: the ids of the issues it finds, in its order, up
    /// to [`QUERY_LIMIT`], and how many it finds in all. The issues go into
    /// the cache like any others; the second value lists those that changed.
    pub async fn query_issues(
        &self,
        query_id: u64,
        project_id: Option<u64>,
    ) -> Result<(Found<u64>, Vec<u64>)> {
        let mut issues = Vec::new();
        let total = loop {
            let page = self
                .client
                .query_issues(query_id, project_id, issues.len() as u64)
                .await?;
            let fetched = page.items.len();
            issues.extend(page.items);
            let total = page.total_count;
            if fetched == 0 || issues.len() as u64 >= total || issues.len() >= QUERY_LIMIT {
                break total;
            }
        };
        issues.truncate(QUERY_LIMIT);
        let changed = self.store.upsert_issues(&issues)?;
        let items = issues.iter().map(|i| i.id).collect();
        Ok((Found { items, total }, changed))
    }

    /// One page of what Redmine search finds, newest first.
    pub async fn search(
        &self,
        text: &str,
        offset: u64,
        scope: &SearchScope,
    ) -> Result<Found<SearchResult>> {
        let page = self.client.search(text, offset, SEARCH_PAGE, scope).await?;
        Ok(Found {
            items: page.items,
            total: page.total_count,
        })
    }

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

    /// Journals of cached issues, for the activity feed: from the cache when
    /// they're as new as the issue, otherwise read from Redmine (journals
    /// only) and cached. Issues Redline doesn't have, or that are gone or
    /// hidden now, are left out.
    pub async fn issue_journals(&self, ids: &[u64]) -> Result<Vec<IssueJournals>> {
        let mut out = Vec::with_capacity(ids.len());
        let mut stale = Vec::new();
        for &id in ids {
            let Some(issue) = self.store.issue(id)? else {
                continue;
            };
            match self.store.journals(id)? {
                Some((at, journals)) if at >= issue.updated_on => out.push(IssueJournals {
                    issue_id: id,
                    journals,
                }),
                _ => stale.push(id),
            }
        }
        // A few at a time, so a long feed doesn't flood the server.
        for chunk in stale.chunks(4) {
            let mut tasks = JoinSet::new();
            for &id in chunk {
                let client = self.client.clone();
                tasks.spawn(async move { (id, client.issue(id, &["journals"]).await) });
            }
            let mut fetched = Vec::with_capacity(chunk.len());
            while let Some(done) = tasks.join_next().await {
                fetched.push(done.map_err(|e| Error::Network(e.to_string()))?);
            }
            for (id, result) in fetched {
                match result {
                    Ok(issue) => {
                        let journals = issue.journals.unwrap_or_default();
                        self.store.set_journals(id, &issue.updated_on, &journals)?;
                        out.push(IssueJournals {
                            issue_id: id,
                            journals,
                        });
                    }
                    Err(Error::NotFound | Error::Forbidden) => {}
                    Err(e) => return Err(e),
                }
            }
        }
        Ok(out)
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
                watching: None,
            }),
            _ => None,
        })
    }
}

/// Projects whose versions and members Redline reads, the user's own first:
/// those are the teams in the sidebar and the people in the pickers.
pub fn projects_needing_details(meta: &Metadata) -> Vec<u64> {
    let mine: HashSet<u64> = meta
        .user
        .iter()
        .flat_map(|u| u.memberships.iter().map(|m| m.project.id))
        .collect();
    let mut ids: Vec<(bool, u64)> = meta
        .projects
        .iter()
        .filter(|p| tracks_issues(p))
        .map(|p| (!mine.contains(&p.id), p.id))
        .collect();
    ids.sort_unstable();
    ids.into_iter().map(|(_, id)| id).collect()
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

/// One page of issues changed since `since` (every issue when it's `None`),
/// with their relations, oldest change first.
async fn fetch_issue_page(
    client: Client,
    since: Option<String>,
    offset: u64,
) -> Result<Page<Issue>> {
    client
        .issues(&IssueQuery {
            updated_since: since,
            include: vec!["relations"],
            offset,
            limit: Some(PAGE_SIZE),
            ..Default::default()
        })
        .await
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
