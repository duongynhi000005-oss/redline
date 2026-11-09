<!--
PR title must follow Conventional Commits, for example:
  feat(ui): add command palette
  fix(sync): page through journals past 100 entries
It becomes the commit message on main when the PR is squash-merged.
-->

## What changed

**Before:**

**After:**

<!-- One sentence on how it works, if that isn't obvious from the diff. -->

Closes #

## How I tested it

- [ ] macOS (WebKit)
- [ ] Windows (WebView2)
- [ ] Unit tests added or updated
- Redmine version tested against:

<!-- If you could only test on one platform, say so and a reviewer will check the other. -->

## Screenshots

<!-- Required for every PR that changes the UI: each changed screen in light and
dark mode, before and after, from macOS and Windows where you can.
Use the test Redmine or the demo data (`npm run dev`).
Don't include real API keys, server URLs or anyone else's data. -->

## Checklist

- [ ] Works with a regular (non-admin) API key and no Redmine plugins
- [ ] Doesn't add unnecessary requests to the Redmine server
- [ ] Keyboard shortcuts use Cmd on macOS and Ctrl on Windows
- [ ] New dependencies are explained above
- [ ] Screenshots of changed screens, light and dark (UI changes only)
- [ ] Docs updated if behaviour or setup changed
