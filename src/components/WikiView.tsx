import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { relativeTime } from "../lib/model";
import { wikiAccess } from "../lib/permissions";
import { isTyping, matchesShortcut, shortcutLabel } from "../lib/platform";
import type { WikiPage } from "../lib/types";
import { errorMessage } from "../lib/types";
import { ancestors, descendants, prettyTitle, sameTitle, titleProblem, titleize, wikiTree, withoutTitleHeading } from "../lib/wiki";
import { overlayOpen, useApp } from "../state/app";
import { AttachmentGrid } from "./Attachments";
import { Icon } from "./icons";
import { Markdown } from "./Markdown";
import { MenuButton, type MenuItem } from "./Menu";
import { useDialogFocus } from "./useDialogFocus";

/** How many older versions the history lists, newest first. */
const HISTORY_LENGTH = 10;

type Loaded<T> = { key: string; value?: T; error?: string; missing?: boolean };

/** What the editor is working on: an existing page, or a new one with a title still to settle. */
type Draft = { kind: "edit"; page: WikiPage } | { kind: "new"; title: string; parent: string | null };

/** When something happened, to read in a sentence: "just now", "5m ago", "yesterday", "on Nov 2". */
export function whenSaid(iso: string): string {
  const r = relativeTime(iso);
  if (r === "now") return "just now";
  if (/^\d+[mh]$/.test(r)) return `${r} ago`;
  if (r === "Yesterday") return "yesterday";
  return r ? `on ${r}` : "";
}

function longDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** A project's wiki: its pages as a tree, the page being read, its history, and an editor. */
export function WikiView({ projectId, title }: { projectId: number; title: string | null }) {
  const backend = useApp((s) => s.backend);
  const meta = useApp((s) => s.meta);
  const navigate = useApp((s) => s.navigate);
  const openInRedmine = useApp((s) => s.openInRedmine);
  const showToast = useApp((s) => s.showToast);
  const overlay = useApp(overlayOpen);
  const project = meta?.projects.find((p) => p.id === projectId);
  const can = wikiAccess(meta, projectId);

  const [reload, bump] = useReducer((n: number) => n + 1, 0);
  const indexKey = `${projectId}:${reload}`;
  const pageKey = `${projectId}:${title ?? ""}:${reload}`;
  const [index, setIndex] = useState<Loaded<WikiPage[]> | null>(null);
  const [page, setPage] = useState<Loaded<WikiPage> | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  /** An older version being read, or null for the latest. */
  const [reading, setReading] = useState<WikiPage | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** The start page's title, once read: Redmine's default is Wiki. */
  const [start, setStart] = useState<{ projectId: number; title: string } | null>(null);

  useEffect(() => {
    if (!backend) return;
    let live = true;
    backend
      .wikiIndex(projectId)
      .then((value) => live && setIndex({ key: indexKey, value }))
      .catch((e) => live && setIndex({ key: indexKey, error: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [backend, projectId, indexKey]);

  useEffect(() => {
    if (!backend) return;
    let live = true;
    backend
      .wikiPage(projectId, title)
      .then((value) => {
        if (!live) return;
        setPage({ key: pageKey, value });
        if (title === null) setStart({ projectId, title: value.title });
      })
      .catch(
        (e: { code?: string }) =>
          live && setPage({ key: pageKey, error: errorMessage(e), missing: e?.code === "not_found" }),
      );
    return () => {
      live = false;
    };
  }, [backend, projectId, title, pageKey]);

  // A new page or project starts in reading mode.
  const [shown, setShown] = useState(pageKey);
  if (shown !== `${projectId}:${title ?? ""}:${reload}`) {
    setShown(pageKey);
    setReading(null);
    if (draft?.kind === "edit") setDraft(null);
  }

  const pages = index?.key === indexKey ? index.value : undefined;
  const current = page?.key === pageKey ? page : null;
  const latest = current?.value;
  const shownPage = reading ?? latest;
  const open = (t: string | null) => {
    setDraft(null);
    navigate({ view: "wiki", projectId, title: t });
  };

  // E edits the page being read.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (overlay || deleting || draft || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "e" && can.edit && latest && !reading) {
        e.preventDefault();
        setDraft({ kind: "edit", page: latest });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, deleting, draft, can.edit, latest, reading]);

  if (!meta || !project) {
    return (
      <section className="main" aria-label="Wiki">
        <header className="main-header" data-tauri-drag-region />
        <div className="empty-state muted">This team is gone from Redmine, or you can no longer see it.</div>
      </section>
    );
  }

  const startTitle = start?.projectId === projectId ? start.title : "Wiki";
  const isStart = latest !== undefined && (title === null || sameTitle(latest.title, startTitle));
  // The Wiki crumb is the start page, so it isn't repeated.
  const trail = latest && pages ? ancestors(latest.title, pages).filter((p) => !sameTitle(p.title, startTitle)) : [];
  const children = latest && pages ? (wikiTree(pages).get(latest.title.toLowerCase()) ?? []) : [];
  const editing = draft !== null;
  const items: MenuItem[] = [];
  if (can.edit) {
    items.push({ label: "New page…", icon: "plus", run: () => setDraft({ kind: "new", title: "", parent: null }) });
    if (latest) items.push({ label: "New sub-page…", icon: "sub-issue", run: () => setDraft({ kind: "new", title: "", parent: latest.title }) });
  }
  if (can.delete && latest) items.push({ label: "Delete page…", icon: "trash", danger: true, run: () => setDeleting(true) });

  function saved(t: string) {
    const wasNew = draft?.kind === "new";
    setDraft(null);
    setReading(null);
    bump();
    if (wasNew) navigate({ view: "wiki", projectId, title: t });
  }

  return (
    <section className="main detail wiki-view" aria-label={`${project.name} wiki`}>
      <header className="main-header" data-tauri-drag-region>
        <span className="breadcrumb">
          <button type="button" className="link-button" onClick={() => navigate({ view: "overview", projectId })}>
            {project.name}
          </button>
          <Icon name="chevron-right" size={12} />
          {(latest && !isStart) || draft ? (
            <button type="button" className="link-button" onClick={() => open(null)}>
              Wiki
            </button>
          ) : (
            "Wiki"
          )}
          {trail.map((p) => (
            <span key={p.title} className="breadcrumb-part">
              <Icon name="chevron-right" size={12} />
              <button type="button" className="link-button" onClick={() => open(p.title)}>
                {prettyTitle(p.title)}
              </button>
            </span>
          ))}
          {latest && !isStart && (
            <span className="breadcrumb-part">
              <Icon name="chevron-right" size={12} />
              {prettyTitle(latest.title)}
            </span>
          )}
        </span>
        <span className="header-spacer" data-tauri-drag-region />
        {latest && !editing && can.edit && (
          <button
            type="button"
            className="button-secondary small"
            onClick={() => setDraft({ kind: "edit", page: latest })}
            title={`Edit page (${shortcutLabel("e")})`}
          >
            <Icon name="edit" size={12} />
            Edit
          </button>
        )}
        {latest && can.history && (
          <button
            type="button"
            className={showHistory ? "icon-button is-on" : "icon-button"}
            aria-pressed={showHistory}
            onClick={() => setShowHistory((s) => !s)}
            aria-label="History"
            title="History"
          >
            <Icon name="history" />
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          onClick={() => openInRedmine(`projects/${project.identifier}/wiki${latest ? `/${encodeURIComponent(latest.title)}` : ""}`)}
          aria-label="Open in Redmine"
          title="Open in Redmine"
        >
          <Icon name="external" />
        </button>
        <MenuButton label="Page actions" menuLabel="Page actions" items={items} />
      </header>
      <div className="detail-body wiki-body">
        <nav className="wiki-tree" aria-label="Pages">
          <header className="wiki-tree-header">
            <span>Pages</span>
            {pages && <span className="count">{pages.length}</span>}
          </header>
          {index?.key === indexKey && index.error ? (
            <p className="muted wiki-tree-note">{index.error}</p>
          ) : !pages ? (
            <p className="muted wiki-tree-note">Loading…</p>
          ) : pages.length === 0 ? (
            <p className="muted wiki-tree-note">No pages yet.</p>
          ) : (
            <PageTree pages={pages} current={latest?.title ?? null} onOpen={open} />
          )}
        </nav>
        <div className="detail-content wiki-content">
          {draft ? (
            <WikiEditor
              key={draft.kind === "edit" ? `edit:${draft.page.title}:${draft.page.version}` : `new:${draft.parent ?? ""}`}
              projectId={projectId}
              draft={draft}
              pages={pages ?? []}
              canMove={can.move}
              onCancel={() => setDraft(null)}
              onSaved={saved}
            />
          ) : !current ? (
            <p className="muted">Loading…</p>
          ) : current.error ? (
            <MissingPage
              title={title}
              missing={current.missing === true}
              error={current.error}
              hasPages={(pages?.length ?? 0) > 0}
              canEdit={can.edit}
              onCreate={(t) => setDraft({ kind: "new", title: t, parent: null })}
            />
          ) : shownPage ? (
            <article className="wiki-page" aria-label={prettyTitle(shownPage.title)}>
              {reading && latest && (
                <div className="wiki-old-version" role="status">
                  <Icon name="history" size={14} />
                  <span className="wiki-old-version-text">
                    You're reading version {reading.version} of {latest.version}
                    {reading.updated_on && `, from ${longDay(reading.updated_on)}`}.
                  </span>
                  {can.edit && (
                    <button
                      type="button"
                      className="button-secondary small"
                      onClick={() =>
                        void backend
                          ?.saveWikiPage(projectId, latest.title, {
                            text: reading.text ?? "",
                            comments: `Restored version ${reading.version}`,
                            version: latest.version,
                          })
                          .then(() => {
                            showToast(`Restored version ${reading.version}`);
                            setReading(null);
                            bump();
                          })
                          .catch((e) => showToast(`Couldn't restore it: ${errorMessage(e)}`))
                      }
                    >
                      Restore this version
                    </button>
                  )}
                  <button type="button" className="button-secondary small" onClick={() => setReading(null)}>
                    Show latest
                  </button>
                </div>
              )}
              <h1 className="detail-title">{prettyTitle(shownPage.title)}</h1>
              <p className="muted wiki-byline">
                {shownPage.author?.name ?? "Someone"} {shownPage.version > 1 ? "edited" : "wrote"} this
                {shownPage.updated_on ? ` ${whenSaid(shownPage.updated_on)}` : ""}
                {shownPage.comments ? ` · “${shownPage.comments}”` : ""}
              </p>
              {shownPage.text?.trim() ? (
                <Markdown
                  text={withoutTitleHeading(shownPage.text, shownPage.title)}
                  projectId={projectId}
                  wikiPages={pages}
                  attachments={latest?.attachments}
                />
              ) : (
                <p className="muted">This page is empty.</p>
              )}
              {children.length > 0 && !reading && (
                <section className="connections" aria-label="Sub-pages">
                  <header className="connections-header">
                    <h2>Sub-pages</h2>
                    <span className="count">{children.length}</span>
                  </header>
                  <ul className="linked-issues">
                    {children.map((c) => (
                      <li key={c.title} className="linked-issue">
                        <button type="button" className="linked-issue-open" onClick={() => open(c.title)}>
                          <Icon name="wiki" />
                          <span className="linked-issue-subject">{prettyTitle(c.title)}</span>
                          {c.updated_on && <span className="muted team-open-count">{relativeTime(c.updated_on)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {!reading && <AttachmentGrid attachments={latest?.attachments} />}
            </article>
          ) : null}
        </div>
        {showHistory && latest && can.history && !editing && (
          <History projectId={projectId} page={latest} reading={reading} onRead={setReading} />
        )}
      </div>
      {deleting && latest && pages && (
        <DeletePageDialog
          projectId={projectId}
          page={latest}
          below={descendants(latest.title, pages).length}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            showToast(`Deleted ${prettyTitle(latest.title)}`);
            bump();
            open(latest.parent?.title ?? null);
          }}
        />
      )}
    </section>
  );
}

/** The wiki's pages as a tree, the open page marked. */
function PageTree({ pages, current, onOpen }: { pages: WikiPage[]; current: string | null; onOpen: (title: string) => void }) {
  const tree = useMemo(() => wikiTree(pages), [pages]);
  const branch = (parent: string, depth: number, seen: Set<string>): React.ReactNode => {
    const list = (tree.get(parent) ?? []).filter((p) => !seen.has(p.title.toLowerCase()));
    if (!list.length) return null;
    return (
      <ul className="wiki-tree-list" role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? "Pages" : undefined}>
        {list.map((p) => {
          const key = p.title.toLowerCase();
          const here = current !== null && sameTitle(p.title, current);
          const next = new Set(seen).add(key);
          return (
            <li key={p.title} role="treeitem" aria-selected={here} aria-expanded={tree.has(key) ? true : undefined}>
              <button
                type="button"
                className={here ? "wiki-tree-item is-current" : "wiki-tree-item"}
                style={{ paddingLeft: 8 + depth * 14 }}
                aria-current={here ? "page" : undefined}
                onClick={() => onOpen(p.title)}
              >
                <Icon name="wiki" size={12} />
                <span>{prettyTitle(p.title)}</span>
              </button>
              {branch(key, depth + 1, next)}
            </li>
          );
        })}
      </ul>
    );
  };
  return <>{branch("", 0, new Set())}</>;
}

function MissingPage({
  title,
  missing,
  error,
  hasPages,
  canEdit,
  onCreate,
}: {
  title: string | null;
  missing: boolean;
  error: string;
  hasPages: boolean;
  canEdit: boolean;
  onCreate: (title: string) => void;
}) {
  if (!missing) return <p className="muted">{error}</p>;
  const wanted = title ?? (hasPages ? null : "Wiki");
  return (
    <div className="empty-state wiki-missing">
      <Icon name="wiki" size={24} />
      <p>
        {title
          ? `There's no page called “${prettyTitle(title)}” yet.`
          : hasPages
            ? "This wiki has no start page. Pick a page from the list."
            : "This wiki is empty."}
      </p>
      {canEdit && wanted && (
        <button type="button" className="button-primary" onClick={() => onCreate(wanted)}>
          {title ? "Create it" : "Write the first page"}
        </button>
      )}
    </div>
  );
}

/** Writes a page: its text with a preview, a comment for the history, and its parent where that can change. */
function WikiEditor({
  projectId,
  draft,
  pages,
  canMove,
  onCancel,
  onSaved,
}: {
  projectId: number;
  draft: Draft;
  pages: WikiPage[];
  canMove: boolean;
  onCancel: () => void;
  onSaved: (title: string) => void;
}) {
  const backend = useApp((s) => s.backend);
  const isNew = draft.kind === "new";
  const original = draft.kind === "edit" ? draft.page : null;
  const [title, setTitle] = useState(isNew ? draft.title : "");
  const [text, setText] = useState(original?.text ?? (isNew && draft.title ? `# ${prettyTitle(draft.title)}\n\n` : ""));
  const [comments, setComments] = useState("");
  const startParent = isNew ? (draft.parent ?? "") : (original?.parent?.title ?? "");
  const [parent, setParent] = useState(startParent);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const problem = isNew ? titleProblem(title, pages) : null;
  const dirty = isNew ? title.trim() !== "" || text.trim() !== "" : text !== (original?.text ?? "") || parent !== startParent;
  // Pages a page can move under: not itself or anything under it.
  const below = original ? new Set([original.title, ...descendants(original.title, pages).map((p) => p.title)].map((t) => t.toLowerCase())) : new Set<string>();
  const parents = pages.filter((p) => !below.has(p.title.toLowerCase())).sort((a, b) => prettyTitle(a.title).localeCompare(prettyTitle(b.title)));

  const cancel = useCallback(() => {
    if (!busy) onCancel();
  }, [busy, onCancel]);

  useEffect(() => {
    if (!isNew) textRef.current?.focus();
  }, [isNew]);

  async function save() {
    if (busy || !backend) return;
    if (isNew && problem) {
      setError(problem);
      return;
    }
    const target = isNew ? titleize(title) : original!.title;
    setBusy(true);
    setError(null);
    try {
      await backend.saveWikiPage(projectId, target, {
        text,
        ...(comments.trim() ? { comments: comments.trim() } : {}),
        ...(original ? { version: original.version } : {}),
        ...(isNew ? (parent ? { parent_title: parent } : {}) : parent !== startParent ? { parent_title: parent } : {}),
      });
      onSaved(target);
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  }

  return (
    <form
      className="wiki-editor"
      aria-label={isNew ? "New page" : `Edit ${prettyTitle(original!.title)}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (matchesShortcut(e, "mod+enter")) {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape" && !dirty) {
          e.preventDefault();
          cancel();
        }
      }}
    >
      {isNew ? (
        <input
          className="new-issue-subject wiki-title-input"
          aria-label="Title"
          aria-invalid={(title.trim() !== "" && problem !== null) || undefined}
          placeholder="Page title"
          autoFocus
          maxLength={255}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      ) : (
        <h1 className="detail-title">{prettyTitle(original!.title)}</h1>
      )}
      <div className="wiki-editor-tabs" role="tablist" aria-label="Editor">
        <button type="button" role="tab" aria-selected={!preview} className={preview ? "" : "is-active"} onClick={() => setPreview(false)}>
          Write
        </button>
        <button type="button" role="tab" aria-selected={preview} className={preview ? "is-active" : ""} onClick={() => setPreview(true)}>
          Preview
        </button>
        <span className="header-spacer" />
        <span className="muted wiki-editor-hint">Markdown, with [[Page]] for links to other pages</span>
      </div>
      {preview ? (
        <div className="wiki-preview" role="tabpanel" aria-label="Preview">
          {text.trim() ? <Markdown text={text} projectId={projectId} wikiPages={pages} attachments={original?.attachments} /> : <p className="muted">Nothing to preview.</p>}
        </div>
      ) : (
        <textarea
          ref={textRef}
          className="wiki-text"
          aria-label="Text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck
        />
      )}
      <div className="time-dialog-fields wiki-editor-fields">
        <label className="time-field wiki-comment-field">
          <span>Comment</span>
          <input
            aria-label="Comment"
            placeholder="What changed, for the history (optional)"
            maxLength={1024}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </label>
        {(isNew || canMove) && (
          <label className="time-field wiki-parent-field">
            <span>Parent page</span>
            <select aria-label="Parent page" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">None (top level)</option>
              {parents.map((p) => (
                <option key={p.title} value={p.title}>
                  {prettyTitle(p.title)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer className="new-issue-footer wiki-editor-footer">
        {isNew && title.trim() && !problem && titleize(title) !== title.trim() && (
          <span className="muted wiki-editor-hint">Saved as {titleize(title)}</span>
        )}
        <span className="header-spacer" />
        <button type="button" className="button-secondary" onClick={cancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="button-primary" disabled={busy || (isNew && problem !== null) || (!isNew && !dirty)}>
          {busy ? "Saving…" : isNew ? "Create page" : "Save"}
          <kbd className="kbd-on-accent">{shortcutLabel("mod+enter")}</kbd>
        </button>
      </footer>
    </form>
  );
}

/** The page's latest versions, newest first; picking one shows it. */
function History({
  projectId,
  page,
  reading,
  onRead,
}: {
  projectId: number;
  page: WikiPage;
  reading: WikiPage | null;
  onRead: (version: WikiPage | null) => void;
}) {
  const backend = useApp((s) => s.backend);
  const key = `${projectId}:${page.title}:${page.version}`;
  const [loaded, setLoaded] = useState<Loaded<WikiPage[]> | null>(null);

  useEffect(() => {
    if (!backend) return;
    let live = true;
    const wanted: number[] = [];
    for (let v = page.version - 1; v >= 1 && wanted.length < HISTORY_LENGTH - 1; v--) wanted.push(v);
    Promise.all(wanted.map((v) => backend.wikiPage(projectId, page.title, v)))
      .then((older) => live && setLoaded({ key, value: [page, ...older] }))
      .catch((e) => live && setLoaded({ key, error: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [backend, projectId, page, key]);

  const versions = loaded?.key === key ? loaded.value : undefined;
  const shown = reading?.version ?? page.version;
  return (
    <aside className="detail-properties wiki-history" aria-label="History">
      <header className="wiki-tree-header">
        <span>History</span>
        <span className="count">{page.version}</span>
      </header>
      {loaded?.key === key && loaded.error ? (
        <p className="muted wiki-tree-note">{loaded.error}</p>
      ) : !versions ? (
        <p className="muted wiki-tree-note">Loading…</p>
      ) : (
        <ol className="wiki-versions">
          {versions.map((v) => (
            <li key={v.version}>
              <button
                type="button"
                className={v.version === shown ? "wiki-version is-current" : "wiki-version"}
                aria-current={v.version === shown ? "true" : undefined}
                onClick={() => onRead(v.version === page.version ? null : v)}
              >
                <span className="wiki-version-line">
                  <strong>Version {v.version}</strong>
                  {v.version === page.version && <span className="muted">Latest</span>}
                </span>
                <span className="muted">
                  {v.author?.name ?? "Someone"}
                  {v.updated_on && ` · ${relativeTime(v.updated_on)}`}
                </span>
                {v.comments && <span className="wiki-version-comment">{v.comments}</span>}
              </button>
            </li>
          ))}
          {page.version > HISTORY_LENGTH && (
            <li className="muted wiki-tree-note">Older versions are in Redmine.</li>
          )}
        </ol>
      )}
    </aside>
  );
}

/** Asks before deleting a page, and what happens to the pages under it. */
function DeletePageDialog({
  projectId,
  page,
  below,
  onClose,
  onDeleted,
}: {
  projectId: number;
  page: WikiPage;
  below: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const backend = useApp((s) => s.backend);
  const [withChildren, setWithChildren] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  useDialogFocus(ref);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const name = prettyTitle(page.title);

  async function submit() {
    if (busy || !backend) return;
    setBusy(true);
    try {
      await backend.deleteWikiPage(projectId, page.title, withChildren);
      onDeleted();
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={ref}
        className="modal confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-page-title"
        aria-describedby="delete-page-text"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 id="delete-page-title">Delete {name}?</h1>
        <p id="delete-page-text" className="muted">
          It's deleted in Redmine for everyone, with its history and attachments.
          {below > 0 && !withChildren && ` Its ${below === 1 ? "sub-page moves" : `${below} sub-pages move`} up to the top of the wiki.`}
        </p>
        {below > 0 && (
          <label className="team-check">
            <input type="checkbox" checked={withChildren} onChange={(e) => setWithChildren(e.target.checked)} />
            Also delete {below === 1 ? "its sub-page" : `its ${below} sub-pages`}
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="confirm-dialog-footer">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-danger" disabled={busy}>
            {busy ? "Deleting…" : "Delete page"}
          </button>
        </footer>
      </form>
    </div>
  );
}
