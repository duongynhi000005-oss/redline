//! A signed-in session: the account, its cache, and the background sync loop
//! that keeps the cache fresh and tells the UI what changed.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
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
        let task =
            tauri::async_runtime::spawn(sync_loop(app, syncer.clone(), wake.clone(), focused));
        Self {
            account,
            syncer,
            wake,
            task,
        }
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

async fn sync_loop(app: AppHandle, syncer: Syncer, wake: Arc<Notify>, focused: Arc<AtomicBool>) {
    let mut last_metadata: Option<Instant> = None;
    let mut last_prune = Instant::now();
    let mut last_synced_at: Option<u64> = None;

    loop {
        let _ = app.emit(
            EVENT_SYNC_STATE,
            SyncState {
                state: "syncing",
                last_synced_at,
                message: None,
            },
        );

        let result = async {
            if last_metadata.is_none_or(|t| t.elapsed() >= METADATA_INTERVAL) {
                syncer.sync_metadata().await?;
                last_metadata = Some(Instant::now());
                let _ = app.emit(EVENT_METADATA_CHANGED, ());
            }
            let report = syncer.sync_issues().await?;
            let mut removed = Vec::new();
            if last_prune.elapsed() >= PRUNE_INTERVAL {
                removed = syncer.prune_deleted().await?;
                last_prune = Instant::now();
            }
            if !report.changed.is_empty() || !removed.is_empty() {
                let _ = app.emit(
                    EVENT_ISSUES_CHANGED,
                    IssuesChanged {
                        changed: report.changed,
                        removed,
                    },
                );
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
                }
            }
            Err(e @ Error::Network(_)) => SyncState {
                state: "offline",
                last_synced_at,
                message: Some(e.to_string()),
            },
            Err(e) => SyncState {
                state: "error",
                last_synced_at,
                message: Some(e.to_string()),
            },
        };
        let _ = app.emit(EVENT_SYNC_STATE, state);

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
