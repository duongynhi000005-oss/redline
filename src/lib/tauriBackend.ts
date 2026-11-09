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
  deleteIssue: (id) => invoke("delete_issue", { id }),
  updateComment: (issueId, journalId, notes) => invoke("update_comment", { issueId, journalId, notes }),
  findMentions: (id) => invoke("find_mentions", { id }),
  runQuery: (queryId, projectId) => invoke("run_query", { queryId, projectId: projectId ?? null }),
  search: (text, offset) => invoke("search", { text, offset }),
  setWatcher: (issueId, userId, watching) => invoke("set_watcher", { issueId, userId, watching }),
  openInRedmine: (path) => invoke("open_in_redmine", { path }),
  openHomepage: (projectId) => invoke("open_homepage", { projectId }),
  getUser: (id) => invoke("get_user", { id }),
  createProject: (fields) => invoke("create_project", { fields }),
  updateProject: (id, changes) => invoke("update_project", { id, changes }),
  setProjectClosed: (id, closed) => invoke("set_project_closed", { id, closed }),
  deleteProject: (id) => invoke("delete_project", { id }),
  attachmentData: async (id) => new Uint8Array(await invoke<ArrayBuffer>("attachment_data", { id })),
  saveAttachment: (a) => invoke("save_attachment", { id: a.id, filename: a.filename }),
  pickFiles: () => invoke("pick_files"),
  attachFiles: (issueId, paths, notes) => invoke("attach_files", { issueId, paths, notes: notes ?? null }),
  deleteAttachment: (issueId, attachmentId) => invoke("delete_attachment", { issueId, attachmentId }),
  wikiIndex: (projectId) => invoke("wiki_index", { projectId }),
  wikiPage: (projectId, title, version) => invoke("wiki_page", { projectId, title, version: version ?? null }),
  saveWikiPage: (projectId, title, changes) => invoke("save_wiki_page", { projectId, title, changes }),
  deleteWikiPage: (projectId, title, withChildren) => invoke("delete_wiki_page", { projectId, title, withChildren }),
  timeEntries: (query) => invoke("time_entries", { query }),
  logTime: (entry) => invoke("log_time", { entry }),
  updateTimeEntry: (id, changes) => invoke("update_time_entry", { id, changes }),
  deleteTimeEntry: (id) => invoke("delete_time_entry", { id }),
  createVersion: (projectId, changes) => invoke("create_version", { projectId, changes }),
  updateVersion: (id, changes) => invoke("update_version", { id, changes }),
  deleteVersion: (id) => invoke("delete_version", { id }),
  getVersion: (id) => invoke("get_version", { id }),
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
