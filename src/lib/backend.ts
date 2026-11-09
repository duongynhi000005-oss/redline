import type {
  Account,
  AppInfo,
  Attachment,
  Issue,
  IssueChanges,
  IssueDetails,
  IssuesChanged,
  Metadata,
  NewRelation,
  Relation,
  SyncState,
  TimeEntry,
  TimeEntryChanges,
  TimeQuery,
  Version,
  VersionChanges,
} from "./types";

type Unlisten = () => void;

export type FileDrop =
  | { type: "over"; x: number; y: number }
  | { type: "drop"; x: number; y: number; paths: string[] }
  | { type: "leave" };

/**
 * Everything the UI asks of the app. In the desktop app this is the Rust
 * shell (see src-tauri/src/commands.rs); in a plain browser it's a demo with
 * sample data, which is also what tests use.
 */
export interface Backend {
  appInfo(): Promise<AppInfo>;
  getAccount(): Promise<Account | null>;
  signIn(serverUrl: string, apiKey: string): Promise<Account>;
  signOut(): Promise<void>;
  getMetadata(): Promise<Metadata>;
  listIssues(): Promise<Issue[]>;
  getIssues(ids: number[]): Promise<Issue[]>;
  getIssueDetails(id: number, refresh?: boolean): Promise<IssueDetails>;
  /** The latest sync state, or null when signed out. */
  getSyncState(): Promise<SyncState | null>;
  syncNow(): Promise<void>;
  updateIssue(id: number, changes: IssueChanges): Promise<IssueDetails>;
  createIssue(fields: IssueChanges): Promise<Issue>;
  /** Deletes an issue; Redmine deletes its sub-issues and their logged time too. */
  deleteIssue(id: number): Promise<void>;
  /** Changes a comment's text; empty text removes the comment. */
  updateComment(issueId: number, journalId: number, notes: string): Promise<IssueDetails>;
  /** Relates an issue to another. Both issues arrive again through onIssuesChanged. */
  addRelation(issueId: number, relation: NewRelation): Promise<Relation>;
  removeRelation(relation: Relation): Promise<void>;
  /** Ids of issues whose description or comments mention #id. */
  findMentions(id: number): Promise<number[]>;
  /** Adds or removes a watcher, then returns the issue as Redmine has it. */
  setWatcher(issueId: number, userId: number, watching: boolean): Promise<IssueDetails>;
  /** Opens a page of the Redmine server in the browser, such as "issues/12". */
  openInRedmine(path: string): Promise<void>;
  /** An attachment's content, for previews. Cached once read. */
  attachmentData(id: number): Promise<Uint8Array>;
  /** Asks where to save an attachment and saves it. False when cancelled. */
  saveAttachment(attachment: Attachment): Promise<boolean>;
  /** Asks for files to attach and returns their paths; none when cancelled. */
  pickFiles(): Promise<string[]>;
  /** Uploads files and attaches them to an issue, with an optional comment. */
  attachFiles(issueId: number, paths: string[], notes?: string): Promise<IssueDetails>;
  deleteAttachment(issueId: number, attachmentId: number): Promise<IssueDetails>;
  /** Time entries, newest day first. Read from Redmine, not the cache. */
  timeEntries(query: TimeQuery): Promise<TimeEntry[]>;
  logTime(entry: TimeEntryChanges): Promise<TimeEntry>;
  updateTimeEntry(id: number, changes: TimeEntryChanges): Promise<TimeEntry>;
  deleteTimeEntry(id: number): Promise<void>;
  /** Versions, which Redline calls cycles. Each change updates the cached metadata. */
  createVersion(projectId: number, changes: VersionChanges): Promise<Version>;
  updateVersion(id: number, changes: VersionChanges): Promise<Version>;
  deleteVersion(id: number): Promise<void>;
  /** One version with its spent and estimated hours, which lists of versions leave out. */
  getVersion(id: number): Promise<Version>;
  /** Files dragged over or dropped on the window, with where the pointer is in CSS pixels. */
  onFileDrop(handler: (event: FileDrop) => void): Promise<Unlisten>;
  onSyncState(handler: (state: SyncState) => void): Promise<Unlisten>;
  onIssuesChanged(handler: (change: IssuesChanged) => void): Promise<Unlisten>;
  onMetadataChanged(handler: () => void): Promise<Unlisten>;
  /** Menu bar choices (macOS), by id. */
  onMenu(handler: (id: string) => void): Promise<Unlisten>;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let backend: Backend | null = null;

export async function getBackend(): Promise<Backend> {
  if (backend) return backend;
  if (isTauri()) {
    const { tauriBackend } = await import("./tauriBackend");
    backend = tauriBackend;
  } else {
    const { createDemoBackend } = await import("./demoBackend");
    backend = createDemoBackend();
  }
  return backend;
}

/** For tests: use a specific backend. */
export function setBackend(b: Backend | null) {
  backend = b;
}
