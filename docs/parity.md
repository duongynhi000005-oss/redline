# Redmine parity

Everything a person can see in Redmine should have a place in Redline. This
page lists every user-facing area of Redmine, what its REST API allows with a
regular user's API key, where Redline shows it, and the GitHub issue that
builds it.

The API column was checked against Redmine 7.0.3's controllers
(`accept_api_auth`) and API views. Redline supports Redmine 6.1 and later
([ADR 0005](adr/0005-supported-redmine-versions.md)); nothing listed here is
newer than 6.1 unless it says so.

**Key:** ✅ in Redline today · 🟡 partly · ⬜ planned · 🌐 opens in the
browser, because Redmine has no API for it

## Issues

| Redmine | API with a user key | Redline | Where it lives |
| --- | --- | --- | --- |
| Issue list | `GET /issues.json`, 100 per page | ✅ | Every list, from the local cache |
| Issue views (list, board, Gantt, calendar) | No API for Gantt or calendar; both are built from issue dates | ✅ | View switcher on every list: List, Board (Kanban), Timeline, Calendar. #34, #36, #37 |
| Issue details | `GET /issues/:id.json` | ✅ | Issue view |
| Subject, description, status, priority, assignee, cycle (version) | `PUT /issues/:id.json` | ✅ | Issue view and pickers |
| Tracker, category, start date, due date, estimate, % done, private, parent | `PUT /issues/:id.json` | 🟡 shown, not all editable | Properties panel, editable. #42 |
| Custom fields (every format) | Values on the issue; definitions are admin-only, so formats are learned from values | 🟡 labels only | Label groups for list fields, a property row for the rest, editable. #42 |
| Status transitions | `include=allowed_statuses` | ✅ | Status picker and board drops |
| Comments (notes), private notes | `PUT /issues/:id.json` with `notes` | ✅ | Activity |
| Edit a comment | `PUT /journals/:id.json` | ⬜ | Comment menu. #42 |
| History (journal details) | `include=journals` | ✅ | Activity |
| Related issues (relates, duplicates, blocks, precedes, follows, copied) | `GET/POST /issues/:id/relations.json`, `DELETE /relations/:id.json`; `include=relations` on lists | ✅ | Related section on the issue, add and remove; blocked mark on rows and cards. Redmine doesn't change `updated_on` for relation changes, so other people's relation edits arrive when the issue is opened or on the six-hourly re-check. #35 |
| Mentions of other issues (`#123`) | Text in descriptions and notes; `GET /search.json` finds notes that mention an issue | ✅ | Related section: "Mentions" and "Mentioned in". #35 |
| Sub-issues and parent | `include=children`, `parent_issue_id` | ✅ | Sub-issues list with progress, parent link, set parent and add sub-issue. #35 |
| Watchers | `include=watchers`, `POST/DELETE /issues/:id/watchers.json` | ✅ | Subscribe button (Shift+S) and a Subscribers list on every issue. The API needs the role's add/delete watcher permissions even for yourself, so Redline reads the roles' permissions and, where the role lacks them, opens the issue in Redmine to watch it there. Whether you watch is read with `watcher_id=me` even when the list is hidden. #38 |
| Attachments | `include=attachments`, `POST /uploads.json`, `GET /attachments/download/:id`, `DELETE /attachments/:id.json` | ✅ | Tiles on the issue with image previews, save, delete, drop or pick files to upload (with a comment when dropped on the comment box). Inline images in descriptions and comments show the attachment. Files are cached on disk once read. #39 |
| Associated revisions | `include=changesets` | ⬜ | Commits on the issue. #48 |
| Spent time on an issue | `GET/POST/PUT/DELETE /time_entries.json` | ✅ | Spent property and a Time section on the issue: who logged what, when and as which activity, changed or deleted where the role allows. Log time with Cmd/Ctrl+Shift+T, typing 1.5, 1:30 or 1h 30m. #40 |
| Copy issue | No API | ⬜ | "Duplicate issue" creates a copy with the same fields and a "copied to" relation. #42 |
| Delete issue | `DELETE /issues/:id.json` (needs permission) | ⬜ | Issue menu, with confirmation. #42 |
| Bulk edit | No bulk API; one request per issue | ⬜ | Multi-select (X) then a picker, sent politely one by one. #43 |
| Reactions | UI since 6.1; no API before 7.1 | 🌐 | Shown when the server's API offers them. Not planned until 7.1 ships |

## Planning

| Redmine | API with a user key | Redline | Where it lives |
| --- | --- | --- | --- |
| Versions | `GET/POST/PUT/DELETE /projects/:id/versions.json` (writes need Manage versions) | 🟡 as cycles | Cycles, plus a version's details, notes and status; create and edit when allowed. #41 |
| Roadmap | No API; built from versions and their issues | ⬜ | Team > Roadmap: open versions with progress, then closed ones. #41 |
| Gantt | No API; built from start and due dates, parents and precedes/blocks relations | ✅ | Timeline view: bars from start to due date, drag to move or resize, arrows for precedes and blocks, three zoom levels. #36 |
| Calendar | No API; built from start and due dates | ✅ | Calendar view: a month of weeks with issues across their days, cycle ends, drag to reschedule, undated issues to drag on. #37 |
| Issue categories | `GET/POST/PUT/DELETE /projects/:id/issue_categories.json` | 🟡 cached, not shown | Category property, filter and grouping ("Component"). #42 |
| Saved queries | `GET /queries.json`, run with `query_id` | ⬜ | Sidebar > Views: each Redmine query as a list Redline fetches. #44 |
| Time tracking (spent time, reports) | `GET/POST/PUT/DELETE /time_entries.json`, activities from `/enumerations/time_entry_activities.json` | ✅ | Team > Time: this week, last week, this month or the last 30 days, a bar per day, entries grouped by day, person or issue with totals, and only your own on request. Redmine's report pivot (by custom field, CSV export) stays in Redmine for now. #40 |

## Projects and people

| Redmine | API with a user key | Redline | Where it lives |
| --- | --- | --- | --- |
| Projects (list, overview) | `GET /projects.json`, `GET /projects/:id.json` | 🟡 teams in the sidebar | Team overview: description, sub-teams, members, counts, modules. #45 |
| Create, close, archive a project | `POST/PUT /projects`, close and archive actions (permissions vary) | ⬜ | Team overview menu, when allowed. #45 |
| Members and roles | `GET /projects/:id/memberships.json`; writes need Manage members | 🟡 used for pickers | Team overview > Members. #45 |
| Users | `GET /users/:id.json` (public fields); listing is admin-only | ⬜ | Person card from any avatar. #45 |
| Groups | Admin-only | 🌐 | Group assignees show as a group; group pages open in the browser |
| My account | `GET/PUT /my/account.json` | ✅ (sign-in) | Settings > Account |
| My page | No API | 🟡 | My issues and Inbox are Redline's My page |

## Content modules

| Redmine | API with a user key | Redline | Where it lives |
| --- | --- | --- | --- |
| Wiki | `GET /projects/:id/wiki/index.json`, `GET/PUT/DELETE /projects/:id/wiki/:title.json`, page versions | ⬜ | Team > Wiki: page tree, reader, CommonMark editor. #46 |
| News | `GET /news.json`, `GET/POST/PUT/DELETE` news (comments have no API) | ⬜ | Team > News, and an Updates list across teams. #47 |
| Files | `GET/POST /projects/:id/files.json` | ⬜ | Team > Files: list, save, upload. #47 |
| Documents | No API (search finds them) | 🌐 | Team > Documents lists what search finds; opening one goes to the browser. #49 |
| Forums (boards and messages) | No API (search finds messages) | 🌐 | Team > Forums lists what search finds; opening one goes to the browser. #49 |
| Repository browser | No API, except linking issues to revisions | 🌐 | Commits show on issues (#48); the browser opens in Redmine |
| Activity | No API (Atom feeds need the separate Atom key) | ⬜ | Team > Activity, built from the cache: issue changes, comments, time, wiki, news, files. #48 |
| Search | `GET /search.json` across issues, wiki, news, documents, messages, changesets | ⬜ | Command menu "Search Redmine…" and a search view. #44 |

## Everything else

| Redmine | Why it isn't in Redline |
| --- | --- |
| Administration (users, groups, roles, workflows, custom field definitions, settings) | Admin-only. Redline works with plain user keys. |
| Webhooks (7.0) | Admin-enabled and need a public URL; Redline is pull-based. |
| Imports (CSV) | No API. |
| Two-factor and OAuth application setup | Belong in Redmine's own account pages. |

Anything with 🌐 has an "Open in Redmine" action (Cmd/Ctrl+Shift+O) so it is
never a dead end. Issues have it now, in the header and the command palette.
