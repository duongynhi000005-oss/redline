//! A signed-in session: the account, its cache, and the background sync loop
//! that keeps the cache fresh and tells the UI what changed.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use redline_core::{Error, Syncer};
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

/// Show a count while syncing when there are more issues than this to read.
const PROGRESS_FROM: u64 = 500;

pub const EVENT_SYNC_STATE: &str = "sync-state";
pub const EVENT_ISSUES_CHANGED: &str = "issues-changed";
pub const EVENT_METADATA_CHANGED: &str = "metadata-changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    /// "syncing", "idle", "offline" or "error".
    pub state: &'static str,
    /// Milliseconds since the epoch of the last successful sync.
    pub last_synced_at: Option<u64>,
    pub message: Option<String>,
    /// What went wrong, in the codes UI errors use (for example
    /// "unauthorized"), so the UI can offer more than trying again.
    pub code: Option<&'static str>,
    /// How far a long sync has got, while it runs.
    pub progress: Option<SyncCount>,
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
    latest: Arc<Mutex<SyncState>>,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl Session {
    pub fn start(
        app: AppHandle,
        account: Account,
        syncer: Syncer,
        focused: Arc<AtomicBool>,
    ) -> Self {
        let wake = Arc::new(Notify::new());
        let latest = Arc::new(Mutex::new(SyncState {
            state: "syncing",
            last_synced_at: None,
            message: None,
            code: None,
            progress: None,
        }));
        let task = tauri::async_runtime::spawn(sync_loop(
            app,
            syncer.clone(),
            wake.clone(),
            latest.clone(),
            focused,
        ));
        Self {
            account,
            syncer,
            wake,
            latest,
            task,
        }
    }

    /// The last sync state sent to the UI, for a window that just opened.
    pub fn sync_state(&self) -> SyncState {
        self.latest
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|e| e.into_inner().clone())
    }

    /// Runs a sync now instead of waiting for the next tick.
    pub fn sync_now(&self) {
        self.wake.notify_one();
    }

    pub fn stop(&self) {
        self.task.abort();
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Tells the UI the sync state and remembers it.
fn publish(app: &AppHandle, latest: &Mutex<SyncState>, state: SyncState) {
    if let Ok(mut slot) = latest.lock() {
        *slot = state.clone();
    }
    let _ = app.emit(EVENT_SYNC_STATE, state);
}

async fn sync_loop(
    app: AppHandle,
    syncer: Syncer,
    wake: Arc<Notify>,
    latest: Arc<Mutex<SyncState>>,
    focused: Arc<AtomicBool>,
) {
    let mut last_metadata: Option<Instant> = None;
    let mut last_prune = Instant::now();
    let mut last_synced_at: Option<u64> = None;

    loop {
        publish(
            &app,
            &latest,
            SyncState {
                state: "syncing",
                last_synced_at,
                message: None,
                code: None,
                progress: None,
            },
        );

        let result = async {
            if last_metadata.is_none_or(|t| t.elapsed() >= METADATA_INTERVAL) {
                syncer.sync_metadata().await?;
                last_metadata = Some(Instant::now());
                let _ = app.emit(EVENT_METADATA_CHANGED, ());
            } else {
                // Metadata reads the current user, which is what notices a
                // revoked key; between metadata refreshes, ask on its own.
                syncer.check_key().await?;
            }
            // Each page reaches the UI as it lands, so a long first sync
            // fills the lists as it goes instead of all at the end.
            syncer
                .sync_issues_with(|page| {
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
                        publish(
                            &app,
                            &latest,
                            SyncState {
                                state: "syncing",
                                last_synced_at,
                                message: None,
                                code: None,
                                progress: Some(SyncCount {
                                    fetched: page.fetched,
                                    total: page.total,
                                }),
                            },
                        );
                    }
                })
                .await?;
            if last_prune.elapsed() >= PRUNE_INTERVAL {
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
            Ok::<_, Error>(())
        }
        .await;

        let state = match result {
            Ok(()) => {
                last_synced_at = Some(now_ms());
                SyncState {
                    state: "idle",
                    last_synced_at,
                    message: None,
                    code: None,
                    progress: None,
                }
            }
            Err(e @ Error::Network(_)) => SyncState {
                state: "offline",
                last_synced_at,
                message: Some(e.to_string()),
                code: Some(e.code()),
                progress: None,
            },
            Err(e) => SyncState {
                state: "error",
                last_synced_at,
                message: Some(e.to_string()),
                code: Some(e.code()),
                progress: None,
            },
        };
        publish(&app, &latest, state);

        let wait = if focused.load(Ordering::Relaxed) {
            FOCUSED_INTERVAL
        } else {
            BACKGROUND_INTERVAL
        };
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = wake.notified() => {}
        }
    }
}
