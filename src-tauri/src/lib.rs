//! Redline's desktop shell: window, menus and the commands the UI calls.

mod account;
mod commands;
mod material;
mod menu;
mod session;

use std::sync::atomic::Ordering;

use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_window_state::StateFlags;

use commands::AppState;

/// Basic facts about the running app, shown in About and used by the UI to
/// pick platform conventions.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: &'static str,
    pub platform: &'static str,
    /// The window backdrop in use, so the UI can let it show through.
    pub material: material::Material,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: redline_core::VERSION,
        platform: std::env::consts::OS,
        material: material::current(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // A menu bar is part of a Mac app; Windows apps like this one don't have one.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build);

    builder
        // Reopen where the window was left, like other desktop apps.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    StateFlags::SIZE
                        | StateFlags::POSITION
                        | StateFlags::MAXIMIZED
                        | StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .on_menu_event(|app, event| {
            let _ = app.emit(menu::EVENT_MENU, event.id().as_ref());
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                material::apply(&window);
            }
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async {
                let state = handle.state::<AppState>();
                commands::resume(&handle, &state).await;
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(focused) = event {
                let state = window.state::<AppState>();
                state.focused.store(*focused, Ordering::Relaxed);
                if *focused {
                    // Coming back to Redline is a good moment to catch up.
                    if let Ok(guard) = state.session.try_read()
                        && let Some(session) = guard.as_ref()
                    {
                        session.sync_now();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            commands::get_account,
            commands::sign_in,
            commands::sign_out,
            commands::get_metadata,
            commands::list_issues,
            commands::get_issues,
            commands::get_issue_details,
            commands::get_sync_state,
            commands::sync_now,
            commands::update_issue,
            commands::create_issue,
            commands::add_relation,
            commands::set_watcher,
            commands::open_in_redmine,
            commands::open_homepage,
            commands::get_user,
            commands::create_project,
            commands::update_project,
            commands::set_project_closed,
            commands::delete_project,
            commands::remove_relation,
            commands::delete_issue,
            commands::update_comment,
            commands::find_mentions,
            commands::run_query,
            commands::search,
            commands::attachment_data,
            commands::save_attachment,
            commands::pick_files,
            commands::attach_files,
            commands::delete_attachment,
            commands::time_entries,
            commands::log_time,
            commands::update_time_entry,
            commands::delete_time_entry,
            commands::create_version,
            commands::update_version,
            commands::get_version,
            commands::delete_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Redline");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_version_and_platform() {
        let info = app_info();
        assert_eq!(info.version, redline_core::VERSION);
        assert!(!info.platform.is_empty());
    }
}
