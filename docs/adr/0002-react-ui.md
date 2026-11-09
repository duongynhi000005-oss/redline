# 0002: React for the UI

- Status: Accepted
- Date: 2026-11-09

## Context

The UI has to deliver what makes Linear feel like Linear: a command palette,
lists of thousands of issues that scroll without a hitch, keyboard shortcuts
for everything, menus and popovers that behave like native ones, a markdown
editor, and quick, subtle animation. We looked at React, Angular, Svelte and
Solid.

## Decision

Use React 19 with TypeScript, built with Vite and tested with Vitest and
Testing Library.

- **Libraries for the hard parts.** The pieces we need exist and are well
  maintained for React: `cmdk` (command palette), TanStack Virtual
  (virtualized lists), Radix primitives (accessible menus, popovers, dialogs),
  and several mature ProseMirror and Lexical editors. Linear itself is a React
  app.
- **Contributors.** React is the most widely known UI library, which matters
  for an open-source project.
- **Small runtime.** React with Vite produces a small bundle and starts fast in
  the web view.

Angular was the main alternative, as the maintainer knows it well, but its
ecosystem for these specific pieces is thinner and its runtime is heavier for a
single-window desktop app. Svelte and Solid are faster on paper, but the
difference doesn't matter at this size, and their component ecosystems are
smaller.

## Consequences

- State that the UI needs lives in a small store (Zustand) fed by Tauri events
  from the Rust core. React components read from the store and never call
  Redmine themselves.
- We add UI dependencies one at a time, each with a reason in its PR.
