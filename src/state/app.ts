import { create } from "zustand";
import type { Backend } from "../lib/backend";
import type { Account, Issue, IssueChanges, IssueDetails, Metadata, SyncState } from "../lib/types";
import { errorMessage } from "../lib/types";

/** Where the main pane is. Teams are top-level Redmine projects. */
export type Route =
  | { view: "my-issues"; tab: MyIssuesTab }
  | { view: "team"; teamId: number; tab: TeamTab }
  | { view: "project"; projectId: number };

export type MyIssuesTab = "assigned" | "created";
export type TeamTab = "all" | "active" | "backlog";

export type Phase = "starting" | "signed-out" | "ready";

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
  paletteOpen: boolean;
  /** A short message shown at the bottom of the window, like a failed edit. */
  toast: string | null;

  start(backend: Backend): Promise<void>;
  signIn(serverUrl: string, apiKey: string): Promise<void>;
  signOut(): Promise<void>;
  navigate(route: Route): void;
  openIssue(id: number | null): void;
  setPaletteOpen(open: boolean): void;
  syncNow(): Promise<void>;
  updateIssue(id: number, changes: IssueChanges): Promise<IssueDetails | null>;
  showToast(message: string | null): void;
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
    openIssueId: null,
    paletteOpen: false,
    toast: null,
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
    if (gen !== generation) subscriptions.forEach((u) => u());
    else unlisten = subscriptions;
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
      set({ route, openIssueId: null });
    },

    openIssue(id) {
      set({ openIssueId: id });
    },

    setPaletteOpen(open) {
      set({ paletteOpen: open });
    },

    async syncNow() {
      await get().backend?.syncNow();
    },

    async updateIssue(id, changes) {
      const backend = get().backend;
      if (!backend) return null;
      try {
        const details = await backend.updateIssue(id, changes);
        const issues = new Map(get().issues);
        issues.set(id, details.issue);
        set({ issues });
        return details;
      } catch (e) {
        set({ toast: errorMessage(e) });
        return null;
      }
    },

    showToast(toast) {
      set({ toast });
    },
  };
});

/** For tests: forget everything. */
export function resetApp() {
  generation++;
  starting = null;
  unlisten.forEach((u) => u());
  unlisten = [];
  useApp.setState(initial());
}
