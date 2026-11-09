# How Redline works

Redline is a desktop client for any Redmine server, in the style of Linear.
This page is a map of the code. The reasons behind it are in
[the ADRs](adr/README.md).

```
┌──────────────────────────── Redline app ────────────────────────────┐
│  UI (src/, React + TypeScript)                                      │
│    screens, command palette, keyboard shortcuts, store              │
│                 ▲ events                │ commands                  │
│                 │                       ▼                           │
│  Shell (src-tauri/, Rust)                                           │
│    window, menus, keychain, Tauri commands and events               │
│                 ▲                       │                           │
│                 │                       ▼                           │
│  Core (crates/redline-core/, Rust)                                  │
│    Redmine REST client · SQLite cache · sync engine · outbox        │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ HTTPS, X-Redmine-API-Key
                                  ▼
                            Redmine server
```

## How Redmine's model becomes Linear's

| Redline shows | From Redmine |
| --- | --- |
| Workspace | One Redmine server and the signed-in user |
| Team | A top-level project (subprojects are sub-teams) |
| Issue id | Redmine's global id, shown as `#123` |
| Status category (Backlog, Started, Done...) | A per-server map of Redmine statuses, with defaults from each status's open or closed flag |
| Priority | Redmine's priority list, mapped to icons by position |
| Labels | The list custom fields picked in settings, shown as label groups |
| Cycle | A project version (teams use versions as sprints) |
| Project | A parent issue, such as an epic |
| Comments and history | Journals |
| Inbox | Built locally from journals on issues you're assigned to, authored, watch or are mentioned in |

The full comparison, with Redmine API details and version notes, is in the
design doc
[Redline: Redmine to Linear model map](https://claude.ai/artifact/Dr5orR446TNABYoUBbTQdB).

## Rules every change follows

1. **Any Redmine.** No admin key, no plugins, no single team's setup. Read
   statuses, trackers and custom fields from the API, and detect what the server
   supports at runtime.
2. **Be gentle with the server.** Few requests, pages of 100, a small
   concurrency limit, back off on 429 and 503, and only send the fields an
   edit changes.
3. **Keyboard first and native.** Every action has a shortcut that uses Cmd on
   macOS and Ctrl on Windows, real menus, and the system font and theme.
