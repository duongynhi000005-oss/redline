# Contributing to Redline

Thanks for helping build Redline, a fast, keyboard-first desktop client for
[Redmine](https://www.redmine.org) in the style of Linear. It runs on macOS and
Windows and works with any Redmine server through Redmine's REST API.

This guide covers how to set up a dev environment, run Redline against a test
Redmine, and get a pull request merged. If something here is wrong or
unclear, a PR that fixes this file is a great first contribution.

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Project board](#project-board)
- [How Redline is built](#how-redline-is-built)
- [Set up your machine](#set-up-your-machine)
- [Run Redline](#run-redline)
- [Run against a test Redmine](#run-against-a-test-redmine)
- [Branches and commits](#branches-and-commits)
- [Open a pull request](#open-a-pull-request)
- [Testing on WebKit and WebView2](#testing-on-webkit-and-webview2)
- [Code review](#code-review)
- [Releases](#releases)
- [Reporting security issues](#reporting-security-issues)
- [License](#license)

## Ways to contribute

- **Report a bug** with the bug report form under Issues. Include your OS,
  Redline version and Redmine version.
- **Suggest a feature** with the feature request form. Tell us the problem
  first, then the idea.
- **Fix something.** Issues labelled `good first issue` are a good place to
  start. Comment on the issue before you begin so two people don't build the
  same thing.
- **Improve the docs**, including this file.

For anything bigger than a small fix (a new view, a change to sync, a new
dependency), open an issue or discussion first so we can agree on the approach
before you write the code.

## Project board

Work on Redline is tracked on the **Redline** project board, which you can
open from the repository's **Projects** tab. Every issue and pull request
sits in one column, and cards move left to right:

| Column | What it means |
| --- | --- |
| **Ideas** | Suggestions and rough thoughts that nobody has agreed to build yet. |
| **Backlog** | Agreed work that isn't planned for a milestone yet. New issues and PRs land here. |
| **Ready** | Planned for a milestone and clear enough to start. Pick from here. |
| **In progress** | Someone is working on it. Assign yourself before you move a card here. |
| **In review** | A pull request is open and waiting for review or CI. |
| **Done** | Merged or closed. |

- **Priority** (P0 to P2) and **Size** (XS to XL) help us choose what to pick
  up next. Leave them empty if you're not sure; a maintainer will set them.
- Cards that belong to a release carry its milestone, such as `v0.2`, and the
  roadmap view groups them by milestone.
- The board updates itself in a few places: new issues and PRs are added to
  **Backlog**, opening a PR moves it to **In review**, and closing or merging
  moves it to **Done**. Moving a card to **Ready** or **In progress** is done
  by hand.
- When you open a PR for an issue, link it with `Closes #123` so the issue
  moves to **Done** when the PR merges.

## How Redline is built

- **Shell:** [Tauri 2](https://v2.tauri.app) with a Rust backend in
  `src-tauri/`. Tauri draws the UI in the operating system's own web view:
  WebKit (WKWebView) on macOS and Chromium-based WebView2 on Windows.
- **UI:** React and TypeScript in `src/`, built with Vite and tested with
  Vitest and Testing Library.
- **Core:** a Rust library in `crates/redline-core/` with the Redmine client,
  the local SQLite cache and the sync engine. It has no Tauri dependency, so it
  can be tested on any OS.
- **Data:** Redline talks to Redmine only through its
  [REST API](https://www.redmine.org/projects/redmine/wiki/Rest_api), using the
  signed-in person's own API key. It must work with a regular (non-admin) key
  and with no Redmine plugins installed.
- **Sync:** pull-based. Redline polls Redmine for changed issues, then fetches
  each changed issue's journals, and keeps a local copy for a fast UI and an
  inbox. There are no webhooks or server components.

Two rules follow from that and apply to every change:

1. **Any Redmine.** Don't assume a particular server, admin rights, a plugin,
   or anything only one team configures. Custom fields, trackers and statuses
   differ per server, so read them from the API.
2. **Be gentle with the server.** Keep request counts low, respect Redmine's
   page limit of 100, and only send the fields a change actually edits.

[docs/architecture.md](docs/architecture.md) maps the code and how
Redmine's model maps to Linear's, and [docs/adr/](docs/adr/README.md) records
why things are built this way.

## Set up your machine

You need **Node.js** (current LTS), the **Rust** stable toolchain, and Tauri's
platform prerequisites. The full, up-to-date list is in Tauri's
[prerequisites guide](https://v2.tauri.app/start/prerequisites/); the short
version is below.

### macOS

1. Install Xcode Command Line Tools:

   ```sh
   xcode-select --install
   ```

2. Install Rust with [rustup](https://rustup.rs):

   ```sh
   curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
   ```

3. Install Node.js LTS (from [nodejs.org](https://nodejs.org), or a version
   manager such as `fnm` or `nvm`).

### Windows

1. Install the [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   and tick **Desktop development with C++**.
2. Make sure **WebView2** is installed. It ships with Windows 11 and current
   Windows 10; if it's missing, install the Evergreen runtime from
   [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).
3. Install Rust with [rustup](https://rustup.rs) and use the MSVC toolchain:

   ```powershell
   rustup default stable-msvc
   ```

4. Install Node.js LTS from [nodejs.org](https://nodejs.org).

### Linux

Linux isn't a supported target yet, but you can usually develop on it after
installing the WebKitGTK packages listed in Tauri's prerequisites guide.
Please still test on macOS or Windows before asking for review.

### Check your setup

```sh
node --version
rustc --version
cargo --version
```

## Run Redline

```sh
git clone https://github.com/odonckers/redline.git
cd redline
npm ci
npm run tauri dev
```

`npm run tauri dev` starts the UI dev server and opens the app with hot
reload. The first run compiles the Rust side and takes a few minutes.

Other scripts you'll use (the same ones CI runs):

| Command               | What it does                             |
| --------------------- | ---------------------------------------- |
| `npm run lint`        | Lints the TypeScript code                |
| `npm run typecheck`   | Type-checks without building             |
| `npm test`            | Runs the TypeScript unit tests           |
| `npm run tauri build` | Builds a release app for your platform   |

For the Rust side, from the repo root (it's a Cargo workspace):

```sh
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

## Run against a test Redmine

Don't develop against a real team's Redmine. Run your own with Docker:

```sh
docker compose -f dev/redmine/compose.yaml up -d
```

Then fill it with test data:

```sh
dev/redmine/seed.sh
```

The seed script turns on the REST API, loads Redmine's default trackers and
statuses, and creates a regular (non-admin) user `dev` and a teammate, a few
projects (one with a subproject), sprints as versions, list custom fields used
as labels, and a few
issues. It's safe to run again. Its last line is the `dev` user's API key:

```
REDLINE_TEST_API_KEY=0123456789abcdef...
```

In Redline, sign in to `http://localhost:3000` with that key. To browse the
same data in Redmine itself, sign in as `dev` with the password
`redline-dev-password` (or as `admin` / `admin`).

The core crate's live tests use the same server:

```sh
export REDLINE_TEST_REDMINE_URL=http://localhost:3000
export REDLINE_TEST_API_KEY=<the key from seed.sh>
cargo test -p redline-core
```

Without those variables the live tests are skipped. CI always runs them.

Redline supports Redmine 6.1 and later. The compose file runs the latest
Redmine 7 by default. To check a change against the oldest supported release,
start from scratch with `REDMINE_VERSION=6.1`:

```sh
docker compose -f dev/redmine/compose.yaml down -v
REDMINE_VERSION=6.1 docker compose -f dev/redmine/compose.yaml up -d
```

CI runs the core tests against both.

Never commit API keys, server URLs from a real team, or screenshots that show
someone else's data.

## Branches and commits

- Fork the repo and branch from `main`. Name branches after what they do,
  for example `feat/command-palette` or `fix/journal-pagination`.
- Keep each pull request to one change. Several small PRs get reviewed faster
  than one large one.
- We use [Conventional Commits](https://www.conventionalcommits.org). Pull
  requests are squash-merged, so **the PR title becomes the commit on `main`**
  and must follow the format. CI checks it.

  ```
  <type>(<optional scope>): <summary in the imperative>
  ```

  Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
  `chore`. Common scopes: `sync`, `ui`, `api`, `inbox`, `shell`.

  Examples:

  ```
  feat(ui): add command palette
  fix(sync): page through journals past 100 entries
  ```

  Commits inside your branch can be anything; only the PR title matters.

## Open a pull request

1. Rebase on the latest `main` and make sure `npm run lint`,
   `npm run typecheck`, `npm test` and the Rust checks pass locally.
2. Push to your fork and open a PR against `main`. Opening it as a draft is
   fine while you're still working.
3. Fill in the template: what changed, before and after, the linked issue, and
   how you tested it. **Every PR that changes the UI must include
   screenshots in its description**: each screen you changed, in light and
   dark mode, from macOS and Windows where you can. Run the app against the
   test Redmine (see [Run against a test Redmine](#run-against-a-test-redmine))
   or the demo data (`npm run dev`) so no real team's data shows. A short
   recording helps for anything that moves.
4. CI runs lint, type checks, tests and a Tauri build on macOS and Windows.
   All of it must be green before merge.
5. Mark the PR ready for review. A maintainer will review it; see
   [Code review](#code-review).

If your PR changes how Redline talks to Redmine, say which Redmine version
you tested against.

## Testing on WebKit and WebView2

Redline renders in two different browser engines: WebKit on macOS and
Chromium (WebView2) on Windows. Something that works in one can break in the
other, especially around:

- CSS features that ship in Chromium before Safari, and scroll or
  `position: sticky` behaviour
- keyboard shortcuts and modifier keys (`Cmd` on macOS, `Ctrl` on Windows)
- text input, IME composition and the markdown editor
- focus handling, drag and drop, and context menus
- fonts, font smoothing and high-DPI rendering

So:

- **Test UI changes on both platforms** when you can. If you only have one,
  say so in the PR, and a reviewer or another contributor will check the
  other.
- CI builds on both, but it doesn't click through the UI, so a green build
  isn't proof that a screen works.
- Use the platform's shortcut conventions (`Cmd+K` on macOS, `Ctrl+K` on
  Windows), not one hard-coded key.
- To open dev tools in a dev build, right-click and choose **Inspect**. On
  macOS this opens Safari's Web Inspector; on Windows it opens Edge DevTools.

## Code review

- Every PR needs one approving review from a maintainer before it merges.
- We aim to give a first response within a few days. If a week passes with
  nothing, a polite ping on the PR is welcome.
- Reviewers look for: correctness against the Redmine API, behaviour on both
  platforms, the "any Redmine" and "gentle with the server" rules above,
  tests for logic, and a UI that stays fast and keyboard-friendly.
- Please answer review comments with a change or a reply. The reviewer
  resolves the conversation once they're happy.
- New dependencies (npm or crates) need a short reason in the PR. Prefer
  small, well-maintained ones.

## Releases

Maintainers release by pushing a version tag; a workflow builds the macOS and
Windows installers into a draft GitHub release. See
[docs/releasing.md](docs/releasing.md) for the steps and the signing secrets.

## Reporting security issues

**Please don't open a public issue for a security problem.** Redline holds
people's Redmine API keys, so we treat these reports seriously. Follow
[SECURITY.md](SECURITY.md) to report privately.

## License

Redline is licensed under the [Apache License, Version 2.0](LICENSE).

By submitting a contribution, you agree that it is licensed under the same
Apache-2.0 license, as described in section 5 of the license. There's no
separate contributor agreement to sign. Only submit code you wrote yourself
or have the right to contribute, and keep the license headers and notices of
any third-party code you include.
