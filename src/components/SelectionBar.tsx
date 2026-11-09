import { shortcutLabel } from "../lib/platform";
import { useApp } from "../state/app";
import { Icon } from "./icons";
import type { IssueCommand } from "./useIssueShortcuts";
import { ISSUE_SHORTCUTS, runIssueCommandOn } from "./useIssueShortcuts";

const ACTIONS: { kind: IssueCommand; label: string }[] = [
  { kind: "status", label: "Status" },
  { kind: "priority", label: "Priority" },
  { kind: "assignee", label: "Assignee" },
  { kind: "labels", label: "Labels" },
  { kind: "cycle", label: "Cycle" },
];

/** Floats over the list while issues are picked, with what can change them all at once. */
export function SelectionBar() {
  const selection = useApp((s) => s.selection);
  const setSelection = useApp((s) => s.setSelection);
  if (!selection.length) return null;
  const count = selection.length === 1 ? "1 selected" : `${selection.length} selected`;
  return (
    <div className="selection-bar" role="toolbar" aria-label={`${count} issues`}>
      <span className="selection-count" aria-live="polite">
        {count}
      </span>
      <span className="selection-divider" />
      {ACTIONS.map((a) => {
        const shortcut = ISSUE_SHORTCUTS.find((s) => s.kind === a.kind)?.shortcut;
        return (
          <button
            key={a.kind}
            type="button"
            className="selection-action"
            title={shortcut ? `${a.label} (${shortcutLabel(shortcut)})` : a.label}
            onClick={() => runIssueCommandOn(a.kind, useApp.getState().selection)}
          >
            {a.label}
          </button>
        );
      })}
      <span className="selection-divider" />
      <button
        type="button"
        className="icon-button"
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        onClick={() => setSelection([])}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
