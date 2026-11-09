import type { ConnectionOptions } from "./connection";
import type {
  Account,
  AppInfo,
  Attachment,
  Found,
  Issue,
  IssueChanges,
  IssueDetails,
  IssuesChanged,
  Metadata,
  NewRelation,
  Relation,
  SearchResult,
  SearchScope,
  SyncState,
  TimeEntry,
  TimeEntryChanges,
  TimeQuery,
  Version,
  VersionChanges,
  Project,
  ProjectChanges,
  User,
  WikiPage,
  WikiPageChanges,
  News,
  NewsChanges,
  ProjectFile,
  IssueJournals,
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
  /** `connection` is the username and custom headers a proxy in front of the server needs. */
  signIn(serverUrl: string, apiKey: string, connection?: ConnectionOptions): Promise<Account>;
  signOut(): Promise<void>;
  /** The signed-in server's username and custom headers. */
  getConnection(): Promise<ConnectionOptions>;
  /** Checks new headers against the server, saves them and restarts syncing with them. */
  updateConnection(connection: ConnectionOptions): Promise<ConnectionOptions>;
  getMetadata(): Promise<Metadata>;
  listIssues(): Promise<Issue[]>;
  getIssues(ids: number[]): Promise<Issue[]>;
  getIssueDetails(id: number, refresh?: boolean): Promise<IssueDetails>;
  /** Journals of cached issues (up to 200), read from Redmine only where the cache is behind. */
  issueJournals(ids: number[]): Promise<IssueJournals[]>;
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
  /** Runs a saved query: its issues' ids in its order (up to 500), and how many it finds in all. */
  runQuery(queryId: number, projectId?: number | null): Promise<Found<number>>;
  /** One page (25) of what Redmine search finds, newest first, everywhere or within a scope. */
  search(text: string, offset: number, scope?: SearchScope): Promise<Found<SearchResult>>;
  /** Adds or removes a watcher, then returns the issue as Redmine has it. */
  setWatcher(issueId: number, userId: number, watching: boolean): Promise<IssueDetails>;
  /** Opens a page of the Redmine server in the browser, such as "issues/12". */
  openInRedmine(path: string): Promise<void>;
  /** Opens a team's homepage, as Redmine gives it, in the browser. */
  openHomepage(projectId: number): Promise<void>;
  /** Creates a project, such as a sub-team. */
  createProject(fields: ProjectChanges): Promise<Project>;
  updateProject(id: number, changes: ProjectChanges): Promise<void>;
  /** Closes a project and its sub-projects, or reopens them. */
  setProjectClosed(id: number, closed: boolean): Promise<void>;
  /** Deletes a project with everything in it. */
  deleteProject(id: number): Promise<void>;
  /** Another user, as Redmine shows them to the signed-in user. */
  getUser(id: number): Promise<User>;
  /** An attachment's content, for previews. Cached once read. */
  attachmentData(id: number): Promise<Uint8Array>;
  /** Asks where to save an attachment and saves it. False when cancelled. */
  saveAttachment(attachment: Attachment): Promise<boolean>;
  /** Asks for files to attach and returns their paths; none when cancelled. */
  pickFiles(): Promise<string[]>;
  /** Uploads files and attaches them to an issue, with an optional comment. */
  attachFiles(issueId: number, paths: string[], notes?: string): Promise<IssueDetails>;
  deleteAttachment(issueId: number, attachmentId: number): Promise<IssueDetails>;
  /** A project's wiki pages, without their text. Read from Redmine, not the cache. */
  wikiIndex(projectId: number): Promise<WikiPage[]>;
  /** One page with its text and attachments: the start page when title is null, an older version when asked. */
  wikiPage(projectId: number, title: string | null, version?: number | null): Promise<WikiPage>;
  /** Saves a page, making it when the title is new. */
  saveWikiPage(projectId: number, title: string, changes: WikiPageChanges): Promise<void>;
  /** Deletes a page; its sub-pages go with it or move to the top. */
  deleteWikiPage(projectId: number, title: string, withChildren: boolean): Promise<void>;
  /** One page (100) of news, newest first: a team's, or every team's when projectId is null. Read from Redmine. */
  news(projectId: number | null, offset: number): Promise<Found<News>>;
  /** One news post with its comments and attachments. */
  newsItem(id: number): Promise<News>;
  /** Posts news in a team. Needs "Manage news". */
  createNews(projectId: number, changes: NewsChanges): Promise<void>;
  updateNews(id: number, changes: NewsChanges): Promise<void>;
  deleteNews(id: number): Promise<void>;
  /** A team's files, the team's own and its versions'. Read from Redmine. */
  projectFiles(projectId: number): Promise<ProjectFile[]>;
  /** Uploads files to a team's Files, under a version or the whole team. */
  addProjectFiles(projectId: number, paths: string[], versionId: number | null, description: string): Promise<void>;
  deleteProjectFile(id: number): Promise<void>;
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
