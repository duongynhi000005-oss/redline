import { useEffect, useMemo, useState } from "react";
import type { ActivityEvent, ActivityKind, ActivityPage, ActivityWindow } from "../lib/activity";
import { ACTIVITY_KINDS, MAX_ISSUES, activitySource, activityWindow, earlierWindow, groupByDay } from "../lib/activity";
import { projectTree, teamOf } from "../lib/model";
import { dayLabel, isoDay } from "../lib/time";
import { errorMessage } from "../lib/types";
import { useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { Avatar } from "./Avatar";
import type { IconName } from "./icons";
import { Icon } from "./icons";
import { OpenInRedmineButton } from "./OpenInRedmine";

/** Days read at a time; "Show earlier" reads the days before. */
export const ACTIVITY_DAYS = 14;

const KIND_ICON: Record<ActivityKind, IconName> = {
  issues: "issues",
  time: "time",
  wiki: "wiki",
  news: "news",
  files: "file",
};

/** A comment or summary as one plain line: Markdown marks and links dropped. */
export function plainExcerpt(text: string, max = 240): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

type Loading = { windows: ActivityWindow[]; pages: (ActivityPage | null)[]; error: string | null };

/** What happened in a team and its sub-teams, newest first, by day. */
export function ActivityView({ projectId }: { projectId: number }) {
  const backend = useApp((s) => s.backend);
  const meta = useApp((s) => s.meta);
  const me = useApp((s) => s.account?.userId);
  const navigate = useApp((s) => s.navigate);
  const openIssue = useApp((s) => s.openIssue);
  const d = useDerived();
  const project = d.projects.get(projectId);
  const today = useMemo(() => new Date(), []);

  const ids = useMemo(() => (meta ? [...projectTree(projectId, meta.projects)] : []), [meta, projectId]);
  const source = useMemo(() => (backend && meta ? activitySource(backend, meta, projectId, ids) : null), [backend, meta, projectId, ids]);
  const [state, setState] = useState<Loading>(() => ({ windows: [activityWindow(today, ACTIVITY_DAYS)], pages: [null], error: null }));
  const [hidden, setHidden] = useState<Set<ActivityKind>>(new Set());
  const [onlyMine, setOnlyMine] = useState(false);

  // Read each window that hasn't been read yet, one after another.
  const next = state.pages.findIndex((p) => p === null);
  const pending = next === -1 ? null : state.windows[next]!;
  useEffect(() => {
    if (!source || !pending || state.error) return;
    let live = true;
    source
      .load(pending, useApp.getState().issues)
      .then((page) => live && setState((s) => ({ ...s, pages: s.pages.map((p, i) => (i === next ? page : p)) })))
      .catch((e) => live && setState((s) => ({ ...s, error: errorMessage(e) })));
    return () => {
      live = false;
    };
  }, [source, pending, next, state.error]);

  const kinds = source?.kinds ?? ["issues"];
  const loaded = state.pages.filter((p): p is ActivityPage => p !== null);
  const events = loaded
    .flatMap((p) => p.events)
    .filter((e) => kinds.includes(e.kind) && !hidden.has(e.kind) && (!onlyMine || e.author?.id === me));
  const days = groupByDay(events);
  const capped = loaded.some((p) => p.capped);
  const loading = pending !== null && !state.error;
  const oldest = state.windows[state.windows.length - 1]!;

  function showEarlier() {
    setState((s) => ({ windows: [...s.windows, earlierWindow(s.windows[s.windows.length - 1]!, ACTIVITY_DAYS)], pages: [...s.pages, null], error: null }));
  }

  function retry() {
    setState((s) => ({ ...s, error: null }));
  }

  function open(e: ActivityEvent) {
    const t = e.target;
    if (t.type === "issue") openIssue(t.id);
    else if (t.type === "wiki") navigate({ view: "wiki", projectId: t.projectId, title: t.title });
    else if (t.type === "news") navigate({ view: "news", projectId: e.projectId, newsId: t.id });
    else if (t.type === "files") navigate({ view: "files", projectId: t.projectId });
    else if (meta) navigate({ view: "time", teamId: teamOf(t.projectId, meta) });
  }

  function toggle(kind: ActivityKind) {
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  if (!project) {
    return (
      <section className="main" aria-label="Activity">
        <header className="main-header" data-tauri-drag-region />
        <div className="empty-state muted">This team is gone from Redmine, or you can no longer see it.</div>
      </section>
    );
  }

  const since = dayLabel(isoDay(new Date(oldest.from)), today);

  return (
    <section className="main detail activity-view" aria-label={`${project.name} activity`}>
      <header className="main-header" data-tauri-drag-region>
        <span className="breadcrumb">
          <button type="button" className="link-button" onClick={() => navigate({ view: "overview", projectId })}>
            {project.name}
          </button>
          <Icon name="chevron-right" size={12} />
          <h1 className="breadcrumb-title">Activity</h1>
        </span>
        {kinds.length > 1 && (
          <div className="activity-kinds" role="group" aria-label="Show">
            {ACTIVITY_KINDS.filter((k) => kinds.includes(k.value)).map((k) => (
              <button
                key={k.value}
                type="button"
                className="activity-kind-toggle"
                aria-pressed={!hidden.has(k.value)}
                onClick={() => toggle(k.value)}
              >
                <Icon name={KIND_ICON[k.value]} size={12} />
                {k.label}
              </button>
            ))}
          </div>
        )}
        <span className="header-spacer" data-tauri-drag-region />
        <button
          type="button"
          className="header-button"
          aria-pressed={onlyMine}
          onClick={() => setOnlyMine(!onlyMine)}
          title="Show only what you did"
        >
          <Icon name="my-issues" />
          <span>Only mine</span>
        </button>
        <OpenInRedmineButton />
      </header>
      <div className="detail-body">
        <div className="detail-content activity-content">
          {days.map((g) => (
            <section key={g.day} className="activity-day" aria-label={dayLabel(g.day, today)}>
              <h2 className="activity-day-title">{dayLabel(g.day, today)}</h2>
              <ul className="activity-list">
                {g.events.map((e) => (
                  <ActivityRow key={e.key} event={e} rootId={projectId} onOpen={() => open(e)} />
                ))}
              </ul>
            </section>
          ))}
          {state.error ? (
            <div className="activity-footer">
              <p className="form-error" role="alert">
                Couldn't load the activity: {state.error}
              </p>
              <button type="button" className="button-secondary" onClick={retry}>
                Try again
              </button>
            </div>
          ) : loading ? (
            <p className="muted activity-footer">Loading…</p>
          ) : (
            <div className="activity-footer">
              {!events.length && (
                <p className="muted">
                  {onlyMine || hidden.size ? "Nothing that matches" : "Nothing happened"} in {project.name} since {since}.
                </p>
              )}
              {capped && <p className="muted">Showing changes to the {MAX_ISSUES} most recently updated issues.</p>}
              <button type="button" className="button-secondary" onClick={showEarlier}>
                Show earlier
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ActivityRow({ event: e, rootId, onOpen }: { event: ActivityEvent; rootId: number; onOpen: () => void }) {
  const d = useDerived();
  const team = e.projectId !== rootId ? d.projects.get(e.projectId)?.name : null;
  const time = e.untimed ? null : new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const who = e.author?.name ?? "Someone";
  return (
    <li className="activity-row">
      <button type="button" className="activity-item" onClick={onOpen} aria-label={`${who} ${e.verb} ${e.subject}`}>
        <span className="activity-avatar" aria-hidden>
          <Avatar name={e.author?.name} size={22} />
          <span className="activity-kind">
            <Icon name={KIND_ICON[e.kind]} size={10} />
          </span>
        </span>
        <span className="activity-main">
          <span className="activity-line">
            <strong>{who}</strong> {e.verb} <span className="activity-subject">{e.subject}</span>
            {team && <span className="muted"> in {team}</span>}
          </span>
          {e.changes.length > 0 && <span className="activity-changes muted">{e.changes.join(" · ")}</span>}
          {e.text && <span className="activity-text">{plainExcerpt(e.text)}</span>}
        </span>
        {time && (
          <time className="activity-time muted" dateTime={e.at}>
            {time}
          </time>
        )}
      </button>
    </li>
  );
}
