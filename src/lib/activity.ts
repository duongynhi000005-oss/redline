import type { Backend } from "./backend";
import { describeDetail } from "./journal";
import { filesAccess, newsAccess, timeAccess, wikiAccess } from "./permissions";
import { formatHours, isoDay } from "./time";
import type { Issue, Journal, Metadata, Named, News, ProjectFile, TimeEntry, WikiPage } from "./types";
import { prettyTitle } from "./wiki";

// A team's activity, the way Redmine's Activity page shows it. Redmine has no
// API for that page, so Redline builds it from what it can read: cached
// issues and their journals, logged time, wiki pages, news and files.

export type ActivityKind = "issues" | "time" | "wiki" | "news" | "files";

export const ACTIVITY_KINDS: { value: ActivityKind; label: string }[] = [
  { value: "issues", label: "Issues" },
  { value: "time", label: "Time" },
  { value: "wiki", label: "Wiki" },
  { value: "news", label: "News" },
  { value: "files", label: "Files" },
];

/** Where an event leads. */
export type ActivityTarget =
  | { type: "issue"; id: number }
  | { type: "wiki"; projectId: number; title: string }
  | { type: "news"; id: number }
  | { type: "files"; projectId: number }
  | { type: "time"; projectId: number };

export interface ActivityEvent {
  key: string;
  kind: ActivityKind;
  /** When it happened, as Redmine stamps it. */
  at: string;
  /** The local day it belongs to, YYYY-MM-DD. Logged time goes by the day it was spent. */
  day: string;
  author: Named | null;
  projectId: number;
  /** What the author did, read after their name: "commented on". */
  verb: string;
  /** What they did it to: "#12 Drag cards", a page, a post, a file. */
  subject: string;
  /** A comment, summary or description, as written. */
  text: string | null;
  /** Field changes, in words. */
  changes: string[];
  target: ActivityTarget;
  /** True when only the day is known, as for time logged on another day. */
  untimed?: boolean;
}

/** A span of local days to show: from the start of `from` up to the start of `until`. */
export interface ActivityWindow {
  from: string;
  until: string;
}

/** The `days` local days ending with `last`, as ISO instants. */
export function activityWindow(last: Date, days: number): ActivityWindow {
  const start = new Date(last.getFullYear(), last.getMonth(), last.getDate() - days + 1);
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  return { from: start.toISOString(), until: end.toISOString() };
}

/** The window of `days` days just before another. */
export function earlierWindow(window: ActivityWindow, days: number): ActivityWindow {
  const until = new Date(window.from);
  const last = new Date(until.getFullYear(), until.getMonth(), until.getDate() - 1);
  return { ...activityWindow(last, days), until: window.from };
}

function within(at: string | null | undefined, w: ActivityWindow): at is string {
  if (!at) return false;
  const t = Date.parse(at);
  return t >= Date.parse(w.from) && t < Date.parse(w.until);
}

const dayOf = (at: string) => isoDay(new Date(at));

const issueName = (issue: Issue) => `#${issue.id} ${issue.subject}`;

/** Issues created, changed and commented on in the window. */
export function issueEvents(issues: Issue[], journals: Map<number, Journal[]>, meta: Metadata, w: ActivityWindow): ActivityEvent[] {
  const closed = new Set(meta.statuses.filter((s) => s.is_closed).map((s) => s.id));
  const out: ActivityEvent[] = [];
  for (const issue of issues) {
    const base = { kind: "issues" as const, projectId: issue.project.id, subject: issueName(issue), target: { type: "issue" as const, id: issue.id } };
    if (within(issue.created_on, w)) {
      out.push({ ...base, key: `issue:${issue.id}`, at: issue.created_on, day: dayOf(issue.created_on), author: issue.author ?? null, verb: "created", text: null, changes: [] });
    }
    for (const j of journals.get(issue.id) ?? []) {
      if (!within(j.created_on, w)) continue;
      const notes = j.notes?.trim() || null;
      // A change to the same value says nothing.
      const details = j.details.filter((d) => d.old_value !== d.new_value);
      if (!notes && !details.length) continue;
      const status = details.find((d) => d.property === "attr" && d.name === "status_id");
      const closes = status && closed.has(Number(status.new_value)) && !closed.has(Number(status.old_value));
      const reopens = status && closed.has(Number(status.old_value)) && !closed.has(Number(status.new_value));
      const verb = closes ? "closed" : reopens ? "reopened" : notes ? "commented on" : "updated";
      out.push({
        ...base,
        key: `journal:${j.id}`,
        at: j.created_on,
        day: dayOf(j.created_on),
        author: j.user ?? null,
        verb,
        text: notes,
        changes: details.map((d) => describeDetail(d, meta)),
      });
    }
  }
  return out;
}

/** Time logged on days in the window. */
export function timeEvents(entries: TimeEntry[], issues: Map<number, Issue>, w: ActivityWindow): ActivityEvent[] {
  const firstDay = dayOf(w.from);
  const lastDay = dayOf(new Date(Date.parse(w.until) - 1).toISOString());
  return entries
    .filter((e) => e.spent_on >= firstDay && e.spent_on <= lastDay)
    .map((e) => {
      const issue = e.issue ? issues.get(e.issue.id) : undefined;
      const on = e.issue ? (issue ? issueName(issue) : `#${e.issue.id}`) : e.project.name;
      // Within a day, entries sit where they were logged when that was the same day.
      const timed = !!e.created_on && dayOf(e.created_on) === e.spent_on;
      const at = timed ? e.created_on! : new Date(`${e.spent_on}T12:00:00`).toISOString();
      return {
        untimed: !timed,
        key: `time:${e.id}`,
        kind: "time" as const,
        at,
        day: e.spent_on,
        author: e.user,
        projectId: e.project.id,
        verb: `logged ${formatHours(e.hours)} on`,
        subject: on,
        text: e.comments?.trim() || null,
        changes: [],
        target: e.issue ? { type: "issue" as const, id: e.issue.id } : { type: "time" as const, projectId: e.project.id },
      };
    });
}

/** Wiki pages last edited in the window. Redmine's API gives only a page's latest version. */
export function wikiEvents(projectId: number, pages: WikiPage[], w: ActivityWindow): ActivityEvent[] {
  return pages
    .filter((p) => within(p.updated_on, w))
    .map((p) => ({
      key: `wiki:${projectId}:${p.title}:${p.version}`,
      kind: "wiki" as const,
      at: p.updated_on!,
      day: dayOf(p.updated_on!),
      author: p.author ?? null,
      projectId,
      verb: p.version <= 1 ? "created the page" : "edited the page",
      subject: prettyTitle(p.title),
      text: p.comments?.trim() || null,
      changes: [],
      target: { type: "wiki" as const, projectId, title: p.title },
    }));
}

export function newsEvents(news: News[], w: ActivityWindow): ActivityEvent[] {
  return news
    .filter((n) => within(n.created_on, w))
    .map((n) => ({
      key: `news:${n.id}`,
      kind: "news" as const,
      at: n.created_on!,
      day: dayOf(n.created_on!),
      author: n.author ?? null,
      projectId: n.project.id,
      verb: "posted",
      subject: n.title,
      text: n.summary?.trim() || null,
      changes: [],
      target: { type: "news" as const, id: n.id },
    }));
}

export function fileEvents(projectId: number, files: ProjectFile[], w: ActivityWindow): ActivityEvent[] {
  return files
    .filter((f) => within(f.created_on, w))
    .map((f) => ({
      key: `file:${f.id}`,
      kind: "files" as const,
      at: f.created_on!,
      day: dayOf(f.created_on!),
      author: f.author ?? null,
      projectId,
      verb: f.version ? `added a file to ${f.version.name}:` : "added a file:",
      subject: f.filename,
      text: f.description?.trim() || null,
      changes: [],
      target: { type: "files" as const, projectId },
    }));
}

/** Events by day, newest day and newest event first. */
export function groupByDay(events: ActivityEvent[]): { day: string; events: ActivityEvent[] }[] {
  const days = new Map<string, ActivityEvent[]>();
  for (const e of events) days.set(e.day, [...(days.get(e.day) ?? []), e]);
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, list]) => ({ day, events: [...list].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key)) }));
}

/** At most this many changed issues have their journals read for one window. */
export const MAX_ISSUES = 200;

export interface ActivityPage {
  events: ActivityEvent[];
  /** More issues changed in the window than Redline read journals for. */
  capped: boolean;
}

/**
 * Reads what a team did, one window at a time. Lists that come whole
 * (wiki pages, news, files) are read once per source and reused for earlier
 * windows; a wiki page's author is read once per version.
 */
export function activitySource(backend: Backend, meta: Metadata, rootId: number, projectIds: number[]) {
  const once = new Map<string, Promise<unknown>>();
  const memo = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    let p = once.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load();
      once.set(key, p);
      // A failed read is tried again with the next window.
      p.catch(() => once.delete(key));
    }
    return p;
  };
  const wikis = projectIds.filter((id) => wikiAccess(meta, id).view);
  const news = projectIds.filter((id) => newsAccess(meta, id).view);
  const files = projectIds.filter((id) => filesAccess(meta, id).view);
  const time = projectIds.some((id) => timeAccess(meta, id).view);
  const inTeam = new Set(projectIds);

  return {
    kinds: ACTIVITY_KINDS.filter(
      (k) =>
        k.value === "issues" ||
        (k.value === "time" && time) ||
        (k.value === "wiki" && wikis.length > 0) ||
        (k.value === "news" && news.length > 0) ||
        (k.value === "files" && files.length > 0),
    ).map((k) => k.value),

    async load(w: ActivityWindow, cached: Map<number, Issue>): Promise<ActivityPage> {
      const changed = [...cached.values()]
        .filter((i) => inTeam.has(i.project.id) && Date.parse(i.updated_on) >= Date.parse(w.from))
        .sort((a, b) => b.updated_on.localeCompare(a.updated_on));
      const read = changed.slice(0, MAX_ISSUES);
      const created = changed.filter((i) => within(i.created_on, w));

      const [journals, entries, pages, posts, uploads] = await Promise.all([
        read.length ? backend.issueJournals(read.map((i) => i.id)) : Promise.resolve([]),
        time
          ? backend.timeEntries({ project_id: rootId, from: dayOf(w.from), to: dayOf(new Date(Date.parse(w.until) - 1).toISOString()) })
          : Promise.resolve([] as TimeEntry[]),
        Promise.all(
          wikis.map(async (id) => {
            const index = await memo(`wiki:${id}`, () => backend.wikiIndex(id));
            const edited = await Promise.all(
              index
                .filter((p) => within(p.updated_on, w))
                .map((p) => memo(`page:${id}:${p.title}:${p.version}`, () => backend.wikiPage(id, p.title, null))),
            );
            return wikiEvents(id, edited, w);
          }),
        ),
        Promise.all(news.map((id) => memo(`news:${id}`, () => backend.news(id, 0).then((f) => f.items)))),
        Promise.all(files.map(async (id) => fileEvents(id, await memo(`files:${id}`, () => backend.projectFiles(id)), w))),
      ]);

      const byIssue = new Map(journals.map((j) => [j.issue_id, j.journals]));
      const withEvents = [...new Map([...read, ...created].map((i) => [i.id, i])).values()];
      const events = [
        ...issueEvents(withEvents, byIssue, meta, w),
        ...timeEvents(entries.filter((e) => inTeam.has(e.project.id)), cached, w),
        ...pages.flat(),
        ...newsEvents(posts.flat(), w),
        ...uploads.flat(),
      ];
      return { events, capped: changed.length > read.length };
    },
  };
}
