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
  getSyncState: () => invoke("get_sync_state"),
  syncNow: () => invoke("sync_now"),
  updateIssue: (id, changes) => invoke("update_issue", { id, changes }),
  createIssue: (fields) => invoke("create_issue", { fields }),
  addRelation: (issueId, relation) => invoke("add_relation", { issueId, relation }),
  removeRelation: (relation) => invoke("remove_relation", { relation }),
  findMentions: (id) => invoke("find_mentions", { id }),
  setWatcher: (issueId, userId, watching) => invoke("set_watcher", { issueId, userId, watching }),
  openInRedmine: (path) => invoke("open_in_redmine", { path }),
  attachmentData: async (id) => new Uint8Array(await invoke<ArrayBuffer>("attachment_data", { id })),
  saveAttachment: (a) => invoke("save_attachment", { id: a.id, filename: a.filename }),
  pickFiles: () => invoke("pick_files"),
  attachFiles: (issueId, paths, notes) => invoke("attach_files", { issueId, paths, notes: notes ?? null }),
  deleteAttachment: (issueId, attachmentId) => invoke("delete_attachment", { issueId, attachmentId }),
  onFileDrop: async (handler) => {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    return getCurrentWebview().onDragDropEvent(({ payload }) => {
      // Positions come in physical pixels.
      const scale = window.devicePixelRatio || 1;
      if (payload.type === "leave") handler({ type: "leave" });
      else if (payload.type === "drop") {
        handler({ type: "drop", x: payload.position.x / scale, y: payload.position.y / scale, paths: payload.paths });
      } else handler({ type: "over", x: payload.position.x / scale, y: payload.position.y / scale });
    });
  },
  onSyncState: (handler) => listen<SyncState>("sync-state", (e) => handler(e.payload)),
  onIssuesChanged: (handler) => listen<IssuesChanged>("issues-changed", (e) => handler(e.payload)),
  onMetadataChanged: (handler) => listen("metadata-changed", () => handler()),
  onMenu: (handler) => listen<string>("menu", (e) => handler(e.payload)),
};
