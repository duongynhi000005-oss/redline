import { useEffect, useReducer, useState } from "react";
import { allowed, newsAccess } from "../lib/permissions";
import { isTyping, matchesShortcut, shortcutLabel } from "../lib/platform";
import type { News, NewsChanges } from "../lib/types";
import { errorMessage } from "../lib/types";
import { overlayOpen, useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { AttachmentGrid } from "./Attachments";
import { ConfirmDialog } from "./ConfirmDialog";
import { Avatar } from "./Avatar";
import { Icon } from "./icons";
import { OpenInRedmineButton } from "./OpenInRedmine";
import { Markdown } from "./Markdown";
import { MenuButton, type MenuItem } from "./Menu";
import { PersonButton } from "./PersonCard";
import { whenSaid } from "./WikiView";

type Loaded<T> = { key: string; value?: T; error?: string };

/** What the editor is working on: a new post, or a change to one. */
type Draft = { kind: "new" } | { kind: "edit"; post: News };

/** News: one team's, or every team's ("Updates"), and one post with its comments. */
export function NewsView({ projectId, newsId }: { projectId: number | null; newsId: number | null }) {
  const backend = useApp((s) => s.backend);
  const meta = useApp((s) => s.meta);
  const navigate = useApp((s) => s.navigate);
  const showToast = useApp((s) => s.showToast);
  const overlay = useApp(overlayOpen);
  const d = useDerived();
  const project = projectId === null ? undefined : d.projects.get(projectId);

  const [reload, bump] = useReducer((n: number) => n + 1, 0);
  const listKey = `${projectId ?? "all"}:${reload}`;
  const postKey = `${newsId ?? ""}:${reload}`;
  const [list, setList] = useState<Loaded<{ items: News[]; total: number }> | null>(null);
  const [post, setPost] = useState<Loaded<News> | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [more, setMore] = useState(false);

  // Leaving a post or a team drops what was being written.
  const [shown, setShown] = useState({ projectId, newsId });
  if (shown.projectId !== projectId || shown.newsId !== newsId) {
    setShown({ projectId, newsId });
    setDraft(null);
  }

  useEffect(() => {
    if (!backend || newsId !== null) return;
    let live = true;
    backend
      .news(projectId, 0)
      .then((value) => live && setList({ key: listKey, value }))
      .catch((e) => live && setList({ key: listKey, error: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [backend, projectId, newsId, listKey]);

  useEffect(() => {
    if (!backend || newsId === null) return;
    let live = true;
    backend
      .newsItem(newsId)
      .then((value) => live && setPost({ key: postKey, value }))
      .catch((e) => live && setPost({ key: postKey, error: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [backend, newsId, postKey]);

  const current = newsId !== null && post?.key === postKey ? post : null;
  const reading = current?.value;
  const posts = list?.key === listKey ? list.value : undefined;
  // Teams the user can post in: this one, or any for Updates.
  const postable = meta
    ? meta.projects.filter((p) => (projectId === null || p.id === projectId) && newsAccess(meta, p.id).manage)
    : [];
  const canManage = reading ? newsAccess(meta, reading.project.id).manage : false;

  useEffect(() => {
    if (!reading || !canManage || draft || deleting || overlay) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setDraft({ kind: "edit", post: reading! });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reading, canManage, draft, deleting, overlay]);

  if (projectId !== null && !project) {
    return (
      <section className="main" aria-label="News">
        <header className="main-header" data-tauri-drag-region />
        <div className="empty-state muted">This team is gone from Redmine, or you can no longer see it.</div>
      </section>
    );
  }

  const listRoute = { view: "news" as const, projectId, newsId: null };
  const label = project ? `${project.name} news` : "Updates";
  const items: MenuItem[] = [];
  if (reading && canManage) items.push({ label: "Delete post…", icon: "trash", danger: true, run: () => setDeleting(true) });

  async function loadMore() {
    if (!backend || !posts) return;
    setMore(true);
    try {
      const next = await backend.news(projectId, posts.items.length);
      setList({ key: listKey, value: { items: [...posts.items, ...next.items], total: next.total } });
    } catch (e) {
      showToast(`Couldn't load more news: ${errorMessage(e)}`);
    } finally {
      setMore(false);
    }
  }

  return (
    <section className="main detail news-view" aria-label={label}>
      <header className="main-header" data-tauri-drag-region>
        <span className="breadcrumb">
          {project && (
            <>
              <button type="button" className="link-button" onClick={() => navigate({ view: "overview", projectId: project.id })}>
                {project.name}
              </button>
              <Icon name="chevron-right" size={12} />
            </>
          )}
          {newsId !== null || draft ? (
            <button type="button" className="link-button" onClick={() => navigate(listRoute)}>
              {project ? "News" : "Updates"}
            </button>
          ) : (
            <h1 className="breadcrumb-title">{project ? "News" : "Updates"}</h1>
          )}
          {reading && (
            <span className="breadcrumb-part">
              <Icon name="chevron-right" size={12} />
              <span className="breadcrumb-current">{reading.title}</span>
            </span>
          )}
          {posts && newsId === null && !draft && <span className="count">{posts.total}</span>}
        </span>
        <span className="header-spacer" data-tauri-drag-region />
        {newsId === null && !draft && postable.length > 0 && (
          <button type="button" className="button-secondary small" onClick={() => setDraft({ kind: "new" })}>
            <Icon name="plus" size={12} />
            New post
          </button>
        )}
        {reading && canManage && !draft && (
          <button
            type="button"
            className="button-secondary small"
            onClick={() => setDraft({ kind: "edit", post: reading })}
            title={`Edit post (${shortcutLabel("e")})`}
          >
            <Icon name="edit" size={12} />
            Edit
          </button>
        )}
        <OpenInRedmineButton />
        <MenuButton label="Post actions" menuLabel="Post actions" items={items} />
      </header>
      <div className="detail-body">
        <div className="detail-content news-content">
          {draft ? (
            <NewsEditor
              key={draft.kind === "edit" ? `edit:${draft.post.id}` : "new"}
              draft={draft}
              teams={postable.map((p) => ({ id: p.id, name: p.name }))}
              onCancel={() => setDraft(null)}
              onSaved={() => {
                showToast(draft.kind === "new" ? "Posted" : "Saved");
                setDraft(null);
                bump();
              }}
            />
          ) : newsId !== null ? (
            !current ? (
              <p className="muted">Loading…</p>
            ) : current.error || !reading ? (
              <p className="muted">{current.error}</p>
            ) : (
              <NewsPost post={reading} showTeam={projectId === null} />
            )
          ) : list?.key === listKey && list.error ? (
            <p className="muted">{list.error}</p>
          ) : !posts ? (
            <p className="muted">Loading…</p>
          ) : posts.items.length === 0 ? (
            <div className="empty-state news-empty">
              <Icon name="news" size={24} />
              <p>{project ? `${project.name} hasn't posted any news yet.` : "No news in your teams yet."}</p>
            </div>
          ) : (
            <>
              <ul className="news-list" aria-label={label}>
                {posts.items.map((n) => (
                  <li key={n.id}>
                    <button type="button" className="news-item" onClick={() => navigate({ view: "news", projectId, newsId: n.id })}>
                      <span className="news-item-title">{n.title}</span>
                      {n.summary && <span className="news-item-summary">{n.summary}</span>}
                      <span className="news-item-meta muted">
                        <Avatar name={n.author?.name} size={16} />
                        {n.author?.name ?? "Someone"}
                        {projectId === null && ` in ${n.project.name}`}
                        {n.created_on && `, ${whenSaid(n.created_on)}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {posts.items.length < posts.total && (
                <button type="button" className="button-secondary news-more" onClick={() => void loadMore()} disabled={more}>
                  {more ? "Loading…" : "Show more"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {deleting && reading && backend && (
        <ConfirmDialog
          title={`Delete “${reading.title}”?`}
          text="It's deleted in Redmine for everyone, with its comments. This can't be undone."
          action="Delete post"
          busyLabel="Deleting…"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await backend.deleteNews(reading.id);
            setDeleting(false);
            showToast(`Deleted “${reading.title}”`);
            bump();
            navigate(listRoute);
          }}
        />
      )}
    </section>
  );
}

/** One post: its text, attachments and comments. */
function NewsPost({ post, showTeam }: { post: News; showTeam: boolean }) {
  const meta = useApp((s) => s.meta);
  const openInRedmine = useApp((s) => s.openInRedmine);
  const comments = post.comments ?? [];
  const canComment = allowed(meta, post.project.id, "comment_news") !== false && newsAccess(meta, post.project.id).view;
  return (
    <article className="news-post" aria-label={post.title}>
      <h1 className="detail-title">{post.title}</h1>
      <p className="muted wiki-byline">
        {post.author?.name ?? "Someone"} posted this
        {showTeam && ` in ${post.project.name}`}
        {post.created_on ? `${showTeam ? "," : ""} ${whenSaid(post.created_on)}` : ""}
      </p>
      {post.summary && <p className="news-summary">{post.summary}</p>}
      {post.description?.trim() && <Markdown text={post.description} projectId={post.project.id} attachments={post.attachments} />}
      <AttachmentGrid attachments={post.attachments} />
      <section className="connections news-comments" aria-label="Comments">
        <header className="connections-header">
          <h2>Comments</h2>
          {comments.length > 0 && <span className="count">{comments.length}</span>}
        </header>
        {comments.length === 0 ? (
          <p className="muted news-comments-note">No comments yet.</p>
        ) : (
          <ul className="news-comment-list">
            {comments.map((c) => (
              <li key={c.id} className="news-comment">
                <Avatar name={c.author?.name} size={22} />
                <div className="news-comment-body">
                  {c.author ? (
                    <PersonButton userId={c.author.id} name={c.author.name} className="news-comment-author">
                      {c.author.name}
                    </PersonButton>
                  ) : (
                    <span className="news-comment-author">Someone</span>
                  )}
                  <Markdown text={c.content} projectId={post.project.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {canComment && (
          <p className="muted news-comments-note">
            Redmine doesn't let apps add comments to news.{" "}
            <button type="button" className="link-button" onClick={() => openInRedmine(`news/${post.id}`)}>
              Comment in Redmine
            </button>
          </p>
        )}
      </section>
    </article>
  );
}

/** Writes a new post, or changes one. Redmine needs a title and text; the summary shows in lists. */
function NewsEditor({
  draft,
  teams,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  teams: { id: number; name: string }[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const backend = useApp((s) => s.backend);
  const original = draft.kind === "edit" ? draft.post : null;
  const [team, setTeam] = useState<number | null>(original?.project.id ?? teams[0]?.id ?? null);
  const [title, setTitle] = useState(original?.title ?? "");
  const [summary, setSummary] = useState(original?.summary ?? "");
  const [text, setText] = useState(original?.description ?? "");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = original
    ? title !== original.title || summary !== (original.summary ?? "") || text !== (original.description ?? "")
    : title.trim() !== "" || summary.trim() !== "" || text.trim() !== "";
  const ready = title.trim() !== "" && text.trim() !== "" && (original ? dirty : team !== null);

  async function save() {
    if (!backend || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (original) {
        const changes: NewsChanges = {};
        if (title.trim() !== original.title) changes.title = title.trim();
        if (summary.trim() !== (original.summary ?? "")) changes.summary = summary.trim();
        if (text !== (original.description ?? "")) changes.description = text;
        await backend.updateNews(original.id, changes);
        onSaved();
      } else {
        await backend.createNews(team!, { title: title.trim(), summary: summary.trim() || undefined, description: text });
        onSaved();
      }
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  }

  return (
    <form
      className="wiki-editor news-editor"
      aria-label={original ? `Edit ${original.title}` : "New post"}
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
          onCancel();
        }
      }}
    >
      <input
        className="new-issue-subject wiki-title-input"
        aria-label="Title"
        placeholder="Title"
        autoFocus
        maxLength={60}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="time-dialog-fields wiki-editor-fields">
        <label className="time-field wiki-comment-field">
          <span>Summary</span>
          <input
            aria-label="Summary"
            placeholder="One line for the list of posts (optional)"
            maxLength={255}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        {!original && teams.length > 1 && (
          <label className="time-field wiki-parent-field">
            <span>Team</span>
            <select aria-label="Team" value={team ?? ""} onChange={(e) => setTeam(Number(e.target.value))}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="wiki-editor-tabs" role="tablist" aria-label="Editor">
        <button type="button" role="tab" aria-selected={!preview} className={preview ? "" : "is-active"} onClick={() => setPreview(false)}>
          Write
        </button>
        <button type="button" role="tab" aria-selected={preview} className={preview ? "is-active" : ""} onClick={() => setPreview(true)}>
          Preview
        </button>
        <span className="header-spacer" />
        <span className="muted wiki-editor-hint">Markdown</span>
      </div>
      {preview ? (
        <div className="wiki-preview" role="tabpanel" aria-label="Preview">
          {text.trim() ? <Markdown text={text} projectId={team ?? undefined} attachments={original?.attachments} /> : <p className="muted">Nothing to preview.</p>}
        </div>
      ) : (
        <textarea
          className="wiki-text news-text"
          aria-label="Text"
          placeholder="What's new"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck
        />
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer className="new-issue-footer wiki-editor-footer">
        {!original && teams.length === 1 && <span className="muted wiki-editor-hint">Posts in {teams[0]!.name}</span>}
        <span className="header-spacer" />
        <button type="button" className="button-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="button-primary" disabled={busy || !ready}>
          {busy ? "Saving…" : original ? "Save" : "Post"}
          <kbd className="kbd-on-accent">{shortcutLabel("mod+enter")}</kbd>
        </button>
      </footer>
    </form>
  );
}
