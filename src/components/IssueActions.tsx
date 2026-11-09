import { useCallback, useEffect, useId, useRef, useState } from "react";
import { allowed } from "../lib/permissions";
import { formatHours } from "../lib/time";
import type { Issue } from "../lib/types";
import { useApp } from "../state/app";
import { Icon } from "./icons";
import { useDialogFocus } from "./useDialogFocus";

/** Ids of an issue's sub-issues, their sub-issues and so on, as far as the cache knows. */
export function descendants(issues: Map<number, Issue>, id: number): number[] {
  const found: number[] = [];
  const queue = [id];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const i of issues.values()) {
      if (i.parent?.id === parent && !found.includes(i.id)) {
        found.push(i.id);
        queue.push(i.id);
      }
    }
  }
  return found;
}

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
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const can = issueActions(meta, issue);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!can.duplicate && !can.delete) return null;

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="issue-menu">
      <button
        ref={buttonRef}
        type="button"
        className="icon-button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={open ? undefined : "More actions"}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          role="menu"
          aria-label="Issue actions"
          className="issue-menu-panel"
          onKeyDown={(e) => {
            const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
            const at = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }
          }}
        >
          {can.duplicate && (
            <button type="button" role="menuitem" onClick={() => choose(() => void duplicateIssue(issue.id))}>
              <Icon name="copy" />
              Duplicate
            </button>
          )}
          {can.delete && (
            <button type="button" role="menuitem" className="is-danger" onClick={() => choose(() => openDeleteDialog(issue.id))}>
              <Icon name="trash" />
              Delete issue…
            </button>
          )}
        </div>
      )}
    </div>
  );
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
  const issues = useApp((s) => s.issues);
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

  const subs = descendants(issues, id).length;
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
