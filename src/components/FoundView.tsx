import { useEffect, useRef, useState } from "react";
import { relativeTime } from "../lib/model";
import type { SearchKind, SearchResult } from "../lib/types";
import { errorMessage } from "../lib/types";
import { useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { plainExcerpt } from "./ActivityView";
import { Icon } from "./icons";
import { OpenInRedmineButton } from "./OpenInRedmine";
import { redminePath } from "./SearchView";

export type FoundKind = "documents" | "forums";

const KINDS: Record<FoundKind, { label: string; search: SearchKind; noun: string; icon: "file" | "forum" }> = {
  documents: { label: "Documents", search: "documents", noun: "documents", icon: "file" },
  forums: { label: "Forums", search: "messages", noun: "forum posts", icon: "forum" },
};

/** How long typing pauses before Redline asks Redmine. */
export const FIND_DELAY = 300;

/**
 * A hit's title without what Redmine puts in front: "Document: Spec" is
 * "Spec"; a forum post's "General: RE: Sync" is "Sync" in the General forum.
 */
export function foundTitle(r: SearchResult): { title: string; forum: string | null; reply: boolean } {
  const at = r.title.indexOf(": ");
  if (at < 0) return { title: r.title, forum: null, reply: r.type !== "message" && r.type !== "document" };
  const rest = r.title.slice(at + 2);
  if (r.type === "document") return { title: rest, forum: null, reply: false };
  const reply = r.type !== "message";
  return { title: reply ? rest.replace(/^RE:\s*/i, "") : rest, forum: r.title.slice(0, at), reply };
}

/**
 * A team's documents or forums. Redmine's API can't list either, so Redline
 * finds them with Redmine search, within the team, and opens each in the browser.
 */
export function FoundView({ projectId, kind }: { projectId: number; kind: FoundKind }) {
  const backend = useApp((s) => s.backend);
  const navigate = useApp((s) => s.navigate);
  const openInRedmine = useApp((s) => s.openInRedmine);
  const serverUrl = useApp((s) => s.account?.serverUrl ?? "");
  const d = useDerived();
  const project = d.projects.get(projectId);
  const k = KINDS[kind];
  const [draft, setDraft] = useState("");
  const [text, setText] = useState("");
  // What Redmine found, for the text it was asked about.
  const [found, setFound] = useState<{ text: string; items: SearchResult[]; total: number; error: string | null } | null>(null);
  const [paging, setPaging] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const boxRef = useRef<HTMLInputElement>(null);

  // The command menu can take focus back as it closes, after autoFocus ran.
  useEffect(() => boxRef.current?.focus(), []);

  // Ask once typing pauses; Redmine ignores words shorter than two letters.
  useEffect(() => {
    const t = setTimeout(() => setText(draft.trim().length > 1 ? draft.trim() : ""), FIND_DELAY);
    return () => clearTimeout(t);
  }, [draft]);

  useEffect(() => {
    if (!backend || !text) return;
    let live = true;
    backend
      .search(text, 0, { projectId, kinds: [k.search] })
      .then((page) => live && setFound({ text, items: page.items, total: page.total, error: null }))
      .catch((e) => live && setFound({ text, items: [], total: 0, error: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [backend, text, projectId, k.search]);

  const current = text && found?.text === text ? found : null;
  const results = current?.items ?? [];
  const total = current?.total ?? 0;
  const error = current?.error ?? null;
  const loading = (!!text && !current) || paging;

  async function more() {
    if (!backend || loading || !current) return;
    setPaging(true);
    try {
      const page = await backend.search(text, results.length, { projectId, kinds: [k.search] });
      setFound((f) => (f?.text === text ? { ...f, items: [...f.items, ...page.items], total: page.total } : f));
    } catch (e) {
      setFound((f) => (f?.text === text ? { ...f, error: errorMessage(e) } : f));
    } finally {
      setPaging(false);
    }
  }

  if (!project) {
    return (
      <section className="main" aria-label={k.label}>
        <header className="main-header" data-tauri-drag-region />
        <div className="empty-state muted">This team is gone from Redmine, or you can no longer see it.</div>
      </section>
    );
  }

  const browse = `projects/${project.identifier}/${kind === "forums" ? "boards" : "documents"}`;
  return (
    <section className="main found-view" aria-label={`${project.name} ${kind}`}>
      <header className="main-header" data-tauri-drag-region>
        <span className="breadcrumb">
          <button type="button" className="link-button" onClick={() => navigate({ view: "overview", projectId })}>
            {project.name}
          </button>
          <Icon name="chevron-right" size={12} />
          <h1 className="breadcrumb-title">{k.label}</h1>
          {text && !loading && !error && <span className="count">{total}</span>}
        </span>
        <span className="header-spacer" data-tauri-drag-region />
        <OpenInRedmineButton />
      </header>
      <form className="search-form" role="search" onSubmit={(e) => e.preventDefault()}>
        <Icon name="search" />
        <input
          aria-label={`Find ${k.noun} in ${project.name}`}
          placeholder={`Find ${k.noun} in ${project.name}…`}
          ref={boxRef}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setText(draft.trim().length > 1 ? draft.trim() : "");
            if (e.key === "ArrowDown") {
              e.preventDefault();
              listRef.current?.querySelector<HTMLElement>("button")?.focus();
            }
          }}
        />
      </form>
      {error && !results.length ? (
        <div className="empty-state" role="alert">
          <p>Couldn't search Redmine.</p>
          <p className="muted">{error}</p>
        </div>
      ) : !text ? (
        <div className="empty-state found-empty">
          <Icon name={k.icon} size={24} />
          <p>Find {project.name}'s {k.noun} by what they say.</p>
          <p className="muted">Redmine doesn't let apps list {k.noun}, so Redline searches for them. To browse them all, open them in Redmine.</p>
          <button type="button" className="button-secondary" onClick={() => openInRedmine(browse)}>
            <Icon name="external" size={12} />
            Browse in Redmine
          </button>
        </div>
      ) : loading && !results.length ? (
        <div className="empty-state" aria-busy="true">
          <p className="muted">Searching Redmine…</p>
        </div>
      ) : !results.length ? (
        <div className="empty-state">
          <p>
            No {k.noun} in {project.name} match “{text}”.
          </p>
          <p className="muted">Redmine looks for every word, in titles and text you can see.</p>
        </div>
      ) : (
        <div className="search-scroll">
          <ul
            ref={listRef}
            className="search-results"
            aria-label={`${k.label} matching ${text}`}
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
              const buttons = [...(listRef.current?.querySelectorAll<HTMLElement>("li > button") ?? [])];
              const at = buttons.indexOf(document.activeElement as HTMLElement);
              e.preventDefault();
              buttons[Math.max(0, Math.min(buttons.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
            }}
          >
            {results.map((r) => {
              const t = foundTitle(r);
              const path = redminePath(r.url, serverUrl);
              return (
                <li key={`${r.type}:${r.id}:${r.url ?? ""}`}>
                  <button
                    type="button"
                    className="search-result"
                    disabled={!path}
                    onClick={() => path && openInRedmine(path)}
                    aria-label={`${t.reply ? "Reply in " : ""}${t.title}${t.forum ? `, in ${t.forum}` : ""}`}
                  >
                    {t.forum && <span className="search-kind">{t.forum}</span>}
                    <span className="search-title">
                      {t.reply && <span className="muted">Reply: </span>}
                      {t.title}
                    </span>
                    {r.description && <span className="search-description">{plainExcerpt(r.description)}</span>}
                    <span className="search-external" title="Opens in your browser">
                      <Icon name="external" size={12} />
                    </span>
                    {r.datetime && <span className="issue-date">{relativeTime(r.datetime)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {results.length < total && (
            <button type="button" className="button-secondary search-more" disabled={loading} onClick={() => void more()}>
              {loading ? "Loading…" : `Show more (${total - results.length} left)`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
