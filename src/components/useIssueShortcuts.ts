import { useEffect } from "react";
import { isTyping, matchesShortcut } from "../lib/platform";
import type { PickerKind } from "../state/app";
import { targetIssueId, useApp } from "../state/app";

/** Linear's single-key shortcuts for the open or highlighted issue. */
export const ISSUE_SHORTCUTS: { shortcut: string; kind: PickerKind | "assign-me"; label: string }[] = [
  { shortcut: "s", kind: "status", label: "Change status…" },
  { shortcut: "p", kind: "priority", label: "Change priority…" },
  { shortcut: "a", kind: "assignee", label: "Assign to…" },
  { shortcut: "i", kind: "assign-me", label: "Assign to me" },
  { shortcut: "l", kind: "labels", label: "Change labels…" },
  { shortcut: "shift+c", kind: "cycle", label: "Move to cycle…" },
];

export function runIssueCommand(kind: PickerKind | "assign-me", issueId: number) {
  const state = useApp.getState();
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
      if (state.paletteOpen || state.picker || state.composerOpen || isTyping(e.target) || e.repeat) return;
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
