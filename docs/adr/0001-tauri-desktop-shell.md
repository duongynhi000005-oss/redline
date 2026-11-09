# 0001: Tauri 2 as the desktop shell

- Status: Accepted
- Date: 2026-11-09

## Context

Redline should feel native on macOS and Windows, look like Linear, and stay
small and fast. Linear's own desktop app is Electron, which tells us its
signature pieces (command palette, virtualized lists, a rich markdown editor)
are best served by web technology.

We compared Tauri 2, Electron and Avalonia 12 (all C#).

## Decision

Use Tauri 2 with a TypeScript UI and a Rust backend.

- It uses the operating system's own web view (WKWebView on macOS, WebView2 on
  Windows), so installers are small and memory use is low.
- It has native menus, window controls, the OS keychain through crates, signed
  installers and an updater.
- The web UI lets us use mature libraries for the Linear-style pieces.

Avalonia 12 was the runner-up. Electron stays the fallback if web view
differences become too costly.

## Consequences

- Two browser engines. Everything has to work on WebKit and on Chromium. CI
  builds on `macos-latest` and `windows-latest` from day one, and UI changes
  are checked on both (see CONTRIBUTING).
- Native features (menus, keychain, file system, HTTP) are done in Rust and
  exposed to the UI as Tauri commands.
