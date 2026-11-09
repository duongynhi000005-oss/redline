# 0004: Native window materials and floating panels

- Status: Accepted
- Date: 2026-11-09

## Context

Redline should feel like a first-class app on each platform, in the spirit of
the Claude desktop app: a translucent, blurred window with content in panels
floating over it. On macOS 26 Apple's Liquid Glass is the system look; earlier
macOS versions use vibrancy materials. Windows 11 uses Mica; Windows 10 has
nothing comparable that stays fast and readable.

Tauri 2.12 ships `window-vibrancy` 0.8, which can apply Liquid Glass
(`NSGlassEffectView`), macOS vibrancy (`NSVisualEffectView`) and Windows 11
Mica to a window.

## Decision

- The window is transparent on macOS and Windows, and the shell applies the best
  backdrop it can at startup:
  - macOS 26 and later: Liquid Glass (regular).
  - Earlier macOS: the Sidebar vibrancy material, dimming when the window is
    inactive.
  - Windows 11: Mica, following the system's light or dark setting.
  - Windows 10 and Linux: none.
- The shell reports which one it applied (`app_info().material`), and the UI
  sets `data-material` on the root element. The sidebar is transparent only
  when a material is in place; otherwise every surface is painted solid, so a
  window can never end up see-through.
- Each view (issue list, issue detail, inbox, cycles) is a rounded panel
  floating over the sidebar's backdrop, on every platform.
- Menus and dialogs (command menu, pickers, filters, Display, Settings, new
  issue, toasts) are translucent with an in-page blur, where the web view
  supports `backdrop-filter`.
- Accessibility settings win: Reduce transparency and Increase contrast (and
  Windows contrast themes) give solid panels. The system materials already turn
  solid on their own when transparency is reduced.

## Consequences

- Transparent windows on macOS need Tauri's `macos-private-api` feature, which
  rules out the Mac App Store. Redline is distributed directly, so that's
  acceptable; revisit if App Store distribution is ever wanted.
- The materials can only be checked on real macOS and Windows machines. CI
  builds them but can't see them, so UI PRs touching these surfaces need
  screenshots from a Mac or Windows PC when possible.
- The Windows title bar stays native, so Snap layouts and the system menu keep
  working; Mica tints it to match.
- If a material misbehaves on some OS version, removing it is a one-line change
  in `src-tauri/src/material.rs`; the UI falls back to solid panels by itself.
