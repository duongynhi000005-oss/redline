//! A signed-in session: the account, its cache, and a quiet background loop
//! that keeps what's on screen current.
//!
//! Views read their issues from Redmine as they open, the way Redmine's own
//! pages do. In the background each pass asks for one page of issues
//! changed since the last pass, which reaches the UI as an issues-changed
//! event, and now and then for the metadata again. That's a request or two
//! every [`FOCUSED_INTERVAL`] while Redline is in front.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use redline_core::models::Issue;
use redline_core::{Error, Syncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use crate::account::Account;

/// Poll for changed issues this often while Redline is in front.
const FOCUSED_INTERVAL: Duration = Duration::from_secs(45);
/// And this often while it's in the background.
const BACKGROUND_INTERVAL: Duration = Duration::from_secs(5 * 60);
/// Refresh projects, statuses, and the cycles and people of open teams this often.
const METADATA_INTERVAL: Duration = Duration::from_secs(30 * 60);
/// Check the API key still works this often, between metadata refreshes.
const KEY_CHECK_INTERVAL: Duration = Duration::from_secs(5 * 60);
/// After the server stayed busy through every retry, wait this long.
const BUSY_WAIT: Duration = Duration::from_secs(30);

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
    /// True while the server has asked Redline to slow down.
    pub slowed: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuesChanged {
    pub changed: Vec<u64>,
    pub removed: Vec<u64>,
    /// The changed issues themselves, when Redline just read them, so the
    /// UI needn't ask again.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub issues: Vec<Issue>,
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

fn syncing(last_synced_at: Option<u64>) -> SyncState {
    SyncState {
        state: "syncing",
        last_synced_at,
        message: None,
        code: None,
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
    let mut last_key_check = Instant::now();
    let mut last_synced_at: Option<u64> = None;

    loop {
        publish(&app, &syncer, &latest, syncing(last_synced_at));

        let result = async {
            let asked = metadata_asked.swap(false, Ordering::Relaxed);
            if metadata_due(last_metadata, asked) {
                // Teams, statuses and the like, then the cycles and people of
                // the user's own teams and of those opened this session.
                syncer.sync_metadata().await?;
                last_metadata = Some(Instant::now());
                last_key_check = Instant::now();
                let _ = app.emit(EVENT_METADATA_CHANGED, ());
            } else if last_key_check.elapsed() >= KEY_CHECK_INTERVAL {
                // Metadata reads the current user, which is what notices a
                // revoked key; between metadata refreshes, ask on its own.
                syncer.check_key().await?;
                last_key_check = Instant::now();
            }

            // What changed since the last pass: one page, newest first.
            let changed = syncer.poll_changes().await?;
            if !changed.is_empty() {
                let _ = app.emit(
                    EVENT_ISSUES_CHANGED,
                    IssuesChanged {
                        changed: changed.iter().map(|i| i.id).collect(),
                        removed: Vec::new(),
                        issues: changed,
                    },
                );
            }
            Ok::<_, Error>(())
        }
        .await;

        let (state, wait) = match result {
            Ok(()) => {
                last_synced_at = Some(now_ms());
                (
                    SyncState {
                        state: "idle",
                        last_synced_at,
                        message: None,
                        code: None,
                        slowed: false,
                    },
                    None,
                )
            }
            Err(Error::Busy) => (
                SyncState {
                    state: "busy",
                    last_synced_at,
                    message: None,
                    code: Some(Error::Busy.code()),
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
