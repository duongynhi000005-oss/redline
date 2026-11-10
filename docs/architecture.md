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
                                  │ HTTPS, X-Redmine-API-Key (+ optional
                                  │ username and custom headers for a proxy)
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

1. **Any Redmine 6.1 or later.** No admin key, no plugins, no single team's
   setup. Read statuses, trackers and custom fields from the API, and detect
   what the server supports at runtime. Older Redmine releases aren't
   supported (see ADR 0005).
2. **Be gentle with the server.** Few requests, pages of 100, and only the
   fields an edit changes. Every request goes through the server's pacer
   (`crates/redline-core/src/pacer.rs`): two at a time and two a second by
   default (a per-server setting under Advanced), what someone is waiting on
   ahead of background work, and when the server says to slow down (429,
   420, 503, 509, or any refusal with `Retry-After`) every request pauses
   for `Retry-After` or a backoff with jitter, then the pace halves and
   recovers slowly. Redline never pulls every issue; see Loading.
3. **Keyboard first and native.** Every action has a shortcut that uses Cmd on
   macOS and Ctrl on Windows, real menus, and the system font and theme.

## Loading

Redline asks for what's on screen, the way Redmine's own pages do, and
never copies every issue.

- **Metadata** (projects, statuses, trackers, priorities, roles, saved
  queries) loads at sign-in and every 30 minutes. Versions, members and
  categories load for the projects the user is a member of, and for any
  other project when it's opened.
- **Lists** are Redmine issue-list queries (`src/lib/issueFilter.ts`,
  `IssueFilter` in `client.rs`): the view's project, tab, filters and sort,
  100 at a time, with the next page read as the list scrolls. Filters Redmine
  can't express (labels on some fields) also filter what arrives.
- **Counts** (cycle progress, open issues on a team page, a person's
  assigned issues) are one small request each (`src/state/counts.ts`), read
  again when shown after a change or after five minutes.
- **Search** in the command menu and the relation picker asks Redmine once
  typing pauses (`src/state/search.ts`); issues already loaded show at once.
- **Details** (comments, history, sub-issues) load when an issue opens, and
  connected issues load if they're not already known.
- **Changes**: every few minutes, one page of the issues changed since the
  last look (`poll_changes` in `sync.rs`), so open lists and issues stay
  current.
- **The cache** (`store.rs`) keeps metadata and the 500 most recently opened,
  created or changed issues with their comments, for a quick start and for
  reading offline. Lists aren't kept.
