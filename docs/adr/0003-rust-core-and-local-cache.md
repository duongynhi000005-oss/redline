# 0003: Redmine access, cache and sync in a Rust core crate

- Status: Accepted
- Date: 2026-11-09

## Context

Redline works with any Redmine server through its REST API, using the
signed-in person's own API key, without admin rights or plugins. Redmine sends
no CORS headers, so the web view can't call it directly. Redmine also has no
push API, and a list request returns at most 100 issues, so a fast UI needs a
local copy of the data.

## Decision

- All Redmine HTTP, the local cache and the sync engine live in
  `crates/redline-core`, a Rust library with no Tauri or UI dependency.
- The cache is a SQLite database per Redmine server, in the app's data folder.
  It is the source of truth for every screen.
- Sync is pull-based: metadata now and then, and an issue delta on an
  `updated_on` cursor while the window is in focus, then journals per changed
  issue when they're needed.
- Edits apply to the cache at once, then go to Redmine with only the changed
  fields. If Redmine refuses an edit (for example a 422 from a workflow rule),
  the cache is rolled back and Redmine's message is shown.
- The API key is stored in the OS keychain (macOS Keychain, Windows Credential
  Manager), never in the web view or on disk.
- `src-tauri/` wraps the core in Tauri commands and sends change events to
  the UI.

## Consequences

- The core can be unit-tested with a mock server and integration-tested against
  the official Redmine Docker image on any CI runner, without building the app.
- The UI never holds the API key and never talks to the network.
- The UI is fast because it reads from a local store, but data can be a sync
  interval behind the server. The UI shows when it last synced.
