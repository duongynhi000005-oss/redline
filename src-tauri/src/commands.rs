//! The commands the UI calls. Each returns data from the local cache where it
//! can, and errors as `{ code, message }` the UI can show as they are.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use redline_core::models::{Issue, IssueChanges, NewRelation, Relation};
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
                watching: None,
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

fn emit_changed(app: &AppHandle, changed: Vec<u64>) {
    if !changed.is_empty() {
        let _ = app.emit(
            EVENT_ISSUES_CHANGED,
            IssuesChanged {
                changed,
                removed: vec![],
            },
        );
    }
}

/// Adds or removes an issue's watcher in Redmine, then re-reads the issue.
#[tauri::command]
pub async fn set_watcher(
    app: AppHandle,
    state: State<'_, AppState>,
    issue_id: u64,
    user_id: u64,
    watching: bool,
) -> CmdResult<IssueDetails> {
    let syncer = syncer(&state).await?;
    let details = syncer.set_watcher(issue_id, user_id, watching).await?;
    emit_changed(&app, vec![issue_id]);
    Ok(details)
}

/// Opens a page of the signed-in Redmine in the browser, such as
/// `issues/12`. Only paths on that server, so nothing else can be opened.
#[tauri::command]
pub async fn open_in_redmine(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;

    let ok = !path.is_empty()
        && !path.contains("..")
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.' | '#'));
    if !ok {
        return Err(UiError::new(
            "invalid",
            "That isn't a Redmine page Redline can open.",
        ));
    }
    let base = {
        let guard = state.session.read().await;
        let session = guard.as_ref().ok_or_else(UiError::signed_out)?;
        session.account.server_url.clone()
    };
    let url = format!("{base}{}", path.trim_start_matches('/'));
    app.opener().open_url(&url, None::<&str>).map_err(|_| {
        UiError::new(
            "browser",
            format!("Couldn't open your browser. The page is {url}"),
        )
    })
}

/// Relates two issues in Redmine and refreshes both in the cache.
#[tauri::command]
pub async fn add_relation(
    app: AppHandle,
    state: State<'_, AppState>,
    issue_id: u64,
    relation: NewRelation,
) -> CmdResult<Relation> {
    let syncer = syncer(&state).await?;
    let (created, changed) = syncer.add_relation(issue_id, &relation).await?;
    emit_changed(&app, changed);
    Ok(created)
}

/// Removes a relation in Redmine and refreshes both issues.
#[tauri::command]
pub async fn remove_relation(
    app: AppHandle,
    state: State<'_, AppState>,
    relation: Relation,
) -> CmdResult<()> {
    let syncer = syncer(&state).await?;
    let changed = syncer.remove_relation(&relation).await?;
    emit_changed(&app, changed);
    Ok(())
}

/// Ids of issues whose description or comments mention this one.
#[tauri::command]
pub async fn find_mentions(state: State<'_, AppState>, id: u64) -> CmdResult<Vec<u64>> {
    let syncer = syncer(&state).await?;
    Ok(syncer.mentions_of(id).await?)
}

// ----- Time ---------------------------------------------------------------

/// Time entries, read from Redmine each time (they aren't cached).
#[tauri::command]
pub async fn time_entries(
    state: State<'_, AppState>,
    query: redline_core::TimeQuery,
) -> CmdResult<Vec<redline_core::models::TimeEntry>> {
    Ok(syncer(&state).await?.client().time_entries(&query).await?)
}

#[tauri::command]
pub async fn log_time(
    app: AppHandle,
    state: State<'_, AppState>,
    entry: redline_core::models::TimeEntryChanges,
) -> CmdResult<redline_core::models::TimeEntry> {
    let created = syncer(&state).await?.log_time(&entry).await?;
    emit_changed(&app, created.issue.iter().map(|i| i.id).collect());
    Ok(created)
}

#[tauri::command]
pub async fn update_time_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u64,
    changes: redline_core::models::TimeEntryChanges,
) -> CmdResult<redline_core::models::TimeEntry> {
    let changed = syncer(&state)
        .await?
        .update_time_entry(id, &changes)
        .await?;
    let mut issues: Vec<u64> = changed.issue.iter().map(|i| i.id).collect();
    issues.extend(changes.issue_id);
    issues.dedup();
    emit_changed(&app, issues);
    Ok(changed)
}

#[tauri::command]
pub async fn delete_time_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u64,
) -> CmdResult<()> {
    let issue = syncer(&state).await?.delete_time_entry(id).await?;
    emit_changed(&app, issue.into_iter().collect());
    Ok(())
}

// ----- Attachments --------------------------------------------------------

/// Redmine's attachments never change, so each is cached on disk by id, per
/// account, and read from there next time.
async fn attachment_cache(
    app: &AppHandle,
    state: &State<'_, AppState>,
) -> CmdResult<std::path::PathBuf> {
    let name = {
        let guard = state.session.read().await;
        let session = guard.as_ref().ok_or_else(UiError::signed_out)?;
        format!("{}.files", session.account.cache_file_name())
    };
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| UiError::new("storage", e.to_string()))?
        .join("attachments")
        .join(name))
}

async fn attachment_bytes(
    app: &AppHandle,
    state: &State<'_, AppState>,
    id: u64,
) -> CmdResult<Vec<u8>> {
    let path = attachment_cache(app, state).await?.join(id.to_string());
    if let Ok(bytes) = tokio::fs::read(&path).await {
        return Ok(bytes);
    }
    let bytes = syncer(state)
        .await?
        .client()
        .download_attachment(id)
        .await?;
    // A failed write only means downloading again next time.
    if let Some(dir) = path.parent() {
        if tokio::fs::create_dir_all(dir).await.is_ok() {
            let partial = path.with_extension("part");
            if tokio::fs::write(&partial, &bytes).await.is_ok() {
                let _ = tokio::fs::rename(&partial, &path).await;
            }
        }
    }
    Ok(bytes)
}

/// An attachment's content, as raw bytes for a preview.
#[tauri::command]
pub async fn attachment_data(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u64,
) -> CmdResult<tauri::ipc::Response> {
    Ok(tauri::ipc::Response::new(
        attachment_bytes(&app, &state, id).await?,
    ))
}

/// Asks where to save an attachment and saves it there. False when the
/// person cancels.
#[tauri::command]
pub async fn save_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u64,
    filename: String,
) -> CmdResult<bool> {
    use tauri_plugin_dialog::DialogExt;

    let name = safe_file_name(&filename);
    let dialog = app.dialog().file().set_file_name(&name);
    let Some(target) = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| UiError::new("dialog", e.to_string()))?
    else {
        return Ok(false);
    };
    let path = target
        .into_path()
        .map_err(|e| UiError::new("dialog", e.to_string()))?;
    let bytes = attachment_bytes(&app, &state, id).await?;
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|e| UiError::new("storage", format!("Couldn't save {name}: {e}")))?;
    Ok(true)
}

/// Asks for files to attach. Returns their paths, or none when cancelled.
#[tauri::command]
pub async fn pick_files(app: AppHandle) -> CmdResult<Vec<String>> {
    use tauri_plugin_dialog::DialogExt;

    let dialog = app.dialog().file();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_files())
        .await
        .map_err(|e| UiError::new("dialog", e.to_string()))?
        .unwrap_or_default();
    Ok(picked
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

/// Larger files than this aren't read into memory; Redmine's own limit is
/// usually far lower and it says so when a file is over it.
const MAX_ATTACHMENT_BYTES: u64 = 512 * 1024 * 1024;

/// Uploads files (dropped on the window or picked) and attaches them to an
/// issue, with an optional comment.
#[tauri::command]
pub async fn attach_files(
    app: AppHandle,
    state: State<'_, AppState>,
    issue_id: u64,
    paths: Vec<String>,
    notes: Option<String>,
) -> CmdResult<IssueDetails> {
    let mut files = Vec::with_capacity(paths.len());
    for path in paths {
        let path = std::path::PathBuf::from(path);
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let meta = tokio::fs::metadata(&path).await.ok();
        if name.is_empty() || !path.is_absolute() || !meta.as_ref().is_some_and(|m| m.is_file()) {
            return Err(UiError::new(
                "invalid",
                format!("{name} isn't a file Redline can attach."),
            ));
        }
        if meta.is_some_and(|m| m.len() > MAX_ATTACHMENT_BYTES) {
            return Err(UiError::new(
                "too_large",
                format!("{name} is too large to attach."),
            ));
        }
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| UiError::new("storage", format!("Couldn't read {name}: {e}")))?;
        files.push(redline_core::NewFile {
            filename: name,
            // Redmine works out the type from the name.
            content_type: None,
            bytes,
        });
    }
    let details = syncer(&state)
        .await?
        .attach_files(issue_id, files, notes)
        .await?;
    emit_changed(&app, vec![issue_id]);
    Ok(details)
}

#[tauri::command]
pub async fn delete_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
    issue_id: u64,
    attachment_id: u64,
) -> CmdResult<IssueDetails> {
    let details = syncer(&state)
        .await?
        .delete_attachment(issue_id, attachment_id)
        .await?;
    emit_changed(&app, vec![issue_id]);
    Ok(details)
}

/// A name that's safe to suggest in a save dialog: no folders, no
/// characters Windows or macOS reject.
fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() {
        "attachment".into()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod attachment_tests {
    use super::safe_file_name;

    #[test]
    fn suggested_names_have_no_folders_or_reserved_characters() {
        assert_eq!(safe_file_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_file_name("a:b?.png"), "a_b_.png");
        assert_eq!(safe_file_name("  "), "attachment");
        assert_eq!(safe_file_name("report.pdf"), "report.pdf");
    }
}
