import { useEffect, useMemo, useState } from "react";
import { matchesShortcut, shortcutLabel } from "../lib/platform";
import { errorMessage } from "../lib/types";
import type { Route } from "../state/app";
import { useApp } from "../state/app";
import { useDerived } from "../state/derived";

/** The project a new issue goes to by default: the one on screen. */
export function defaultProjectId(route: Route, openProjectId: number | undefined, firstTeam: number | undefined) {
  if (openProjectId !== undefined) return openProjectId;
  if (route.view === "team") return route.teamId;
  if (route.view === "project") return route.projectId;
  return firstTeam;
}

export function NewIssue() {
  const open = useApp((s) => s.composerOpen);
  const setOpen = useApp((s) => s.setComposerOpen);
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <NewIssueForm onClose={() => setOpen(false)} />
    </div>
  );
}

function NewIssueForm({ onClose }: { onClose: () => void }) {
  const route = useApp((s) => s.route);
  const openProject = useApp((s) => (s.openIssueId !== null ? s.issues.get(s.openIssueId)?.project.id : undefined));
  const createIssue = useApp((s) => s.createIssue);
  const meta = useApp((s) => s.meta);
  const d = useDerived();
  const projects = useMemo(
    () =>
      (meta?.projects ?? [])
        .filter((p) => p.trackers.length > 0)
        .map((p) => ({ ...p, label: p.parent && d.projects.has(p.parent.id) ? `${d.projects.get(p.parent.id)!.name} › ${p.name}` : p.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [meta, d],
  );
  const [projectId, setProjectId] = useState(() => defaultProjectId(route, openProject, projects[0]?.id) ?? 0);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const [trackerId, setTrackerId] = useState<number | undefined>(undefined);
  const tracker = project?.trackers.find((t) => t.id === trackerId) ?? project?.trackers[0];
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!project || !subject.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createIssue({
        project_id: project.id,
        tracker_id: tracker?.id,
        subject: subject.trim(),
        ...(description.trim() ? { description } : {}),
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
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
      className="modal new-issue"
      role="dialog"
      aria-modal="true"
      aria-label="New issue"
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
      <header className="new-issue-header">
        <select aria-label="Project" value={project?.id} onChange={(e) => setProjectId(Number(e.target.value))}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="muted">›</span>
        <select aria-label="Tracker" value={tracker?.id} onChange={(e) => setTrackerId(Number(e.target.value))}>
          {project?.trackers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="new-issue-title">New issue</span>
      </header>
      <input
        className="new-issue-subject"
        aria-label="Title"
        placeholder="Issue title"
        autoFocus
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <textarea
        className="new-issue-description"
        aria-label="Description"
        placeholder="Add a description… (Markdown)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer className="new-issue-footer">
        <button type="submit" className="button-primary" disabled={!subject.trim() || busy}>
          {busy ? "Creating…" : "Create issue"}
          <kbd className="kbd-on-accent">{shortcutLabel("mod+enter")}</kbd>
        </button>
      </footer>
    </form>
  );
}
