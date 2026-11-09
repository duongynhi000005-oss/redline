import { useEffect } from "react";
import { isMac, isTyping, matchesShortcut } from "../lib/platform";
import { timeAccess } from "../lib/permissions";
import type { PickerKind } from "../state/app";
import { overlayOpen, targetIssueIds, useApp } from "../state/app";

/** Linear's single-key shortcuts for the open or highlighted issue. */
export type IssueCommand = PickerKind | "assign-me" | "subscribe" | "open-in-redmine" | "log-time";

export const ISSUE_SHORTCUTS: { shortcut: string; kind: IssueCommand; label: string }[] = [
  { shortcut: "s", kind: "status", label: "Change status…" },
  { shortcut: "p", kind: "priority", label: "Change priority…" },
  { shortcut: "a", kind: "assignee", label: "Assign to…" },
  { shortcut: "i", kind: "assign-me", label: "Assign to me" },
  { shortcut: "l", kind: "labels", label: "Change labels…" },
  { shortcut: "shift+c", kind: "cycle", label: "Move to cycle…" },
  { shortcut: "shift+s", kind: "subscribe", label: "Subscribe or unsubscribe" },
  { shortcut: "mod+shift+o", kind: "open-in-redmine", label: "Open in Redmine" },
  { shortcut: "mod+shift+t", kind: "log-time", label: "Log time…" },
];

/** Whether a command can apply to the issue, so the palette offers only those. */
export function issueCommandAvailable(kind: IssueCommand, issueId: number): boolean {
  if (kind !== "log-time") return true;
  const state = useApp.getState();
  const issue = state.issues.get(issueId);
  return !!issue && timeAccess(state.meta, issue.project.id).log;
}

/** Commands that can change several issues at once. */
const BULK: IssueCommand[] = ["status", "priority", "assignee", "assign-me", "labels", "cycle"];

export function bulkCommand(kind: IssueCommand): boolean {
  return BULK.includes(kind);
}

/** Runs a command on one issue, or on several where it can. */
export function runIssueCommandOn(kind: IssueCommand, ids: number[]) {
  const state = useApp.getState();
  if (ids.length === 1) return runIssueCommand(kind, ids[0]!);
  if (!ids.length) return;
  if (!bulkCommand(kind)) {
    useApp.setState({ toast: "That works on one issue at a time. Press Escape to clear the selection." });
    return;
  }
  if (kind === "assign-me") {
    const me = state.account?.userId;
    if (me !== undefined) void state.updateIssues(ids.map((id) => [id, { assigned_to_id: me }]));
    return;
  }
  state.openBulkPicker(kind as PickerKind, ids);
}

export function runIssueCommand(kind: IssueCommand, issueId: number) {
  const state = useApp.getState();
  if (kind === "subscribe") {
    void state.toggleSubscribe(issueId);
    return;
  }
  if (kind === "log-time") {
    if (issueCommandAvailable(kind, issueId)) state.openTimeDialog(issueId);
    else useApp.setState({ toast: "Time can't be logged in this issue's project." });
    return;
  }
  if (kind === "open-in-redmine") {
    state.openInRedmine(`issues/${issueId}`);
    return;
  }
  if (kind === "assign-me") {
    const me = state.account?.userId;
    if (me !== undefined) void state.updateIssue(issueId, { assigned_to_id: me });
    return;
  }
  state.openPicker(kind, issueId);
}

export function useIssueShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const state = useApp.getState();
      // On macOS the menu bar owns these; elsewhere the page does.
      if (!isMac && !state.composerOpen) {
        if (matchesShortcut(e, "mod+n")) {
          e.preventDefault();
          state.setComposerOpen(true);
          return;
        }
        if (matchesShortcut(e, "mod+,")) {
          e.preventDefault();
          state.setSettingsOpen(true);
          return;
        }
        if (matchesShortcut(e, "mod+r")) {
          e.preventDefault();
          void state.syncNow();
          return;
        }
      }
      if (overlayOpen(state) || isTyping(e.target) || e.repeat) return;
      if (matchesShortcut(e, "c")) {
        e.preventDefault();
        state.setComposerOpen(true);
        return;
      }
      // X picks the highlighted issue for changing several at once; Escape lets them go.
      if (state.openIssueId === null) {
        if (matchesShortcut(e, "x") && state.focusedIssueId !== null) {
          e.preventDefault();
          state.toggleSelected(state.focusedIssueId);
          return;
        }
        if (e.key === "Escape" && state.selection.length) {
          e.preventDefault();
          state.setSelection([]);
          return;
        }
      }
      const ids = targetIssueIds(state);
      if (!ids.length) return;
      const hit = ISSUE_SHORTCUTS.find((s) => matchesShortcut(e, s.shortcut));
      if (!hit) return;
      e.preventDefault();
      runIssueCommandOn(hit.kind, ids);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
