import { useEffect } from "react";
import { isMac, isTyping, matchesShortcut } from "../lib/platform";
import type { PickerKind } from "../state/app";
import { overlayOpen, targetIssueId, useApp } from "../state/app";

/** Linear's single-key shortcuts for the open or highlighted issue. */
export type IssueCommand = PickerKind | "assign-me" | "subscribe" | "open-in-redmine";

export const ISSUE_SHORTCUTS: { shortcut: string; kind: IssueCommand; label: string }[] = [
  { shortcut: "s", kind: "status", label: "Change status…" },
  { shortcut: "p", kind: "priority", label: "Change priority…" },
  { shortcut: "a", kind: "assignee", label: "Assign to…" },
  { shortcut: "i", kind: "assign-me", label: "Assign to me" },
  { shortcut: "l", kind: "labels", label: "Change labels…" },
  { shortcut: "shift+c", kind: "cycle", label: "Move to cycle…" },
  { shortcut: "shift+s", kind: "subscribe", label: "Subscribe or unsubscribe" },
  { shortcut: "mod+shift+o", kind: "open-in-redmine", label: "Open in Redmine" },
];

export function runIssueCommand(kind: IssueCommand, issueId: number) {
  const state = useApp.getState();
  if (kind === "subscribe") {
    void state.toggleSubscribe(issueId);
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
      const id = targetIssueId(state);
      if (id === null) return;
      const hit = ISSUE_SHORTCUTS.find((s) => matchesShortcut(e, s.shortcut));
      if (!hit) return;
      e.preventDefault();
      runIssueCommand(hit.kind, id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
