//! The commands the UI calls. Each returns data from the local cache where it
//! can, and errors as `{ code, message }` the UI can show as they are.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use redline_core::models::{Issue, IssueChanges};
use redline_core::{Client, Error, IssueDetails, Metadata, Store, Syncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::RwLock;

use crate::account::{self, Account};
use crate::session::{EVENT_ISSUES_CHANGED, IssuesChanged, Session, SyncState};

#[derive(Default)]
pub struct AppState {
    pub session: RwLock<Option<Session>>,
    pub focused: Arc<AtomicBool>,
}

/// An error the UI can show.
#[derive(Debug, Serialize)]
pub struct UiError {
    pub code: String,
    pub message: String,
}

impl From<Error> for UiError {
    fn from(e: Error) -> Self {
        Self {
            code: e.code().into(),
            message: e.to_string(),
        }
    }
}

impl UiError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn signed_out() -> Self {
        Self::new("signed_out", "You're signed out.")
    }
}

type CmdResult<T> = Result<T, UiError>;

fn config_dir(app: &AppHandle) -> CmdResult<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| UiError::new("storage", e.to_string()))
}

fn open_store(app: &AppHandle, account: &Account) -> CmdResult<Store> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| UiError::new("storage", e.to_string()))?
        .join("cache");
    let path = dir.join(account.cache_file_name());
    match Store::open(&path) {
        Ok(store) => Ok(store),
        // A cache from a newer Redline or a damaged file: start over. The
        // server has everything.
        Err(_) => {
            let _ = std::fs::remove_file(&path);
            Ok(Store::open(&path)?)
        }
    }
}

/// Starts a session for an account whose key is in the keychain. Called at
/// launch.
pub async fn resume(app: &AppHandle, state: &AppState) -> Option<Account> {
    let dir = config_dir(app).ok()?;
    let account = account::load(&dir)?;
    let key = account.load_key().ok()?;
    let client = Client::new(&account.server_url, &key).ok()?;
    let store = open_store(app, &account).ok()?;
    let session = Session::start(
        app.clone(),
        account.clone(),
        Syncer::new(client, store),
        state.focused.clone(),
    );
    *state.session.write().await = Some(session);
    Some(account)
}

#[tauri::command]
pub async fn get_account(state: State<'_, AppState>) -> CmdResult<Option<Account>> {
    Ok(state
        .session
        .read()
        .await
        .as_ref()
        .map(|s| s.account.clone()))
}

/// Checks the server and key, saves them, and starts syncing.
#[tauri::command]
pub async fn sign_in(
    app: AppHandle,
    state: State<'_, AppState>,
    server_url: String,
    api_key: String,
) -> CmdResult<Account> {
    if api_key.trim().is_empty() {
        return Err(UiError::new("unauthorized", "Paste your Redmine API key."));
    }
    let client = Client::new(&server_url, &api_key)?;
    let user = client.current_user().await?;
    let account = Account {
        server_url: client.server_url().to_string(),
        user_id: user.id,
        login: user.login.clone(),
        name: user.display_name(),
    };
    account
        .save_key(api_key.trim())
        .map_err(|m| UiError::new("keychain", m))?;
    account::save(&config_dir(&app)?, &account).map_err(|m| UiError::new("storage", m))?;

    let store = open_store(&app, &account)?;
    let session = Session::start(
        app.clone(),
        account.clone(),
        Syncer::new(client, store),
        state.focused.clone(),
    );
    if let Some(old) = state.session.write().await.replace(session) {
        old.stop();
    }
    Ok(account)
}

/// Stops syncing, removes the key from the keychain and forgets the account.
/// The cache stays on disk so signing back in is fast.
#[tauri::command]
pub async fn sign_out(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    if let Some(session) = state.session.write().await.take() {
        session.stop();
        session.account.delete_key();
    }
    account::forget(&config_dir(&app)?);
    Ok(())
}

async fn with_syncer<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Syncer) -> CmdResult<T>,
) -> CmdResult<T> {
    let guard = state.session.read().await;
    let session = guard.as_ref().ok_or_else(UiError::signed_out)?;
    f(&session.syncer)
}

async fn syncer(state: &State<'_, AppState>) -> CmdResult<Syncer> {
    with_syncer(state, |s| Ok(s.clone())).await
}

#[tauri::command]
pub async fn get_metadata(state: State<'_, AppState>) -> CmdResult<Metadata> {
    with_syncer(&state, |s| Ok(s.store().metadata()?)).await
}

#[tauri::command]
pub async fn list_issues(state: State<'_, AppState>) -> CmdResult<Vec<Issue>> {
    with_syncer(&state, |s| Ok(s.store().issues()?)).await
}

#[tauri::command]
pub async fn get_issues(state: State<'_, AppState>, ids: Vec<u64>) -> CmdResult<Vec<Issue>> {
    with_syncer(&state, |s| {
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(issue) = s.store().issue(id)? {
                out.push(issue);
            }
        }
        Ok(out)
    })
    .await
}

/// Cached details when they're current; otherwise fetched from Redmine.
#[tauri::command]
pub async fn get_issue_details(
    state: State<'_, AppState>,
    id: u64,
    refresh: Option<bool>,
) -> CmdResult<IssueDetails> {
    let syncer = syncer(&state).await?;
    if !refresh.unwrap_or(false)
        && let Some(cached) = syncer.cached_issue_details(id)?
    {
        return Ok(cached);
    }
    match syncer.issue_details(id).await {
        Ok(details) => Ok(details),
        // Offline: show what we have.
        Err(Error::Network(msg)) => match syncer.store().issue(id)? {
            Some(issue) => Ok(IssueDetails {
                journals: syncer
                    .store()
                    .journals(id)?
                    .map(|(_, j)| j)
                    .unwrap_or_default(),
                issue,
                allowed_statuses: None,
            }),
            None => Err(Error::Network(msg).into()),
        },
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn get_sync_state(state: State<'_, AppState>) -> CmdResult<Option<SyncState>> {
    Ok(state.session.read().await.as_ref().map(|s| s.sync_state()))
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> CmdResult<()> {
    let guard = state.session.read().await;
    guard.as_ref().ok_or_else(UiError::signed_out)?.sync_now();
    Ok(())
}

/// Sends a change to Redmine, then refreshes the issue from the server.
#[tauri::command]
pub async fn update_issue(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u64,
    changes: IssueChanges,
) -> CmdResult<IssueDetails> {
    let syncer = syncer(&state).await?;
    syncer.client().update_issue(id, &changes).await?;
    let details = syncer.issue_details(id).await?;
    let _ = app.emit(
        EVENT_ISSUES_CHANGED,
        IssuesChanged {
            changed: vec![id],
            removed: vec![],
        },
    );
    Ok(details)
}

#[tauri::command]
pub async fn create_issue(
    app: AppHandle,
    state: State<'_, AppState>,
    fields: IssueChanges,
) -> CmdResult<Issue> {
    let syncer = syncer(&state).await?;
    let issue = syncer.client().create_issue(&fields).await?;
    syncer.store().upsert_issues(std::slice::from_ref(&issue))?;
    let _ = app.emit(
        EVENT_ISSUES_CHANGED,
        IssuesChanged {
            changed: vec![issue.id],
            removed: vec![],
        },
    );
    Ok(issue)
}
