// How Redmine's model is shown the Linear way: status categories, priority
// levels, labels and cycles. See docs/architecture.md.

import type { Issue, IssuePriority, IssueStatus, Metadata, Tracker, Version } from "./types";

export type StatusCategory = "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";

export const CATEGORY_ORDER: StatusCategory[] = ["triage", "started", "unstarted", "backlog", "completed", "canceled"];

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Todo",
  started: "In progress",
  completed: "Done",
  canceled: "Canceled",
};

/**
 * The default category for a Redmine status. A status that is any tracker's
 * default (usually "New") is Todo, other open statuses are In progress, and
 * closed ones are Done, unless their names say otherwise.
 */
export function defaultCategory(status: IssueStatus, trackers: Tracker[]): StatusCategory {
  const name = status.name.toLowerCase();
  if (status.is_closed) {
    if (/reject|cancel|won.?t|invalid|duplicate|declin|obsolete/.test(name)) return "canceled";
    return "completed";
  }
  if (/triage/.test(name)) return "triage";
  if (/backlog|icebox|someday/.test(name)) return "backlog";
  if (trackers.some((t) => t.default_status?.id === status.id) || /^(new|open|to ?do)$/.test(name)) {
    return "unstarted";
  }
  return "started";
}

export type CategoryMap = Map<number, StatusCategory>;

export function categoryMap(meta: Metadata, overrides: Record<number, StatusCategory> = {}): CategoryMap {
  const map: CategoryMap = new Map();
  for (const s of meta.statuses) map.set(s.id, overrides[s.id] ?? defaultCategory(s, meta.trackers));
  return map;
}

export function issueCategory(issue: Issue, map: CategoryMap): StatusCategory {
  const known = map.get(issue.status.id);
  if (known) return known;
  return issue.status.is_closed ? "completed" : "started";
}

/** 0 = no priority shown, 1 = low ... 4 = urgent, mapped by position. */
export type PriorityLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Maps Redmine's ordered priorities to Linear's icons by position: the default
 * priority is "no priority", lower ones are Low, higher ones climb to Urgent.
 */
export function priorityLevels(priorities: IssuePriority[]): Map<number, PriorityLevel> {
  const map = new Map<number, PriorityLevel>();
  const defaultIndex = Math.max(
    0,
    priorities.findIndex((p) => p.is_default),
  );
  priorities.forEach((p, i) => {
    const delta = i - defaultIndex;
    let level: PriorityLevel;
    if (delta < 0) level = 1;
    else if (delta === 0) level = 0;
    else if (delta === 1) level = 3;
    else level = 4;
    // A server with a single step above default calls it High; two or more
    // reach Urgent.
    map.set(p.id, level);
  });
  return map;
}

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  0: "No priority",
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Urgent",
};

/** Label values on an issue, from the custom fields shown as labels. */
export function issueLabels(issue: Issue, labelFieldIds: Set<number> | null): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = [];
  for (const f of issue.custom_fields) {
    if (labelFieldIds ? !labelFieldIds.has(f.id) : !f.multiple) continue;
    const values = Array.isArray(f.value) ? f.value : f.value ? [f.value] : [];
    for (const v of values) if (v) out.push({ field: f.name, value: v });
  }
  return out;
}

/** Open versions with a due date, soonest first: the team's cycles. */
export function cyclesFor(projectId: number, versions: Version[]): Version[] {
  return versions
    .filter((v) => v.project.id === projectId)
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
}

/** The cycle in progress: the open version with the nearest due date today or later. */
export function activeCycle(projectId: number, versions: Version[], today = new Date()): Version | null {
  const day = today.toISOString().slice(0, 10);
  return (
    cyclesFor(projectId, versions).find((v) => v.status === "open" && (v.due_date ?? "9999") >= day) ?? null
  );
}

/** Top-level projects are teams; subprojects belong to their top ancestor. */
export function teamOf(projectId: number, meta: Metadata): number {
  const byId = new Map(meta.projects.map((p) => [p.id, p]));
  let current = byId.get(projectId);
  const seen = new Set<number>();
  while (current?.parent && byId.has(current.parent.id) && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parent.id);
  }
  return current?.id ?? projectId;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "")).toUpperCase();
}

/** A stable hue for a name, for avatars and label dots. */
export function hueFor(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

/** "now", "5m", "3h", "Yesterday", "Nov 2", like Linear's list. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, now - t);
  const min = 60_000;
  if (diff < min) return "now";
  if (diff < 60 * min) return `${Math.floor(diff / min)}m`;
  if (diff < 24 * 60 * min) return `${Math.floor(diff / (60 * min))}h`;
  if (diff < 48 * 60 * min) return "Yesterday";
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}
