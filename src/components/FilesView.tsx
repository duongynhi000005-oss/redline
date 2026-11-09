import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { formatSize } from "../lib/attachments";
import { relativeTime, teamOf } from "../lib/model";
import { filesAccess } from "../lib/permissions";
import type { ProjectFile, Version } from "../lib/types";
import { errorMessage } from "../lib/types";
import { useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { Avatar } from "./Avatar";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./icons";
import { useDialogFocus } from "./useDialogFocus";

type Loaded<T> = { key: string; value?: T; error?: string };

/** A team's files, grouped as Redmine does: the team's own first, then each version's. */
export function fileGroups(files: ProjectFile[], versions: Version[]): { version: Version | null; name: string; files: ProjectFile[] }[] {
  const byVersion = new Map<number | null, ProjectFile[]>();
  for (const f of files) {
    const key = f.version?.id ?? null;
    byVersion.set(key, [...(byVersion.get(key) ?? []), f]);
  }
  const order = new Map(versions.map((v, i) => [v.id, i]));
  const groups = [...byVersion.entries()].map(([id, list]) => {
    const version = id === null ? null : (versions.find((v) => v.id === id) ?? null);
    const name = id === null ? "" : (version?.name ?? list[0]!.version!.name);
    return { id, version, name, files: [...list].sort((a, b) => a.filename.localeCompare(b.filename)) };
  });
  groups.sort((a, b) => {
    if (a.id === null || b.id === null) return a.id === null ? -1 : 1;
    return (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || a.name.localeCompare(b.name);
  });
  return groups.map(({ version, name, files }) => ({ version, name, files }));
}

/** A team's Files area: downloads, by version, with upload and delete for those who manage files. */
export function FilesView({ projectId }: { projectId: number }) {
  const backend = useApp((s) => s.backend);
  const meta = useApp((s) => s.meta);
  const navigate = useApp((s) => s.navigate);
  const openInRedmine = useApp((s) => s.openInRedmine);
  const saveAttachment = useApp((s) => s.saveAttachment);
  const showToast = useApp((s) => s.showToast);
  const d = useDerived();
  const project = d.projects.get(projectId);
  const can = filesAccess(meta, projectId);

  const [reload, bump] = useReducer((n: number) => n + 1, 0);
  const key = `${projectId}:${reload}`;
  const [loaded, setLoaded] = useState<Loaded<ProjectFile[]> | null>(null);
  const [uploading, setUploading] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState<ProjectFile | null>(null);

  useEffect(() => {
    if (!backend) return;
    let live = true;
    backend
      .projectFiles(projectId)
      .then((value) => live && setLoaded({ key, value }))
      .catch((e) => live && setLoaded({ key, error: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [backend, projectId, key]);

  const versions = useMemo(() => (meta?.versions ?? []).filter((v) => v.project.id === projectId), [meta, projectId]);
  const files = loaded?.key === key ? loaded.value : undefined;
  const groups = useMemo(() => (files ? fileGroups(files, versions) : []), [files, versions]);

  if (!project) {
    return (
      <section className="main" aria-label="Files">
        <header className="main-header" data-tauri-drag-region />
        <div className="empty-state muted">This team is gone from Redmine, or you can no longer see it.</div>
      </section>
    );
  }

  async function pick() {
    const paths = await backend?.pickFiles();
    if (paths?.length) setUploading(paths);
  }

  return (
    <section className="main detail files-view" aria-label={`${project.name} files`}>
      <header className="main-header" data-tauri-drag-region>
        <span className="breadcrumb">
          <button type="button" className="link-button" onClick={() => navigate({ view: "overview", projectId })}>
            {project.name}
          </button>
          <Icon name="chevron-right" size={12} />
          <h1 className="breadcrumb-title">Files</h1>
          {files && <span className="count">{files.length}</span>}
        </span>
        <span className="header-spacer" data-tauri-drag-region />
        {can.manage && (
          <button type="button" className="button-secondary small" onClick={() => void pick()}>
            <Icon name="plus" size={12} />
            Add files
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          onClick={() => openInRedmine(`projects/${project.identifier}/files`)}
          aria-label="Open in Redmine"
          title="Open in Redmine"
        >
          <Icon name="external" />
        </button>
      </header>
      <div className="detail-body">
        <div className="detail-content files-content">
          {loaded?.key === key && loaded.error ? (
            <p className="muted">{loaded.error}</p>
          ) : !files ? (
            <p className="muted">Loading…</p>
          ) : files.length === 0 ? (
            <div className="empty-state news-empty">
              <Icon name="file" size={24} />
              <p>{project.name} has no files yet.</p>
              {can.manage && (
                <button type="button" className="button-primary" onClick={() => void pick()}>
                  Add files
                </button>
              )}
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.version?.id ?? g.name} className="files-group" aria-label={g.name || project.name}>
                <header className="connections-header">
                  <h2>
                    {g.version ? (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => meta && navigate({ view: "cycle", teamId: teamOf(projectId, meta), versionId: g.version!.id })}
                      >
                        {g.name}
                      </button>
                    ) : (
                      g.name || `All of ${project.name}`
                    )}
                  </h2>
                  <span className="count">{g.files.length}</span>
                </header>
                <ul className="files-list">
                  {g.files.map((f) => (
                    <li key={f.id} className="file-row">
                      <span className="file-icon" aria-hidden>
                        <Icon name="file" />
                      </span>
                      <span className="file-main">
                        <button type="button" className="file-name link-button" onClick={() => void saveAttachment(f)} title={`Save ${f.filename}`}>
                          {f.filename}
                        </button>
                        {f.description && <span className="file-description muted">{f.description}</span>}
                      </span>
                      <span className="file-meta muted">{formatSize(f.filesize)}</span>
                      <span className="file-meta muted" title={f.downloads === 1 ? "1 download" : `${f.downloads} downloads`}>
                        <Icon name="download" size={12} />
                        {f.downloads}
                      </span>
                      <span className="file-meta file-who muted" title={f.author ? `Added by ${f.author.name}` : undefined}>
                        <Avatar name={f.author?.name} size={16} />
                        {f.created_on ? relativeTime(f.created_on) : ""}
                      </span>
                      <span className="file-actions">
                        <button type="button" className="icon-button small" onClick={() => void saveAttachment(f)} aria-label={`Save ${f.filename}`} title="Save…">
                          <Icon name="download" />
                        </button>
                        {can.manage && (
                          <button type="button" className="icon-button small" onClick={() => setDeleting(f)} aria-label={`Delete ${f.filename}`} title="Delete">
                            <Icon name="trash" />
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
      {uploading && (
        <UploadDialog
          projectId={projectId}
          teamName={project.name}
          paths={uploading}
          versions={versions.filter((v) => v.status !== "closed")}
          onClose={() => setUploading(null)}
          onDone={(count) => {
            setUploading(null);
            showToast(count === 1 ? "Added 1 file" : `Added ${count} files`);
            bump();
          }}
        />
      )}
      {deleting && backend && (
        <ConfirmDialog
          title={`Delete ${deleting.filename}?`}
          text="It's deleted from Redmine for everyone. This can't be undone."
          action="Delete file"
          busyLabel="Deleting…"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await backend.deleteProjectFile(deleting.id);
            setDeleting(null);
            showToast(`Deleted ${deleting.filename}`);
            bump();
          }}
        />
      )}
    </section>
  );
}

/** Where picked files go: a version, or the whole team, with an optional description. */
function UploadDialog({
  projectId,
  teamName,
  paths,
  versions,
  onClose,
  onDone,
}: {
  projectId: number;
  teamName: string;
  paths: string[];
  versions: Version[];
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const backend = useApp((s) => s.backend);
  const ref = useRef<HTMLFormElement>(null);
  useDialogFocus(ref);
  const [version, setVersion] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = paths.map((p) => p.split(/[\\/]/).pop() ?? p);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function submit() {
    if (!backend || busy) return;
    setBusy(true);
    setError(null);
    try {
      await backend.addProjectFiles(projectId, paths, version, description.trim());
      onDone(paths.length);
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        ref={ref}
        className="modal time-dialog upload-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-dialog-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className="time-dialog-header">
          <h1 id="upload-dialog-title">{names.length === 1 ? `Add ${names[0]}` : `Add ${names.length} files`}</h1>
          <span className="muted time-dialog-issue">To {teamName}'s files in Redmine</span>
        </header>
        {names.length > 1 && (
          <ul className="upload-names">
            {names.map((n, i) => (
              <li key={`${i}:${n}`}>
                <Icon name="file" size={12} />
                {n}
              </li>
            ))}
          </ul>
        )}
        <div className="time-dialog-fields upload-fields">
          <label className="time-field">
            <span>Version</span>
            <select aria-label="Version" value={version ?? ""} onChange={(e) => setVersion(e.target.value ? Number(e.target.value) : null)} autoFocus>
              <option value="">None (the whole team)</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="time-field upload-description">
            <span>Description</span>
            <input
              aria-label="Description"
              placeholder="Optional"
              maxLength={255}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="new-issue-footer time-dialog-footer">
          <span className="header-spacer" />
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? "Uploading…" : "Upload"}
          </button>
        </footer>
      </form>
    </div>
  );
}
