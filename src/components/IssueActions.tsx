import { useCallback, useEffect, useRef, useState } from "react";
import { allowed } from "../lib/permissions";
import { formatHours } from "../lib/time";
import type { Issue } from "../lib/types";
import { useApp } from "../state/app";
import { useIssueCount } from "../state/counts";
import { MenuButton, type MenuItem } from "./Menu";
import { useDialogFocus } from "./useDialogFocus";

/** Whether the user may copy an issue, or delete it, as far as Redline knows. */
export function issueActions(meta: ReturnType<typeof useApp.getState>["meta"], issue: Issue) {
  return {
    duplicate: allowed(meta, issue.project.id, "add_issues") !== false,
    delete: allowed(meta, issue.project.id, "delete_issues") !== false,
  };
}

/** The issue's "…" menu: Duplicate and Delete. */
export function IssueMenu({ issue }: { issue: Issue }) {
  const meta = useApp((s) => s.meta);
  const duplicateIssue = useApp((s) => s.duplicateIssue);
  const openDeleteDialog = useApp((s) => s.openDeleteDialog);
  const can = issueActions(meta, issue);
  const items: MenuItem[] = [];
  if (can.duplicate) items.push({ label: "Duplicate", icon: "copy", run: () => void duplicateIssue(issue.id) });
  if (can.delete) items.push({ label: "Delete issue…", icon: "trash", danger: true, run: () => openDeleteDialog(issue.id) });
  return <MenuButton label="More actions" menuLabel="Issue actions" items={items} />;
}

/** Asks before deleting an issue, saying what goes with it. */
export function DeleteIssueDialog() {
  const id = useApp((s) => s.deleteDialog);
  const closeDeleteDialog = useApp((s) => s.closeDeleteDialog);
  const close = useCallback(() => closeDeleteDialog(), [closeDeleteDialog]);
  if (id === null) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <DeleteIssueForm key={id} id={id} onClose={close} />
    </div>
  );
}

function DeleteIssueForm({ id, onClose }: { id: number; onClose: () => void }) {
  const issue = useApp((s) => s.issues.get(id));
  // Sub-issues at any depth, open or closed, as Redmine counts them.
  const subs =
    useIssueCount({ conditions: [{ field: "parent_id", op: "~", values: [String(id)] }] }) ?? 0;
  const deleteIssue = useApp((s) => s.deleteIssue);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useDialogFocus(ref);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const spent = issue?.total_spent_hours ?? issue?.spent_hours ?? 0;
  const also = [
    subs ? `its ${subs === 1 ? "sub-issue" : `${subs} sub-issues`}` : null,
    spent ? `${formatHours(spent)} of logged time` : null,
  ].filter(Boolean);

  async function submit() {
    if (busy) return;
    setBusy(true);
    if (await deleteIssue(id)) onClose();
    else setBusy(false);
  }

  return (
    <form
      ref={ref}
      className="modal confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-issue-title"
      aria-describedby="delete-issue-text"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h1 id="delete-issue-title">
        Delete #{id}
        {issue ? ` ${issue.subject}` : ""}?
      </h1>
      <p id="delete-issue-text" className="muted">
        It's deleted in Redmine for everyone{also.length ? `, with ${also.join(" and ")}` : ""}. This can't be undone.
      </p>
      <footer className="confirm-dialog-footer">
        <button type="button" className="button-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button-danger" disabled={busy}>
          {busy ? "Deleting…" : "Delete issue"}
        </button>
      </footer>
    </form>
  );
}
