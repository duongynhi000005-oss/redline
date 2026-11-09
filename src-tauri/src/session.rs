//! A signed-in session: the account, its cache, and the background sync loop
//! that keeps the cache fresh and tells the UI what changed.
//!
//! Each pass reads a little: the changes since last time, then a few
//! projects' cycles and people and a few pages of older issues while the
//! first sync is still filling the cache. Passes follow each other closely
//! until it's full, so the newest issues show at once and the rest trickle
//! in at the pace the client's pacer allows.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use redline_core::{Error, Syncer, projects_needing_details};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use crate::account::Account;

/// Poll for changed issues this often while Redline is in front.
const FOCUSED_INTERVAL: Duration = Duration::from_secs(45);
/// And this often while it's in the background.
const BACKGROUND_INTERVAL: Duration = Duration::from_secs(5 * 60);
/// Refresh projects, statuses, versions and members this often.
const METADATA_INTERVAL: Duration = Duration::from_secs(30 * 60);
/// Look for issues deleted on the server this often.
const PRUNE_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Pages of older issues read per pass while the first sync fills the cache.
const OLDER_PAGES_PER_PASS: usize = 5;
/// Projects whose cycles and people are read per pass.
const PROJECTS_PER_PASS: usize = 6;
/// The pause between passes while there's more to read. The pacer sets the
/// real pace; this only lets a waiting Sync now or a change in focus in.
const CATCH_UP_WAIT: Duration = Duration::from_secs(1);
/// After the server stayed busy through every retry, wait this long.
const BUSY_WAIT: Duration = Duration::from_secs(30);

/// Show a count while syncing when there are more issues than this to read.
const PROGRESS_FROM: u64 = 500;

pub const EVENT_SYNC_STATE: &str = "sync-state";
pub const EVENT_ISSUES_CHANGED: &str = "issues-changed";
pub const EVENT_METADATA_CHANGED: &str = "metadata-changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    /// "syncing", "idle", "busy" (the server kept asking Redline to slow
    /// down; it tries again soon), "offline" or "error".
    pub state: &'static str,
    /// Milliseconds since the epoch of the last successful sync.
    pub last_synced_at: Option<u64>,
    pub message: Option<String>,
    /// What went wrong, in the codes UI errors use (for example
    /// "unauthorized"), so the UI can offer more than trying again.
    pub code: Option<&'static str>,
    /// How far a long sync has got, while it runs.
    pub progress: Option<SyncCount>,
    /// True while the server has asked Redline to slow down.
    pub slowed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCount {
    pub fetched: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuesChanged {
    pub changed: Vec<u64>,
    pub removed: Vec<u64>,
}

pub struct Session {
    pub account: Account,
    pub syncer: Syncer,
    wake: Arc<Notify>,
    /// Set by Sync now, so the next pass also reads teams, cycles and people.
    metadata_asked: Arc<AtomicBool>,
    latest: Arc<Mutex<SyncState>>,
    task: tauri::async_runtime::JoinHandle<()>,
    watcher: tauri::async_runtime::JoinHandle<()>,
}

impl Session {
    pub fn start(
        app: AppHandle,
        account: Account,
        syncer: Syncer,
        focused: Arc<AtomicBool>,
    ) -> Self {
        let wake = Arc::new(Notify::new());
        let metadata_asked = Arc::new(AtomicBool::new(false));
        let latest = Arc::new(Mutex::new(SyncState {
            state: "syncing",
            last_synced_at: None,
            message: None,
            code: None,
            progress: None,
            slowed: false,
        }));
        let watcher = tauri::async_runtime::spawn(watch_slowed(
            app.clone(),
            syncer.client().pacer().slowed(),
            latest.clone(),
        ));
        let task = tauri::async_runtime::spawn(sync_loop(
            app,
            syncer.clone(),
            wake.clone(),
            metadata_asked.clone(),
            latest.clone(),
            focused,
        ));
        Self {
            account,
            syncer,
            wake,
            metadata_asked,
            latest,
            task,
            watcher,
        }
    }

    /// The last sync state sent to the UI, for a window that just opened.
    pub fn sync_state(&self) -> SyncState {
        self.latest
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|e| e.into_inner().clone())
    }

    /// Runs a sync now instead of waiting for the next tick. With
    /// `metadata`, it also reads projects, cycles and people again, as when
    /// someone asks for Sync now after adding a team in Redmine.
    pub fn sync_now(&self, metadata: bool) {
        if metadata {
            self.metadata_asked.store(true, Ordering::Relaxed);
        }
        self.wake.notify_one();
    }

    pub fn stop(&self) {
        self.task.abort();
        self.watcher.abort();
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Tells the UI as soon as the server asks Redline to slow down, and when it
/// has caught up, without waiting for the sync pass to end.
async fn watch_slowed(
    app: AppHandle,
    mut slowed: tokio::sync::watch::Receiver<bool>,
    latest: Arc<Mutex<SyncState>>,
) {
    while slowed.changed().await.is_ok() {
        let now = *slowed.borrow_and_update();
        let state = match latest.lock() {
            Ok(mut slot) => {
                slot.slowed = now;
                slot.clone()
            }
            Err(_) => continue,
        };
        let _ = app.emit(EVENT_SYNC_STATE, state);
    }
}

/// Whether a sync pass also reads metadata: the first pass, every
/// [`METADATA_INTERVAL`], and when someone asked for it.
fn metadata_due(last: Option<Instant>, asked: bool) -> bool {
    asked || last.is_none_or(|t| t.elapsed() >= METADATA_INTERVAL)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Tells the UI the sync state and remembers it.
fn publish(app: &AppHandle, syncer: &Syncer, latest: &Mutex<SyncState>, mut state: SyncState) {
    state.slowed = syncer.client().pacer().is_slowed();
    if let Ok(mut slot) = latest.lock() {
        *slot = state.clone();
    }
    let _ = app.emit(EVENT_SYNC_STATE, state);
}

fn syncing(last_synced_at: Option<u64>, progress: Option<SyncCount>) -> SyncState {
    SyncState {
        state: "syncing",
        last_synced_at,
        message: None,
        code: None,
        progress,
        slowed: false,
    }
}

async fn sync_loop(
    app: AppHandle,
    syncer: Syncer,
    wake: Arc<Notify>,
    metadata_asked: Arc<AtomicBool>,
    latest: Arc<Mutex<SyncState>>,
    focused: Arc<AtomicBool>,
) {
    let mut last_metadata: Option<Instant> = None;
    let mut last_prune = Instant::now();
    let mut last_key_check = Instant::now();
    let mut last_synced_at: Option<u64> = None;
    // Projects whose cycles and people are still to read.
    let mut projects: VecDeque<u64> = VecDeque::new();
    // How far the first sync has got, while it fills the cache.
    let mut progress: Option<SyncCount> = None;

    loop {
        publish(
            &app,
            &syncer,
            &latest,
            syncing(last_synced_at, progress.clone()),
        );

        let result = async {
            let asked = metadata_asked.swap(false, Ordering::Relaxed);
            if metadata_due(last_metadata, asked) {
                // Teams, statuses and the like first: a handful of requests.
                // Each team's cycles and people follow a few at a time.
                let meta = syncer.sync_core_metadata().await?;
                last_metadata = Some(Instant::now());
                last_key_check = Instant::now();
                projects = projects_needing_details(&meta).into();
                let _ = app.emit(EVENT_METADATA_CHANGED, ());
            } else if last_key_check.elapsed() >= FOCUSED_INTERVAL {
                // Metadata reads the current user, which is what notices a
                // revoked key; between metadata refreshes, ask on its own,
                // though not on every pass while the cache fills.
                syncer.check_key().await?;
                last_key_check = Instant::now();
            }

            // Changes since the last pass, or the newest issues the first
            // time. Each page reaches the UI as it lands.
            let mut emit = |page: &redline_core::SyncProgress| {
                if !page.changed.is_empty() {
                    let _ = app.emit(
                        EVENT_ISSUES_CHANGED,
                        IssuesChanged {
                            changed: page.changed.clone(),
                            removed: Vec::new(),
                        },
                    );
                }
                if page.total > PROGRESS_FROM {
                    progress = Some(SyncCount {
                        fetched: page.fetched,
                        total: page.total,
                    });
                    publish(
                        &app,
                        &syncer,
                        &latest,
                        syncing(last_synced_at, progress.clone()),
                    );
                }
            };
            let report = syncer.sync_issues_paced(0, &mut emit).await?;

            // A few teams' cycles and people.
            if !projects.is_empty() {
                let batch: Vec<u64> = projects.iter().take(PROJECTS_PER_PASS).copied().collect();
                syncer.sync_project_details(&batch).await?;
                projects.drain(..batch.len());
                let _ = app.emit(EVENT_METADATA_CHANGED, ());
            }

            // A few pages of older issues.
            let report = if report.remaining {
                syncer
                    .sync_older_issues(OLDER_PAGES_PER_PASS, &mut emit)
                    .await?
            } else {
                report
            };
            if !report.remaining {
                progress = None;
            }

            if !report.remaining && last_prune.elapsed() >= PRUNE_INTERVAL {
                let removed = syncer.prune_deleted().await?;
                last_prune = Instant::now();
                if !removed.is_empty() {
                    let _ = app.emit(
                        EVENT_ISSUES_CHANGED,
                        IssuesChanged {
                            changed: Vec::new(),
                            removed,
                        },
                    );
                }
            }
            Ok::<_, Error>(report.remaining || !projects.is_empty())
        }
        .await;

        let (state, wait) = match result {
            Ok(more) => {
                last_synced_at = Some(now_ms());
                if more {
                    // Still filling the cache: say so, and carry on soon.
                    (
                        syncing(last_synced_at, progress.clone()),
                        Some(CATCH_UP_WAIT),
                    )
                } else {
                    (
                        SyncState {
                            state: "idle",
                            last_synced_at,
                            message: None,
                            code: None,
                            progress: None,
                            slowed: false,
                        },
                        None,
                    )
                }
            }
            Err(Error::Busy) => (
                SyncState {
                    state: "busy",
                    last_synced_at,
                    message: None,
                    code: Some(Error::Busy.code()),
                    progress: None,
                    slowed: false,
                },
                Some(BUSY_WAIT),
            ),
            Err(e @ Error::Network(_)) => (
                SyncState {
                    state: "offline",
                    last_synced_at,
                    message: Some(e.to_string()),
                    code: Some(e.code()),
                    progress: None,
                    slowed: false,
                },
                None,
            ),
            Err(e) => (
                SyncState {
                    state: "error",
                    last_synced_at,
                    message: Some(e.to_string()),
                    code: Some(e.code()),
                    progress: None,
                    slowed: false,
                },
                None,
            ),
        };
        publish(&app, &syncer, &latest, state);

        let wait = wait.unwrap_or(if focused.load(Ordering::Relaxed) {
            FOCUSED_INTERVAL
        } else {
            BACKGROUND_INTERVAL
        });
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = wake.notified() => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_comes_first_then_on_a_schedule_or_when_asked() {
        assert!(metadata_due(None, false));
        let just_now = Instant::now();
        assert!(!metadata_due(Some(just_now), false));
        assert!(metadata_due(Some(just_now), true));
        if let Some(long_ago) = Instant::now().checked_sub(METADATA_INTERVAL) {
            assert!(metadata_due(Some(long_ago), false));
        }
    }
}
