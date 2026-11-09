import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Backend } from "./backend";
import type { IssuesChanged, SyncState } from "./types";

export const tauriBackend: Backend = {
  appInfo: () => invoke("app_info"),
  getAccount: () => invoke("get_account"),
  signIn: (serverUrl, apiKey) => invoke("sign_in", { serverUrl, apiKey }),
  signOut: () => invoke("sign_out"),
  getMetadata: () => invoke("get_metadata"),
  listIssues: () => invoke("list_issues"),
  getIssues: (ids) => invoke("get_issues", { ids }),
  getIssueDetails: (id, refresh) => invoke("get_issue_details", { id, refresh: refresh ?? false }),
  syncNow: () => invoke("sync_now"),
  updateIssue: (id, changes) => invoke("update_issue", { id, changes }),
  createIssue: (fields) => invoke("create_issue", { fields }),
  onSyncState: (handler) => listen<SyncState>("sync-state", (e) => handler(e.payload)),
  onIssuesChanged: (handler) => listen<IssuesChanged>("issues-changed", (e) => handler(e.payload)),
  onMetadataChanged: (handler) => listen("metadata-changed", () => handler()),
};
