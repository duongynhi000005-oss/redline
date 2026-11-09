import type { Filter } from "./filters";
import type { CategoryMap, PriorityLevel, StatusCategory } from "./model";
import { CATEGORY_LABEL, CATEGORY_ORDER, issueCategory } from "./model";
import type { Issue, Metadata } from "./types";

// How a list is shown, Linear's "Display" options: filters, grouping and
// ordering. Each list keeps its own, saved per server and user.

export type Grouping = "status" | "assignee" | "priority" | "cycle" | "none";
export type Ordering = "priority" | "updated" | "created";

export interface ViewOptions {
  filters: Filter[];
  grouping: Grouping;
  ordering: Ordering;
}

export const DEFAULT_VIEW: ViewOptions = { filters: [], grouping: "status", ordering: "priority" };

export const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "assignee", label: "Assignee" },
  { value: "priority", label: "Priority" },
  { value: "cycle", label: "Cycle" },
  { value: "none", label: "No grouping" },
];

export const ORDERINGS: { value: Ordering; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "updated", label: "Last updated" },
  { value: "created", label: "Created" },
];

export function isDefaultView(v: ViewOptions): boolean {
  return !v.filters.length && v.grouping === DEFAULT_VIEW.grouping && v.ordering === DEFAULT_VIEW.ordering;
}

function storageKey(serverUrl: string, userId: number) {
  return `redline.views:${serverUrl}#${userId}`;
}

const GROUPING_VALUES = new Set(GROUPINGS.map((g) => g.value));
const ORDERING_VALUES = new Set(ORDERINGS.map((o) => o.value));

export function loadViews(serverUrl: string, userId: number): Record<string, ViewOptions> {
  try {
    const raw = localStorage.getItem(storageKey(serverUrl, userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<ViewOptions>>;
    const out: Record<string, ViewOptions> = {};
    for (const [route, v] of Object.entries(parsed)) {
      out[route] = {
        filters: Array.isArray(v.filters) ? v.filters.filter((f) => f && Array.isArray(f.values)) : [],
        grouping: v.grouping && GROUPING_VALUES.has(v.grouping) ? v.grouping : DEFAULT_VIEW.grouping,
        ordering: v.ordering && ORDERING_VALUES.has(v.ordering) ? v.ordering : DEFAULT_VIEW.ordering,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveViews(serverUrl: string, userId: number, views: Record<string, ViewOptions>) {
  try {
    localStorage.setItem(storageKey(serverUrl, userId), JSON.stringify(views));
  } catch {
    // Storage can be unavailable; the views still apply until restart.
  }
}

export interface GroupContext {
  categories: CategoryMap;
  priorities: Map<number, PriorityLevel>;
}

// Urgent first, then High, Medium, Low, and No priority last, as in Linear.
const PRIORITY_RANK: Record<PriorityLevel, number> = { 4: 0, 3: 1, 2: 2, 1: 3, 0: 4 };

export function compareBy(ordering: Ordering, ctx: GroupContext): (a: Issue, b: Issue) => number {
  const recent = (a: Issue, b: Issue) => b.updated_on.localeCompare(a.updated_on);
  switch (ordering) {
    case "priority":
      return (a, b) =>
        PRIORITY_RANK[ctx.priorities.get(a.priority.id) ?? 0] - PRIORITY_RANK[ctx.priorities.get(b.priority.id) ?? 0] ||
        recent(a, b);
    case "updated":
      return recent;
    case "created":
      return (a, b) => b.created_on.localeCompare(a.created_on) || b.id - a.id;
  }
}

/** A heading in a grouped list and the issues under it. */
export interface Group {
  key: string;
  label: string;
  /** What the heading's icon shows. */
  icon:
    | { kind: "status"; category: StatusCategory }
    | { kind: "priority"; level: PriorityLevel }
    | { kind: "assignee"; name: string | null }
    | { kind: "cycle" }
    | { kind: "none" };
  issues: Issue[];
}

export function groupIssues(
  issues: Issue[],
  grouping: Grouping,
  ordering: Ordering,
  ctx: GroupContext,
  meta: Metadata,
  me?: number,
): Group[] {
  const compare = compareBy(ordering, ctx);
  const groups = new Map<string, Group & { rank: number | string }>();
  const add = (key: string, make: () => Omit<Group, "key" | "issues"> & { rank: number | string }, issue: Issue) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, issues: [], ...make() }));
    g.issues.push(issue);
  };
  for (const issue of issues) {
    switch (grouping) {
      case "status": {
        const category = issueCategory(issue, ctx.categories);
        add(
          `status:${category}`,
          () => ({ label: CATEGORY_LABEL[category], icon: { kind: "status", category }, rank: CATEGORY_ORDER.indexOf(category) }),
          issue,
        );
        break;
      }
      case "priority": {
        const level = ctx.priorities.get(issue.priority.id) ?? 0;
        add(
          `priority:${issue.priority.id}`,
          () => ({ label: issue.priority.name, icon: { kind: "priority", level }, rank: PRIORITY_RANK[level] }),
          issue,
        );
        break;
      }
      case "assignee": {
        const a = issue.assigned_to;
        if (!a) add("assignee:none", () => ({ label: "No assignee", icon: { kind: "assignee", name: null }, rank: "￿" }), issue);
        else
          add(
            `assignee:${a.id}`,
            // You come first, then everyone else by name.
            () => ({ label: a.name, icon: { kind: "assignee", name: a.name }, rank: a.id === me ? "" : a.name.toLowerCase() }),
            issue,
          );
        break;
      }
      case "cycle": {
        const v = issue.fixed_version;
        if (!v) add("cycle:none", () => ({ label: "No cycle", icon: { kind: "cycle" }, rank: "￿" }), issue);
        else {
          const due = meta.versions.find((x) => x.id === v.id)?.due_date ?? "9999";
          // Soonest due first, so the current cycle leads.
          add(`cycle:${v.id}`, () => ({ label: v.name, icon: { kind: "cycle" }, rank: `${due} ${v.name}` }), issue);
        }
        break;
      }
      case "none":
        add("all", () => ({ label: "All issues", icon: { kind: "none" }, rank: 0 }), issue);
        break;
    }
  }
  return [...groups.values()]
    .sort((a, b) =>
      typeof a.rank === "number" && typeof b.rank === "number" ? a.rank - b.rank : String(a.rank).localeCompare(String(b.rank)),
    )
    .map(({ rank: _rank, ...g }) => ({ ...g, issues: g.issues.sort(compare) }));
}
