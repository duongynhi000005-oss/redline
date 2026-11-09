import { useEffect, useRef, useState } from "react";
import { issueCategory, relativeTime } from "../lib/model";
import type { SearchResult } from "../lib/types";
import { errorMessage } from "../lib/types";
import { useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { Icon, StatusIcon } from "./icons";

const KINDS: Record<string, string> = {
  issue: "Issue",
  "issue-closed": "Issue",
  "issue-note": "Comment",
  "issue-closed-note": "Comment",
  "wiki-page": "Wiki",
  news: "News",
  document: "Document",
  message: "Forum",
  "reply-message": "Forum",
  changeset: "Commit",
  project: "Project",
};

export function searchKind(type: string): string {
  return KINDS[type] ?? type.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * The path of a search result on the signed-in server, for opening it in the
 * browser. Redmine builds result links from its own host setting, which can
 * differ from the address Redline uses, so only the path is kept.
 */
export function redminePath(url: string | null | undefined, serverUrl: string): string | null {
  if (!url) return null;
  try {
    const page = new URL(url, serverUrl);
    const base = new URL(serverUrl).pathname.replace(/\/+$/, "");
    let path = page.pathname;
    if (base && path.startsWith(`${base}/`)) path = path.slice(base.length);
    path = `${path}${page.search}${page.hash}`.replace(/^\/+/, "");
    return path || null;
  } catch {
    return null;
  }
}

/** The wiki page a result's path points at, as a project identifier and a title (null for the start page). */
export function wikiTarget(path: string | null): { project: string; title: string | null } | null {
  const m = path?.match(/^projects\/([^/?#]+)\/wiki(?:\/([^/?#]+))?\/?(?:[?#].*)?$/);
  if (!m) return null;
  try {
    return { project: decodeURIComponent(m[1]!), title: m[2] ? decodeURIComponent(m[2]) : null };
  } catch {
    return null;
  }
}

const isIssue = (r: SearchResult) => r.type.startsWith("issue");

/** Redmine search across issues, wiki pages, news, documents, forums and commits. */
export function SearchView({ text }: { text: string }) {
  const backend = useApp((s) => s.backend);
  const navigate = useApp((s) => s.navigate);
  const openIssue = useApp((s) => s.openIssue);
  const openInRedmine = useApp((s) => s.openInRedmine);
  const serverUrl = useApp((s) => s.account?.serverUrl ?? "");
  const issues = useApp((s) => s.issues);
  const d = useDerived();
  const [draft, setDraft] = useState(text);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(!!text.trim());
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!backend || !text.trim()) return;
    let live = true;
    backend
      .search(text, 0)
      .then((found) => {
        if (!live) return;
        setResults(found.items);
        setTotal(found.total);
      })
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [backend, text]);

  async function more() {
    if (!backend || loading) return;
    setLoading(true);
    try {
      const found = await backend.search(text, results.length);
      setResults((r) => [...r, ...found.items]);
      setTotal(found.total);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function open(r: SearchResult) {
    if (isIssue(r)) {
      openIssue(r.id);
      return;
    }
    const path = redminePath(r.url, serverUrl);
    const news = r.type === "news" ? path?.match(/^news\/(\d+)\/?(?:[?#].*)?$/) : null;
    if (news && d.news.size > 0) {
      navigate({ view: "news", projectId: null, newsId: Number(news[1]) });
      return;
    }
    const wiki = wikiTarget(path);
    const project = wiki ? [...d.projects.values()].find((p) => p.identifier === wiki.project) : undefined;
    if (wiki && project && d.wikis.has(project.id)) navigate({ view: "wiki", projectId: project.id, title: wiki.title });
    else if (path) openInRedmine(path);
  }

  const searched = text.trim();
  return (
    <section className="main" aria-label="Search">
      <header className="main-header" data-tauri-drag-region>
        <h1>Search</h1>
        {searched && !loading && <span className="count">{total}</span>}
      </header>
      <form
        className="search-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && draft.trim() !== searched) navigate({ view: "search", text: draft.trim() });
        }}
      >
        <Icon name="search" />
        <input
          aria-label="Search Redmine"
          placeholder="Search issues, wiki pages, news, documents, forums and commits…"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
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
      ) : !searched ? (
        <div className="empty-state">
          <p className="muted">Type what you're looking for and press Enter.</p>
        </div>
      ) : loading && !results.length ? (
        <div className="empty-state" aria-busy="true">
          <p className="muted">Searching Redmine…</p>
        </div>
      ) : !results.length ? (
        <div className="empty-state">
          <p>Nothing in Redmine matches “{searched}”.</p>
          <p className="muted">Redmine looks for every word, in titles and text you can see.</p>
        </div>
      ) : (
        <div className="search-scroll">
          <ul
            ref={listRef}
            className="search-results"
            aria-label={`Results for ${searched}`}
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
              const buttons = [...(listRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
              const at = buttons.indexOf(document.activeElement as HTMLElement);
              e.preventDefault();
              buttons[Math.max(0, Math.min(buttons.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
            }}
          >
            {results.map((r) => {
              const issue = isIssue(r) ? issues.get(r.id) : undefined;
              const opensOutside = !isIssue(r);
              return (
                <li key={`${r.type}:${r.id}:${r.url ?? ""}`}>
                  <button type="button" className="search-result" onClick={() => open(r)}>
                    <span className="search-kind">{searchKind(r.type)}</span>
                    {issue ? (
                      <>
                        <StatusIcon category={issueCategory(issue, d.categories)} title={issue.status.name} />
                        <span className="issue-id">#{issue.id}</span>
                        <span className="search-title">{issue.subject}</span>
                      </>
                    ) : (
                      <span className="search-title">{r.title}</span>
                    )}
                    {r.description && <span className="search-description">{r.description}</span>}
                    {opensOutside && (
                      <span className="search-external" title="Opens in your browser">
                        <Icon name="external" size={12} />
                      </span>
                    )}
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
