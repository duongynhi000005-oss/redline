//! The macOS menu bar. Windows apps like Redline keep their commands in the
//! window (the command palette), so there the window has no menu bar.
//!
//! Items without a system role send their id to the UI as a `menu` event.

// Built on every platform so tests cover it, but only macOS shows it.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use tauri::menu::{AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub const EVENT_MENU: &str = "menu";

/// Menu ids the UI handles.
pub const NEW_ISSUE: &str = "new-issue";
pub const COMMAND_PALETTE: &str = "command-palette";
pub const MY_ISSUES: &str = "my-issues";
pub const SYNC_NOW: &str = "sync-now";
pub const SETTINGS: &str = "settings";
pub const SIGN_OUT: &str = "sign-out";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accelerator: Option<&str>| {
        let builder = MenuItemBuilder::with_id(id, text);
        match accelerator {
            Some(a) => builder.accelerator(a).build(app),
            None => builder.build(app),
        }
    };

    let about = AboutMetadataBuilder::new()
        .name(Some("Redline"))
        .version(Some(redline_core::VERSION))
        .comments(Some("A fast, keyboard-first client for Redmine."))
        .license(Some("Apache-2.0"))
        .build();

    let app_menu = SubmenuBuilder::new(app, "Redline")
        .about(Some(about))
        .separator()
        .item(&item(SETTINGS, "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&item(SIGN_OUT, "Sign Out", None)?)
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item(NEW_ISSUE, "New Issue", Some("CmdOrCtrl+N"))?)
        .separator()
        .close_window()
        .build()?;

    // Text fields need these to cut, copy and paste on macOS.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item(
            COMMAND_PALETTE,
            "Command Menu…",
            Some("CmdOrCtrl+K"),
        )?)
        .item(&item(MY_ISSUES, "My Issues", Some("CmdOrCtrl+Shift+M"))?)
        .separator()
        .item(&item(SYNC_NOW, "Sync Now", Some("CmdOrCtrl+R"))?)
        .separator()
        .fullscreen()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window])
        .build()
}
