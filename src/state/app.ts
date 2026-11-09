import { create } from "zustand";
import type { Backend } from "../lib/backend";
import type { Account, Issue, IssueChanges, IssueDetails, Metadata, SyncState } from "../lib/types";
import { errorMessage } from "../lib/types";
import { applyChanges } from "../lib/edit";

/** Where the main pane is. Teams are top-level Redmine projects. */
export type Route =
  | { view: "my-issues"; tab: MyIssuesTab }
  | { view: "team"; teamId: number; tab: TeamTab }
  | { view: "project"; projectId: number };

export type MyIssuesTab = "assigned" | "created";
export type TeamTab = "all" | "active" | "backlog";

export type Phase = "starting" | "signed-out" | "ready";

export type PickerKind = "status" | "priority" | "assignee" | "cycle" | "labels";

export interface PickerState {
  kind: PickerKind;
  issueId: number;
}

export interface AppState {
  phase: Phase;
  backend: Backend | null;
  account: Account | null;
  meta: Metadata | null;
  issues: Map<number, Issue>;
  sync: SyncState;
  route: Route;
  /** The issue shown in the detail view, if any. */
  openIssueId: number | null;
  /** The highlighted row in the issue list. */
  focusedIssueId: number | null;
  paletteOpen: boolean;
  /** The property picker open for an issue, like Linear's S, P and A menus. */
  picker: PickerState | null;
  /** The new-issue form. */
  composerOpen: boolean;
  /** A short message shown at the bottom of the window, like a failed edit. */
  toast: string | null;

  start(backend: Backend): Promise<void>;
  signIn(serverUrl: string, apiKey: string): Promise<void>;
  signOut(): Promise<void>;
  navigate(route: Route): void;
  openIssue(id: number | null): void;
  focusIssue(id: number | null): void;
  setPaletteOpen(open: boolean): void;
  openPicker(kind: PickerKind, issueId: number): void;
  closePicker(): void;
  syncNow(): Promise<void>;
  updateIssue(id: number, changes: IssueChanges): Promise<IssueDetails | null>;
  showToast(message: string | null): void;
  setComposerOpen(open: boolean): void;
  createIssue(fields: IssueChanges): Promise<Issue | null>;
}

const IDLE: SyncState = { state: "idle", lastSyncedAt: null, message: null };

let unlisten: (() => void)[] = [];
// Bumped on every load and sign-out, so a slow load can't leave stale listeners.
let generation = 0;
let starting: { backend: Backend; promise: Promise<void> } | null = null;

function initial() {
  return {
    phase: "starting" as Phase,
    backend: null,
    account: null,
    meta: null,
    issues: new Map<number, Issue>(),
    sync: IDLE,
    route: { view: "my-issues", tab: "assigned" } as Route,
    openIssueId: null as number | null,
    focusedIssueId: null as number | null,
    paletteOpen: false,
    picker: null as PickerState | null,
    composerOpen: false,
    toast: null as string | null,
  };
}

export const useApp = create<AppState>()((set, get) => {
  /** Loads the cache and listens for the shell's sync events. */
  async function load(backend: Backend) {
    const gen = ++generation;
    const [meta, list] = await Promise.all([backend.getMetadata(), backend.listIssues()]);
    if (gen !== generation) return;
    set({ meta, issues: new Map(list.map((i) => [i.id, i])), phase: "ready" });
    unlisten.forEach((u) => u());
    unlisten = [];
    const subscriptions = await Promise.all([
      backend.onSyncState((sync) => set({ sync })),
      backend.onIssuesChanged(async ({ changed, removed }) => {
        const fresh = changed.length ? await backend.getIssues(changed) : [];
        const issues = new Map(get().issues);
        removed.forEach((id) => issues.delete(id));
        fresh.forEach((i) => issues.set(i.id, i));
        set({ issues });
        if (removed.includes(get().openIssueId ?? -1)) set({ openIssueId: null });
      }),
      backend.onMetadataChanged(async () => set({ meta: await backend.getMetadata() })),
    ]);
    if (gen !== generation) {
      subscriptions.forEach((u) => u());
      return;
    }
    unlisten = subscriptions;
    // The shell may have synced before we started listening.
    const sync = await backend.getSyncState();
    if (sync && gen === generation) set({ sync });
  }

  return {
    ...initial(),

    start(backend) {
      // React runs effects twice in development; start once per backend.
      if (starting?.backend === backend) return starting.promise;
      const promise = (async () => {
        set({ backend });
        const account = await backend.getAccount();
        if (!account) {
          set({ phase: "signed-out", account: null });
          return;
        }
        set({ account });
        await load(backend);
      })();
      starting = { backend, promise };
      return promise;
    },

    async signIn(serverUrl, apiKey) {
      const backend = get().backend;
      if (!backend) return;
      // Errors go to the sign-in form, which shows them.
      const account = await backend.signIn(serverUrl, apiKey);
      set({ account, route: { view: "my-issues", tab: "assigned" }, openIssueId: null });
      await load(backend);
    },

    async signOut() {
      const backend = get().backend;
      generation++;
      unlisten.forEach((u) => u());
      unlisten = [];
      await backend?.signOut();
      set({ ...initial(), backend, phase: "signed-out" });
    },

    navigate(route) {
      set({ route, openIssueId: null, focusedIssueId: null });
    },

    openIssue(id) {
      // Coming back to the list keeps the issue highlighted.
      set(id === null ? { openIssueId: null } : { openIssueId: id, focusedIssueId: id });
    },

    focusIssue(id) {
      set({ focusedIssueId: id });
    },

    setPaletteOpen(open) {
      set({ paletteOpen: open });
    },

    openPicker(kind, issueId) {
      set({ picker: { kind, issueId }, paletteOpen: false });
    },

    closePicker() {
      set({ picker: null });
    },

    async syncNow() {
      await get().backend?.syncNow();
    },

    async updateIssue(id, changes) {
      const { backend, meta } = get();
      const before = get().issues.get(id);
      if (!backend) return null;
      // Show the change at once; Redmine's answer replaces it.
      if (before && meta) {
        const issues = new Map(get().issues);
        issues.set(id, applyChanges(before, changes, meta));
        set({ issues });
      }
      try {
        const details = await backend.updateIssue(id, changes);
        const issues = new Map(get().issues);
        issues.set(id, details.issue);
        set({ issues });
        return details;
      } catch (e) {
        if (before) {
          const issues = new Map(get().issues);
          issues.set(id, before);
          set({ issues });
        }
        set({ toast: `Couldn't update #${id}: ${errorMessage(e)}` });
        return null;
      }
    },

    showToast(toast) {
      set({ toast });
    },

    setComposerOpen(open) {
      set({ composerOpen: open, paletteOpen: false });
    },

    async createIssue(fields) {
      const backend = get().backend;
      if (!backend) return null;
      // Errors go to the form, which shows them.
      const issue = await backend.createIssue(fields);
      const issues = new Map(get().issues);
      issues.set(issue.id, issue);
      set({ issues, focusedIssueId: issue.id, toast: `Created #${issue.id} ${issue.subject}` });
      return issue;
    },
  };
});

/** The issue that commands and shortcuts act on: the open one, else the highlighted row. */
export function targetIssueId(s: Pick<AppState, "openIssueId" | "focusedIssueId">): number | null {
  return s.openIssueId ?? s.focusedIssueId;
}

/** For tests: forget everything. */
export function resetApp() {
  generation++;
  starting = null;
  unlisten.forEach((u) => u());
  unlisten = [];
  useApp.setState(initial());
}
