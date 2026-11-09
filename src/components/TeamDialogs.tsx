import { useCallback, useEffect, useRef, useState } from "react";
import { projectTree } from "../lib/model";
import { matchesShortcut, shortcutLabel } from "../lib/platform";
import type { Project, ProjectChanges } from "../lib/types";
import { useApp } from "../state/app";
import { useDialogFocus } from "./useDialogFocus";

/** Redmine's rule for identifiers: a lowercase letter, then letters, digits, dashes or underscores, 100 at most. */
export function validIdentifier(s: string): boolean {
  return /^[a-z][a-z0-9_-]{0,99}$/.test(s) && s !== "new";
}

/** An identifier from a name, under the parent's, like web-design. */
export function suggestIdentifier(name: string, parent?: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";
  const id = parent ? `${parent}-${slug}` : /^[a-z]/.test(slug) ? slug : `team-${slug}`;
  return id.slice(0, 100).replace(/-+$/, "");
}

function useEscape(onClose: () => void) {
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
}

/** Creates a sub-team, or changes a team's name, description, homepage and visibility. */
export function TeamDialog() {
  const dialog = useApp((s) => s.teamDialog);
  const meta = useApp((s) => s.meta);
  const closeTeamDialog = useApp((s) => s.closeTeamDialog);
  const close = useCallback(() => closeTeamDialog(), [closeTeamDialog]);
  if (!dialog || !meta) return null;
  const project = "projectId" in dialog ? meta.projects.find((p) => p.id === dialog.projectId) : undefined;
  const parent = "parentId" in dialog ? meta.projects.find((p) => p.id === dialog.parentId) : undefined;
  if (!project && !parent) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <TeamForm key={project ? project.id : `new:${parent!.id}`} project={project} parent={parent} onClose={close} />
    </div>
  );
}

function TeamForm({ project, parent, onClose }: { project?: Project; parent?: Project; onClose: () => void }) {
  const saveProject = useApp((s) => s.saveProject);
  const navigate = useApp((s) => s.navigate);
  const ref = useRef<HTMLFormElement>(null);
  useDialogFocus(ref);
  useEscape(onClose);
  const [name, setName] = useState(project?.name ?? "");
  const [identifier, setIdentifier] = useState<string | null>(null);
  const [description, setDescription] = useState(project?.description ?? "");
  const [homepage, setHomepage] = useState(project?.homepage ?? "");
  const [isPublic, setIsPublic] = useState(project ? project.is_public !== false : parent?.is_public !== false);
  const [inherit, setInherit] = useState(true);
  const [busy, setBusy] = useState(false);

  const id = identifier ?? suggestIdentifier(name, parent?.identifier);
  const idInvalid = !project && id !== "" && !validIdentifier(id);
  const ready = name.trim() !== "" && (project !== undefined || (id !== "" && !idInvalid));

  async function submit() {
    if (!ready || busy) return;
    let changes: ProjectChanges;
    if (project) {
      const all = { name: name.trim(), description: description.trim(), homepage: homepage.trim(), is_public: isPublic };
      const before = {
        name: project.name,
        description: project.description ?? "",
        homepage: project.homepage ?? "",
        is_public: project.is_public !== false,
      };
      // Send only what changed, so Redmine checks only that.
      changes = Object.fromEntries(
        Object.entries(all).filter(([k, v]) => v !== before[k as keyof typeof before]),
      ) as ProjectChanges;
      if (Object.keys(changes).length === 0) {
        onClose();
        return;
      }
    } else {
      changes = {
        name: name.trim(),
        identifier: id,
        is_public: isPublic,
        inherit_members: inherit,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(homepage.trim() ? { homepage: homepage.trim() } : {}),
      };
    }
    setBusy(true);
    const saved = await saveProject(project ? { id: project.id } : { parentId: parent!.id }, changes);
    if (!saved) {
      setBusy(false);
      return;
    }
    onClose();
    if (!project) navigate({ view: "overview", projectId: saved.id });
  }

  return (
    <form
      ref={ref}
      className="modal time-dialog team-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-dialog-title"
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
        <h1 id="team-dialog-title">{project ? `Edit ${project.name}` : `New sub-team in ${parent!.name}`}</h1>
        <span className="muted time-dialog-issue">Teams are Redmine projects.</span>
      </header>
      <input
        className="new-issue-subject version-name"
        aria-label="Name"
        placeholder="Team name, like Design"
        autoFocus
        maxLength={255}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        className="time-dialog-comment team-description"
        aria-label="Description"
        placeholder="What the team works on (optional, Markdown)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="time-dialog-fields version-fields">
        {!project && (
          <label className="time-field team-identifier-field">
            <span>Identifier</span>
            <input
              aria-label="Identifier"
              aria-invalid={idInvalid || undefined}
              maxLength={100}
              value={id}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </label>
        )}
        <label className="time-field team-homepage-field">
          <span>Homepage</span>
          <input
            aria-label="Homepage"
            type="url"
            placeholder="https://"
            value={homepage}
            onChange={(e) => setHomepage(e.target.value)}
          />
        </label>
      </div>
      <label className="team-check">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        Public: anyone who can sign in to Redmine can see it
      </label>
      {!project && (
        <label className="team-check">
          <input type="checkbox" checked={inherit} onChange={(e) => setInherit(e.target.checked)} />
          Same members as {parent!.name}
        </label>
      )}
      {idInvalid ? (
        <p className="form-error" role="alert">
          Identifiers start with a lowercase letter and use only a to z, digits, dashes and underscores.
        </p>
      ) : (
        !project && <p className="muted time-dialog-hint">The identifier is part of the team's Redmine address and can't change later.</p>
      )}
      <footer className="new-issue-footer time-dialog-footer">
        <span className="header-spacer" />
        <button type="button" className="button-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button-primary" disabled={!ready || busy}>
          {busy ? "Saving…" : project ? "Save" : "Create sub-team"}
          <kbd className="kbd-on-accent">{shortcutLabel("mod+enter")}</kbd>
        </button>
      </footer>
    </form>
  );
}

/** Asks before deleting a team: it takes everything in it, so its identifier must be typed, as Redmine asks. */
export function DeleteTeamDialog() {
  const id = useApp((s) => s.deleteTeamDialog);
  const closeDeleteTeamDialog = useApp((s) => s.closeDeleteTeamDialog);
  const close = useCallback(() => closeDeleteTeamDialog(), [closeDeleteTeamDialog]);
  if (id === null) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <DeleteTeamForm key={id} id={id} onClose={close} />
    </div>
  );
}

function DeleteTeamForm({ id, onClose }: { id: number; onClose: () => void }) {
  const meta = useApp((s) => s.meta);
  const issues = useApp((s) => s.issues);
  const deleteProject = useApp((s) => s.deleteProject);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useDialogFocus(ref);
  useEscape(onClose);
  const project = meta?.projects.find((p) => p.id === id);
  if (!meta || !project) return null;

  const tree = projectTree(id, meta.projects);
  const subs = tree.size - 1;
  let count = 0;
  for (const i of issues.values()) if (tree.has(i.project.id)) count++;
  const also = [
    subs ? `${subs === 1 ? "its sub-team" : `its ${subs} sub-teams`}` : null,
    count ? `${count === 1 ? "1 issue" : `${count} issues`}` : null,
    "its wiki, files and logged time",
  ].filter(Boolean) as string[];
  const list = also.length > 1 ? `${also.slice(0, -1).join(", ")} and ${also[also.length - 1]}` : also[0];
  const matches = typed.trim() === project.identifier;

  async function submit() {
    if (!matches || busy) return;
    setBusy(true);
    if (!(await deleteProject(id))) setBusy(false);
  }

  return (
    <form
      ref={ref}
      className="modal confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-team-title"
      aria-describedby="delete-team-text"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h1 id="delete-team-title">Delete {project.name}?</h1>
      <p id="delete-team-text" className="muted">
        It's deleted in Redmine for everyone, with {list}. This can't be undone.
      </p>
      <label className="time-field delete-team-confirm">
        <span>
          Type <strong>{project.identifier}</strong> to confirm
        </span>
        <input aria-label="Identifier to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </label>
      <footer className="confirm-dialog-footer">
        <button type="button" className="button-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button-danger" disabled={!matches || busy}>
          {busy ? "Deleting…" : "Delete team"}
        </button>
      </footer>
    </form>
  );
}
