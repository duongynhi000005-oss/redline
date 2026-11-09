import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { teamOf } from "../lib/model";
import { allowed } from "../lib/permissions";
import { matchesShortcut, shortcutLabel } from "../lib/platform";
import { formatHours } from "../lib/time";
import type { Metadata, Version, VersionChanges } from "../lib/types";
import { useApp } from "../state/app";
import { teamCycles, useDerived } from "../state/derived";
import { Icon } from "./icons";
import { useDialogFocus } from "./useDialogFocus";

export const VERSION_STATUSES: { value: NonNullable<VersionChanges["status"]>; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "locked", label: "Locked" },
  { value: "closed", label: "Closed" },
];

export const VERSION_SHARING: { value: NonNullable<VersionChanges["sharing"]>; label: string }[] = [
  { value: "none", label: "Not shared" },
  { value: "descendants", label: "With subprojects" },
  { value: "hierarchy", label: "With project hierarchy" },
  { value: "tree", label: "With project tree" },
  { value: "system", label: "With all projects" },
];

/** Whether the user may create, change or close versions in a project, as far as Redline knows. */
export function canManageVersions(meta: Metadata | null, projectId: number): boolean {
  return allowed(meta, projectId, "manage_versions") !== false;
}

/** The projects of a team where the user may create a cycle, the team first. */
export function cycleProjects(meta: Metadata | null, teamId: number) {
  if (!meta) return [];
  return meta.projects
    .filter((p) => teamOf(p.id, meta) === teamId && p.trackers.length > 0 && allowed(meta, p.id, "manage_versions") !== false)
    .sort((a, b) => (a.id === teamId ? -1 : b.id === teamId ? 1 : a.name.localeCompare(b.name)));
}

function longDay(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "in 5 days", "today", "3 days late". */
export function dueIn(day: string, today = new Date()): string {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round((new Date(`${day}T00:00:00`).getTime() - start) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 0) return `in ${days} days`;
  return days === -1 ? "1 day ago" : `${-days} days ago`;
}

/** What a cycle is, how far along it is, and what can be done with it, above its issues. */
export function CycleHeader({ teamId, versionId }: { teamId: number; versionId: number }) {
  const meta = useApp((s) => s.meta);
  const issues = useApp((s) => s.issues);
  const openVersionDialog = useApp((s) => s.openVersionDialog);
  const saveVersion = useApp((s) => s.saveVersion);
  const openInRedmine = useApp((s) => s.openInRedmine);
  const backend = useApp((s) => s.backend);
  const d = useDerived();
  const summary = useMemo(
    () => (meta ? teamCycles(teamId, issues.values(), d, meta).find((c) => c.version.id === versionId) : undefined),
    [meta, teamId, issues, d, versionId],
  );
  // Redmine gives a version's hours only on its own page, so read them here.
  const [hours, setHours] = useState<{ id: number; estimated: number; spent: number } | null>(null);
  const current = summary?.version;
  useEffect(() => {
    if (!backend) return;
    let live = true;
    backend
      .getVersion(versionId)
      .then((v) => live && setHours({ id: v.id, estimated: v.estimated_hours ?? 0, spent: v.spent_hours ?? 0 }))
      .catch(() => live && setHours(null));
    return () => {
      live = false;
    };
  }, [backend, versionId, current, issues]);
  if (!summary) return null;
  const { version } = summary;
  const spent = hours?.id === version.id ? hours.spent : 0;
  const estimated = hours?.id === version.id ? hours.estimated : 0;
  const manage = canManageVersions(meta, version.project.id);
  const pct = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;
  const status = VERSION_STATUSES.find((s) => s.value === version.status)?.label ?? version.status;
  const sharing = VERSION_SHARING.find((s) => s.value === version.sharing);
  const project = d.projects.get(version.project.id);
  const late = version.status === "open" && version.due_date && dueIn(version.due_date).endsWith("ago");

  return (
    <section className="cycle-summary" aria-label="About this cycle">
      <div className="cycle-facts">
        <span className={`chip cycle-status cycle-status-${version.status}`}>{status}</span>
        {version.due_date ? (
          <span className={late ? "cycle-due late" : "cycle-due"} title={version.due_date}>
            Due {longDay(version.due_date)}
            {version.status === "open" && <span className="muted"> · {dueIn(version.due_date)}</span>}
          </span>
        ) : (
          <span className="muted">No due date</span>
        )}
        {version.project.id !== teamId && (
          <span className="cycle-fact">
            <Icon name="project" size={12} /> {version.project.name}
          </span>
        )}
        {sharing && sharing.value !== "none" && <span className="cycle-fact">Shared {sharing.label.toLowerCase()}</span>}
        {version.wiki_page_title && project && (
          <button
            type="button"
            className="link-button"
            onClick={() => openInRedmine(`projects/${project.identifier}/wiki/${encodeURIComponent(version.wiki_page_title!)}`)}
            title="Open the wiki page in Redmine"
          >
            Wiki: {version.wiki_page_title.replace(/_/g, " ")}
          </button>
        )}
        <span className="header-spacer" />
        {manage && (
          <>
            {version.status === "open" ? (
              <button
                type="button"
                className="header-button"
                onClick={() => void saveVersion({ id: version.id }, { status: "closed" })}
              >
                Close cycle
              </button>
            ) : (
              <button
                type="button"
                className="header-button"
                onClick={() => void saveVersion({ id: version.id }, { status: "open" })}
              >
                Reopen
              </button>
            )}
            <button type="button" className="header-button" onClick={() => openVersionDialog(teamId, version)}>
              <Icon name="edit" size={12} />
              <span>Edit</span>
            </button>
          </>
        )}
      </div>
      {version.description && <p className="cycle-description">{version.description}</p>}
      <div className="cycle-meter">
        <span
          className="cycle-progress"
          role="progressbar"
          aria-label={`${version.name} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span className="cycle-progress-done" style={{ width: `${pct}%` }} />
          <span
            className="cycle-progress-started"
            style={{ width: `${summary.total ? Math.round((summary.started / summary.total) * 100) : 0}%` }}
          />
        </span>
        <span className="cycle-count">
          {summary.done} of {summary.total} done{summary.started ? `, ${summary.started} in progress` : ""}
        </span>
        {estimated || spent ? (
          <span className="cycle-count muted">
            {spent ? `${formatHours(spent)} spent` : "Nothing spent"}
            {estimated ? ` of ${formatHours(estimated)} estimated` : ""}
          </span>
        ) : null}
      </div>
    </section>
  );
}

/** Creating a cycle, or changing one: Redmine's version form. */
export function VersionDialog() {
  const dialog = useApp((s) => s.versionDialog);
  const closeVersionDialog = useApp((s) => s.closeVersionDialog);
  // Stable, so the dialog's Escape listener isn't swapped out mid-keypress.
  const close = useCallback(() => closeVersionDialog(), [closeVersionDialog]);
  if (!dialog) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <VersionForm
        key={dialog.version?.id ?? `new:${dialog.teamId}`}
        teamId={dialog.teamId}
        version={dialog.version}
        onClose={close}
      />
    </div>
  );
}

function VersionForm({ teamId, version, onClose }: { teamId: number; version?: Version; onClose: () => void }) {
  const meta = useApp((s) => s.meta);
  const saveVersion = useApp((s) => s.saveVersion);
  const deleteVersion = useApp((s) => s.deleteVersion);
  const navigate = useApp((s) => s.navigate);
  const ref = useRef<HTMLFormElement>(null);
  useDialogFocus(ref);
  const projects = useMemo(() => cycleProjects(meta, teamId), [meta, teamId]);
  const [projectId, setProjectId] = useState(() => version?.project.id ?? projects[0]?.id ?? teamId);
  const [name, setName] = useState(version?.name ?? "");
  const [description, setDescription] = useState(version?.description ?? "");
  const [dueDate, setDueDate] = useState(version?.due_date ?? "");
  const [status, setStatus] = useState(version?.status ?? "open");
  const [sharing, setSharing] = useState(version?.sharing ?? "none");
  const [wikiPage, setWikiPage] = useState(version?.wiki_page_title ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function submit() {
    if (!name.trim() || busy) return;
    const all: VersionChanges = {
      name: name.trim(),
      description: description.trim(),
      due_date: dueDate,
      status: status as VersionChanges["status"],
      sharing: sharing as VersionChanges["sharing"],
      wiki_page_title: wikiPage.trim(),
    };
    // Send only what changed, so Redmine checks only that.
    const changes: VersionChanges = {};
    for (const [k, v] of Object.entries(all) as [keyof VersionChanges, string][]) {
      const before = version ? (version[k] ?? "") : k === "status" ? "open" : k === "sharing" ? "none" : "";
      if (v !== before) (changes as Record<string, string>)[k] = v;
    }
    if (version && Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    const saved = await saveVersion(version ? { id: version.id } : { projectId }, changes);
    if (!saved) {
      setBusy(false);
      return;
    }
    onClose();
    if (!version) navigate({ view: "cycle", teamId, versionId: saved.id });
  }

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

  return (
    <form
      ref={ref}
      className="modal time-dialog version-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="version-dialog-title"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (matchesShortcut(e, "mod+enter")) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <header className="time-dialog-header">
        <h1 id="version-dialog-title">{version ? `Edit ${version.name}` : "New cycle"}</h1>
        <span className="muted time-dialog-issue">Cycles are Redmine versions.</span>
      </header>
      <input
        className="new-issue-subject version-name"
        aria-label="Name"
        placeholder="Cycle name, like Sprint 4"
        autoFocus
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="time-dialog-comment"
        aria-label="Description"
        placeholder="What it's for (optional)"
        maxLength={255}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="time-dialog-fields version-fields">
        {!version && projects.length > 1 && (
          <label className="time-field">
            <span>Project</span>
            <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="time-field">
          <span>Due date</span>
          <input
            type="date"
            aria-label="Due date"
            value={dueDate}
            max="9999-12-31"
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>
        <label className="time-field">
          <span>Status</span>
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {VERSION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="time-field">
          <span>Sharing</span>
          <select aria-label="Sharing" value={sharing} onChange={(e) => setSharing(e.target.value)}>
            {VERSION_SHARING.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="time-field version-wiki">
          <span>Wiki page</span>
          <input aria-label="Wiki page" placeholder="None" value={wikiPage} onChange={(e) => setWikiPage(e.target.value)} />
        </label>
      </div>
      <p className="muted time-dialog-hint">
        Locked cycles take no new issues; closed ones move to past cycles. Issues stay where they are.
      </p>
      <footer className="new-issue-footer time-dialog-footer">
        {version &&
          (confirmingDelete ? (
            <span className="version-delete-confirm" role="alert">
              Delete {version.name}? Redmine only allows it when no issues use it.
              <button
                type="button"
                className="button-danger"
                onClick={async () => {
                  setBusy(true);
                  if (await deleteVersion(version)) onClose();
                  else setBusy(false);
                }}
              >
                Delete
              </button>
              <button type="button" className="button-secondary" onClick={() => setConfirmingDelete(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="button-secondary version-delete" onClick={() => setConfirmingDelete(true)}>
              Delete…
            </button>
          ))}
        <span className="header-spacer" />
        <button type="button" className="button-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button-primary" disabled={!name.trim() || busy}>
          {busy ? "Saving…" : version ? "Save" : "Create cycle"}
          <kbd className="kbd-on-accent">{shortcutLabel("mod+enter")}</kbd>
        </button>
      </footer>
    </form>
  );
}
