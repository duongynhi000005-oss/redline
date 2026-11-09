import { create } from "zustand";
import type { Backend } from "../lib/backend";
import type { Account, Issue, IssueChanges, IssueDetails, Metadata, SyncState } from "../lib/types";
import { errorMessage } from "../lib/types";
import { applyChanges } from "../lib/edit";
import type { ServerSettings } from "../lib/settings";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../lib/settings";
import type { Inbox } from "../lib/inbox";
import { isMine, itemsFrom, loadInbox, mergeItems, saveInbox } from "../lib/inbox";
import type { Filter, FilterField } from "../lib/filters";

/** Where the main pane is. Teams are top-level Redmine projects. */
export type Route =
  | { view: "inbox" }
  | { view: "my-issues"; tab: MyIssuesTab }
  | { view: "team"; teamId: number; tab: TeamTab }
  | { view: "project"; projectId: number }
  | { view: "cycles"; teamId: number }
  | { view: "cycle"; teamId: number; versionId: number };

export type MyIssuesTab = "assigned" | "created";
export type TeamTab = "all" | "active" | "backlog";

/** Which list a set of filters belongs to. Tabs share their list's filters. */
export function routeKey(route: Route): string {
  switch (route.view) {
    case "inbox":
    case "my-issues":
      return route.view;
    case "team":
    case "cycles":
      return `${route.view}:${route.teamId}`;
    case "project":
      return `project:${route.projectId}`;
    case "cycle":
      return `cycle:${route.versionId}`;
  }
}

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
  settingsOpen: boolean;
  settings: ServerSettings;
  inbox: Inbox;
  /** Each list's filters, by routeKey. Kept for the session. */
  filters: Record<string, Filter[]>;
  /** The filter menu, open on a field's values or on the list of fields. */
  filterMenu: { field: FilterField | null } | null;
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
  setSettingsOpen(open: boolean): void;
  updateSettings(change: Partial<ServerSettings>): void;
  markInboxRead(keys: string[] | "all"): void;
  createIssue(fields: IssueChanges): Promise<Issue | null>;
  setFilters(key: string, filters: Filter[]): void;
  openFilterMenu(field: FilterField | null): void;
  closeFilterMenu(): void;
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
    settingsOpen: false,
    settings: DEFAULT_SETTINGS,
    inbox: { since: new Date().toISOString(), items: [] } as Inbox,
    filters: {} as Record<string, Filter[]>,
    filterMenu: null as { field: FilterField | null } | null,
    toast: null as string | null,
  };
}

export const useApp = create<AppState>()((set, get) => {
  /** Loads the cache and listens for the shell's sync events. */
  async function load(backend: Backend) {
    const gen = ++generation;
    const [meta, list] = await Promise.all([backend.getMetadata(), backend.listIssues()]);
    if (gen !== generation) return;
    const account = get().account;
    set({
      meta,
      issues: new Map(list.map((i) => [i.id, i])),
      settings: account ? loadSettings(account.serverUrl, account.userId) : DEFAULT_SETTINGS,
      ...(account ? { inbox: loadInbox(account.serverUrl, account.userId) } : {}),
      phase: "ready",
    });
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
        void collectInbox(backend, fresh);
      }),
      backend.onMetadataChanged(async () => set({ meta: await backend.getMetadata() })),
      backend.onMenu((id) => handleMenu(id)),
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

  /** Looks for other people's changes to my issues and adds them to the inbox. */
  async function collectInbox(backend: Backend, changed: Issue[]) {
    const { account, meta } = get();
    if (!account || !meta) return;
    const since = get().inbox.since;
    const candidates = changed.filter((i) => isMine(i, account.userId) && Date.parse(i.updated_on) > Date.parse(since));
    for (const issue of candidates) {
      try {
        const details = await backend.getIssueDetails(issue.id, true);
        const inbox = mergeItems(get().inbox, itemsFrom(details, account.userId, since, meta));
        if (inbox !== get().inbox) {
          set({ inbox });
          saveInbox(account.serverUrl, account.userId, inbox);
        }
      } catch {
        // The next change to this issue tries again.
      }
    }
  }

  /** The macOS menu bar's commands. */
  function handleMenu(id: string) {
    const state = get();
    switch (id) {
      case "new-issue":
        state.setComposerOpen(true);
        break;
      case "command-palette":
        set({ paletteOpen: true, picker: null });
        break;
      case "my-issues":
        state.navigate({ view: "my-issues", tab: "assigned" });
        break;
      case "sync-now":
        void state.syncNow();
        break;
      case "settings":
        state.setSettingsOpen(true);
        break;
      case "sign-out":
        void state.signOut();
        break;
    }
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

    setSettingsOpen(open) {
      set({ settingsOpen: open, paletteOpen: false, picker: null });
    },

    markInboxRead(keys) {
      const { inbox, account } = get();
      const which = keys === "all" ? null : new Set(keys);
      const next = {
        ...inbox,
        items: inbox.items.map((i) => (!i.read && (!which || which.has(i.key)) ? { ...i, read: true } : i)),
      };
      set({ inbox: next });
      if (account) saveInbox(account.serverUrl, account.userId, next);
    },

    updateSettings(change) {
      const settings = { ...get().settings, ...change };
      set({ settings });
      const account = get().account;
      if (account) saveSettings(account.serverUrl, account.userId, settings);
    },

    setFilters(key, filters) {
      const all = { ...get().filters };
      if (filters.length) all[key] = filters;
      else delete all[key];
      set({ filters: all });
    },

    openFilterMenu(field) {
      set({ filterMenu: { field }, paletteOpen: false, picker: null });
    },

    closeFilterMenu() {
      set({ filterMenu: null });
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

/** Whether a menu or dialog is up, so the views underneath ignore their shortcuts. */
export function overlayOpen(
  s: Pick<AppState, "paletteOpen" | "picker" | "filterMenu" | "composerOpen" | "settingsOpen">,
): boolean {
  return s.paletteOpen || s.picker !== null || s.filterMenu !== null || s.composerOpen || s.settingsOpen;
}

/** For tests: forget everything. */
export function resetApp() {
  generation++;
  starting = null;
  unlisten.forEach((u) => u());
  unlisten = [];
  useApp.setState(initial());
}
