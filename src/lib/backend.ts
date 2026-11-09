import type {
  Account,
  AppInfo,
  Issue,
  IssueChanges,
  IssueDetails,
  IssuesChanged,
  Metadata,
  SyncState,
} from "./types";

type Unlisten = () => void;

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
  syncNow(): Promise<void>;
  updateIssue(id: number, changes: IssueChanges): Promise<IssueDetails>;
  createIssue(fields: IssueChanges): Promise<Issue>;
  onSyncState(handler: (state: SyncState) => void): Promise<Unlisten>;
  onIssuesChanged(handler: (change: IssuesChanged) => void): Promise<Unlisten>;
  onMetadataChanged(handler: () => void): Promise<Unlisten>;
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
