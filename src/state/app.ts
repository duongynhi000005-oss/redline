import { create } from "zustand";
import type { Backend } from "../lib/backend";
import type {
  Account,
  Attachment,
  Issue,
  IssueChanges,
  IssueDetails,
  Metadata,
  Relation,
  SyncState,
  TimeEntry,
  TimeEntryChanges,
} from "../lib/types";
import type { RelationChoice } from "../lib/relations";
import { newRelation } from "../lib/relations";
import { errorMessage, isBackendError } from "../lib/types";
import { allowed } from "../lib/permissions";
import { applyChanges } from "../lib/edit";
import type { ServerSettings } from "../lib/settings";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../lib/settings";
import type { Inbox } from "../lib/inbox";
import { isMine, itemsFrom, loadInbox, mergeItems, saveInbox } from "../lib/inbox";
import type { Filter, FilterField } from "../lib/filters";
import type { ViewOptions } from "../lib/views";
import { DEFAULT_VIEW, isDefaultView, loadViews, saveViews } from "../lib/views";

/** Where the main pane is. Teams are top-level Redmine projects. */
export type Route =
  | { view: "inbox" }
  | { view: "my-issues"; tab: MyIssuesTab }
  | { view: "team"; teamId: number; tab: TeamTab }
  | { view: "project"; projectId: number }
  | { view: "cycles"; teamId: number }
  | { view: "time"; teamId: number }
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
    case "time":
      return `${route.view}:${route.teamId}`;
    case "project":
      return `project:${route.projectId}`;
    case "cycle":
      return `cycle:${route.versionId}`;
  }
}

export type Phase = "starting" | "signed-out" | "ready";

export type PickerKind = "status" | "priority" | "assignee" | "cycle" | "labels" | "relation" | "subscribers";

export interface PickerState {
  kind: PickerKind;
  issueId: number;
  /** For the relation picker: how to connect, once chosen. */
  relation?: RelationChoice;
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
  /** Each list's filters, grouping and ordering, by routeKey. Saved per server. */
  views: Record<string, ViewOptions>;
  /** The filter menu, open on a field's values or on the list of fields. */
  filterMenu: { field: FilterField | null } | null;
  /** A short message shown at the bottom of the window, like a failed edit. */
  toast: string | null;
  /** Whether you watch each issue, as far as Redmine has said. */
  watching: Map<number, boolean>;
  /** The Log time dialog: for an issue, or to change one entry. */
  timeDialog: { issueId: number; entry?: TimeEntry } | null;
  /** Bumped when time is logged, changed or deleted, so lists of time reload. */
  timeVersion: number;

  start(backend: Backend): Promise<void>;
  signIn(serverUrl: string, apiKey: string): Promise<void>;
  signOut(): Promise<void>;
  navigate(route: Route): void;
  openIssue(id: number | null): void;
  focusIssue(id: number | null): void;
  setPaletteOpen(open: boolean): void;
  openPicker(kind: PickerKind, issueId: number, relation?: RelationChoice): void;
  closePicker(): void;
  syncNow(): Promise<void>;
  updateIssue(id: number, changes: IssueChanges): Promise<IssueDetails | null>;
  /** Connects another issue to this one: a Redmine relation, a parent or a sub-issue. */
  relateIssue(issueId: number, choice: RelationChoice, otherId: number): Promise<boolean>;
  removeRelation(relation: Relation): Promise<boolean>;
  /** Takes what a fresh read of an issue says that a list doesn't: relations, watchers, your subscription. */
  takeDetails(details: IssueDetails): void;
  /** Adds or removes a subscriber (a Redmine watcher). */
  setWatcher(issueId: number, userId: number, watching: boolean): Promise<boolean>;
  /** Subscribes you to an issue, or unsubscribes you. */
  toggleSubscribe(issueId: number): Promise<void>;
  /** Opens a page of the Redmine server in the browser, such as "issues/12". */
  openInRedmine(path: string): void;
  /** Uploads files to an issue, with an optional comment. True when Redmine took them. */
  attachFiles(issueId: number, paths: string[], notes?: string): Promise<boolean>;
  deleteAttachment(issueId: number, attachment: Attachment): Promise<void>;
  saveAttachment(attachment: Attachment): Promise<void>;
  openTimeDialog(issueId: number, entry?: TimeEntry): void;
  closeTimeDialog(): void;
  /** Logs time, or changes an entry. True when Redmine took it. */
  saveTime(issueId: number, changes: TimeEntryChanges, entryId?: number): Promise<boolean>;
  deleteTimeEntry(entry: TimeEntry): Promise<void>;
  showToast(message: string | null): void;
  setComposerOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  updateSettings(change: Partial<ServerSettings>): void;
  markInboxRead(keys: string[] | "all"): void;
  createIssue(fields: IssueChanges): Promise<Issue | null>;
  setFilters(key: string, filters: Filter[]): void;
  updateView(key: string, change: Partial<ViewOptions>): void;
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
    timeDialog: null as AppState["timeDialog"],
    timeVersion: 0,
    composerOpen: false,
    settingsOpen: false,
    settings: DEFAULT_SETTINGS,
    inbox: { since: new Date().toISOString(), items: [] } as Inbox,
    views: {} as Record<string, ViewOptions>,
    filterMenu: null as { field: FilterField | null } | null,
    toast: null as string | null,
    watching: new Map<number, boolean>(),
  };
}

export const useApp = create<AppState>()((set, get) => {
  /** Reads issues again from the backend's cache, after a change that touched them. */
  async function refreshIssues(backend: Backend, ids: number[]) {
    const fresh = await backend.getIssues(ids);
    const issues = new Map(get().issues);
    fresh.forEach((i) => issues.set(i.id, i));
    set({ issues });
  }

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
      ...(account
        ? { inbox: loadInbox(account.serverUrl, account.userId), views: loadViews(account.serverUrl, account.userId) }
        : {}),
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
        // Attachments and watchers come only with an issue's details; keep them. Null
        // watchers means the details showed the role can't see them, whatever the cache says.
        fresh.forEach((i) => {
          const known = issues.get(i.id);
          const watchers = known?.watchers === null ? null : (i.watchers ?? known?.watchers);
          issues.set(i.id, known ? { ...i, attachments: i.attachments ?? known.attachments, watchers } : i);
        });
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

    openPicker(kind, issueId, relation) {
      set({ picker: { kind, issueId, relation }, paletteOpen: false });
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

    async relateIssue(issueId, choice, otherId) {
      const { backend } = get();
      if (!backend) return false;
      if (choice === "parent") return (await get().updateIssue(issueId, { parent_issue_id: otherId })) !== null;
      if (choice === "sub-issue") return (await get().updateIssue(otherId, { parent_issue_id: issueId })) !== null;
      try {
        await backend.addRelation(issueId, newRelation(choice, otherId));
        await refreshIssues(backend, [issueId, otherId]);
        return true;
      } catch (e) {
        set({ toast: `Couldn't relate #${issueId} to #${otherId}: ${errorMessage(e)}` });
        return false;
      }
    },

    async removeRelation(relation) {
      const { backend } = get();
      if (!backend) return false;
      try {
        await backend.removeRelation(relation);
        await refreshIssues(backend, [relation.issue_id, relation.issue_to_id]);
        return true;
      } catch (e) {
        set({ toast: `Couldn't remove the relation: ${errorMessage(e)}` });
        return false;
      }
    },

    takeDetails(details) {
      const { issues, watching } = get();
      const id = details.issue.id;
      const known = issues.get(id);
      const patch: Partial<Issue> = {};
      // Redmine doesn't touch updated_on when relations, watchers or logged time change;
      // attachments only come with details.
      for (const key of ["relations", "watchers", "attachments", "spent_hours", "total_spent_hours"] as const) {
        // Watchers missing from details means the role can't see them (any more).
        const fresh = key === "watchers" ? (details.issue.watchers ?? null) : details.issue[key];
        if (known && fresh !== undefined && JSON.stringify(known[key] ?? null) !== JSON.stringify(fresh)) patch[key] = fresh as never;
      }
      const next: Partial<AppState> = {};
      if (known && Object.keys(patch).length) next.issues = new Map(issues).set(id, { ...known, ...patch });
      if (details.watching != null && watching.get(id) !== details.watching) {
        next.watching = new Map(watching).set(id, details.watching);
      }
      if (Object.keys(next).length) set(next);
    },

    async setWatcher(issueId, userId, watching) {
      const { backend, account, meta } = get();
      const issue = get().issues.get(issueId);
      if (!backend || !issue) return false;
      const before = { issue, watching: get().watching.get(issueId) };
      // Show the change at once; Redmine has the last word.
      const person =
        userId === account?.userId
          ? { id: userId, name: account.name }
          : meta?.memberships.find((m) => m.user?.id === userId)?.user;
      const list = (issue.watchers ?? []).filter((w) => w.id !== userId);
      if (watching && person) list.push(person);
      const next: Partial<AppState> = {};
      if (issue.watchers) next.issues = new Map(get().issues).set(issueId, { ...issue, watchers: list });
      if (userId === account?.userId) next.watching = new Map(get().watching).set(issueId, watching);
      set(next);
      try {
        get().takeDetails(await backend.setWatcher(issueId, userId, watching));
        return true;
      } catch (e) {
        const issues = new Map(get().issues).set(issueId, before.issue);
        const was = new Map(get().watching);
        if (before.watching === undefined) was.delete(issueId);
        else was.set(issueId, before.watching);
        const forbidden = isBackendError(e) && e.code === "forbidden";
        const mine = userId === account?.userId;
        const act = mine ? (watching ? "subscribe" : "unsubscribe") : watching ? "add subscribers" : "remove subscribers";
        set({
          issues,
          watching: was,
          toast: forbidden
            ? `Your role in ${issue.project.name} can't ${act} through Redmine's API. Open #${issueId} in Redmine to use Watch there.`
            : `Couldn't ${act} on #${issueId}: ${errorMessage(e)}`,
        });
        return false;
      }
    },

    async toggleSubscribe(issueId) {
      const { account, meta, watching } = get();
      const issue = get().issues.get(issueId);
      if (!account || !issue) return;
      const on = !(watching.get(issueId) ?? issue.watchers?.some((w) => w.id === account.userId) ?? false);
      const permission = on ? "add_issue_watchers" : "delete_issue_watchers";
      if (allowed(meta, issue.project.id, permission) === false) {
        // Redmine only lets this role watch from its own page.
        get().openInRedmine(`issues/${issueId}`);
        set({
          toast: `Opened #${issueId} in Redmine: your role in ${issue.project.name} can only ${on ? "watch" : "unwatch"} issues there.`,
        });
        return;
      }
      await get().setWatcher(issueId, account.userId, on);
    },

    async attachFiles(issueId, paths, notes) {
      const { backend } = get();
      if (!backend || !paths.length) return false;
      const names = paths.map((p) => p.split(/[\\/]/).pop()).join(", ");
      set({ toast: `Attaching ${names}…` });
      try {
        get().takeDetails(await backend.attachFiles(issueId, paths, notes));
        set({ toast: paths.length === 1 ? `Attached ${names}` : `Attached ${paths.length} files` });
        return true;
      } catch (e) {
        set({ toast: `Couldn't attach ${names}: ${errorMessage(e)}` });
        return false;
      }
    },

    async deleteAttachment(issueId, attachment) {
      const { backend, issues } = get();
      const issue = issues.get(issueId);
      if (!backend || !issue) return;
      // Gone at once; back if Redmine refuses.
      set({ issues: new Map(issues).set(issueId, { ...issue, attachments: (issue.attachments ?? []).filter((a) => a.id !== attachment.id) }) });
      try {
        get().takeDetails(await backend.deleteAttachment(issueId, attachment.id));
      } catch (e) {
        const now = get().issues.get(issueId);
        if (now) set({ issues: new Map(get().issues).set(issueId, { ...now, attachments: issue.attachments }) });
        set({ toast: `Couldn't delete ${attachment.filename}: ${errorMessage(e)}` });
      }
    },

    openTimeDialog(issueId, entry) {
      set({ timeDialog: { issueId, entry }, paletteOpen: false, picker: null });
    },

    closeTimeDialog() {
      set({ timeDialog: null });
    },

    async saveTime(issueId, changes, entryId) {
      const { backend } = get();
      if (!backend) return false;
      try {
        if (entryId) await backend.updateTimeEntry(entryId, changes);
        else await backend.logTime({ ...changes, issue_id: issueId });
        set((s) => ({ timeVersion: s.timeVersion + 1 }));
        return true;
      } catch (e) {
        set({ toast: `Couldn't ${entryId ? "change" : "log"} the time: ${errorMessage(e)}` });
        return false;
      }
    },

    async deleteTimeEntry(entry) {
      try {
        await get().backend?.deleteTimeEntry(entry.id);
        set((s) => ({ timeVersion: s.timeVersion + 1 }));
      } catch (e) {
        set({ toast: `Couldn't delete the time: ${errorMessage(e)}` });
      }
    },

    async saveAttachment(attachment) {
      try {
        if (await get().backend?.saveAttachment(attachment)) set({ toast: `Saved ${attachment.filename}` });
      } catch (e) {
        set({ toast: `Couldn't save ${attachment.filename}: ${errorMessage(e)}` });
      }
    },

    openInRedmine(path) {
      get()
        .backend?.openInRedmine(path)
        .catch((e) => set({ toast: errorMessage(e) }));
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
      get().updateView(key, { filters });
    },

    updateView(key, change) {
      const views = { ...get().views };
      const next = { ...DEFAULT_VIEW, ...views[key], ...change };
      if (isDefaultView(next)) delete views[key];
      else views[key] = next;
      set({ views });
      const account = get().account;
      if (account) saveViews(account.serverUrl, account.userId, views);
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

/** A list's display options, or the defaults. */
export function viewFor(s: Pick<AppState, "views">, key: string): ViewOptions {
  return s.views[key] ?? DEFAULT_VIEW;
}

/** Whether a menu or dialog is up, so the views underneath ignore their shortcuts. */
export function overlayOpen(
  s: Pick<AppState, "paletteOpen" | "picker" | "filterMenu" | "composerOpen" | "settingsOpen" | "timeDialog">,
): boolean {
  return s.paletteOpen || s.picker !== null || s.filterMenu !== null || s.composerOpen || s.settingsOpen || s.timeDialog !== null;
}

/** For tests: forget everything. */
export function resetApp() {
  generation++;
  starting = null;
  unlisten.forEach((u) => u());
  unlisten = [];
  useApp.setState(initial());
}
