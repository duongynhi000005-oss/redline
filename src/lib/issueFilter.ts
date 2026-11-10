// What a view asks Redmine for: its issues as Redmine's own issue list would
// find them, with the view's filters and sort, a page at a time. See
// docs/architecture.md, "Loading".

import type { Filter, FilterContext } from "./filters";
import type { StatusCategory } from "./model";
import { issueCategory } from "./model";
import type { Condition, Issue, IssueFilter, Metadata } from "./types";
import type { Ordering } from "./views";

/** Linear's "Active" tab: everything started or about to be. */
export const ACTIVE: StatusCategory[] = ["triage", "started", "unstarted"];

/** Redmine's sort for a list's ordering, so the first page is the top of the list. */
export function sortFor(ordering: Ordering): string {
  switch (ordering) {
    case "priority":
      return "priority:desc,updated_on:desc";
    case "created":
      return "created_on:desc,id:desc";
    case "updated":
    case "query":
      return "updated_on:desc,id:desc";
  }
}

/** Status ids in any of these categories. */
export function statusIds(categories: StatusCategory[], ctx: Pick<FilterContext, "categories">, meta: Metadata): string[] {
  return meta.statuses
    .filter((s) => categories.includes(issueCategory({ status: s } as Issue, ctx.categories)))
    .map((s) => String(s.id));
}

const FIELD: Partial<Record<Filter["field"], string>> = {
  priority: "priority_id",
  assignee: "assigned_to_id",
  cycle: "fixed_version_id",
  category: "category_id",
  project: "project_id",
  tracker: "tracker_id",
};

/**
 * Adds a list's filters to what its view asks Redmine for. `exact` is false
 * when Redmine can't say all of it (labels, or "none or these" together):
 * the list then also filters what arrives, and Redmine's count is too high.
 */
export function withFilters(
  base: IssueFilter,
  filters: Filter[],
  ctx: FilterContext,
  meta: Metadata,
): { filter: IssueFilter; exact: boolean } {
  const conditions: Condition[] = [...base.conditions];
  let exact = true;
  const taken = new Set(conditions.map((c) => c.field));
  for (const f of filters) {
    if (!f.values.length) continue;
    if (f.field === "status") {
      if (taken.has("status_id")) {
        exact = false;
        continue;
      }
      const ids = statusIds(f.values as StatusCategory[], ctx, meta);
      conditions.push(ids.length ? { field: "status_id", op: "=", values: ids } : { field: "status_id", op: "!*", values: [] });
      taken.add("status_id");
      continue;
    }
    const field = FIELD[f.field];
    // Labels are custom fields Redmine may not filter by; the list filters them.
    if (!field || taken.has(field)) {
      exact = false;
      continue;
    }
    const none = f.values.includes("none");
    const ids = f.values.filter((v) => v !== "none");
    if (none && ids.length) {
      exact = false;
      continue;
    }
    conditions.push(none ? { field, op: "!*", values: [] } : { field, op: "=", values: ids });
    taken.add(field);
  }
  return { filter: { ...base, conditions }, exact };
}

/** A stable key for a filter, to tell lists and counts apart. */
export function filterKey(filter: IssueFilter): string {
  return JSON.stringify([filter.projectId ?? null, filter.conditions, filter.sort ?? null]);
}

/** Issues in a project and its sub-projects, open or not. */
export function inProject(projectId: number, conditions: Condition[] = []): IssueFilter {
  return { projectId, conditions };
}

// ----- Matching, for the demo backend and tests ----------------------------

function dateOnly(v: string): string {
  return v.length > 10 ? v : v.slice(0, 10);
}

function fieldValues(issue: Issue, field: string): (string | null)[] {
  switch (field) {
    case "status_id":
      return [String(issue.status.id)];
    case "assigned_to_id":
      return [issue.assigned_to ? String(issue.assigned_to.id) : null];
    case "author_id":
      return [issue.author ? String(issue.author.id) : null];
    case "fixed_version_id":
      return [issue.fixed_version ? String(issue.fixed_version.id) : null];
    case "tracker_id":
      return [String(issue.tracker.id)];
    case "priority_id":
      return [String(issue.priority.id)];
    case "category_id":
      return [issue.category ? String(issue.category.id) : null];
    case "project_id":
      return [String(issue.project.id)];
    case "issue_id":
      return [String(issue.id)];
    case "parent_id":
      return [issue.parent ? String(issue.parent.id) : null];
    case "subject":
      return [issue.subject];
    case "any_searchable":
      return [`${issue.subject} ${issue.description ?? ""}`];
    case "watcher_id": {
      const ids = (issue.watchers ?? []).map((w) => String(w.id));
      return ids.length ? ids : [null];
    }
    case "updated_on":
      return [issue.updated_on];
    case "created_on":
      return [issue.created_on];
    case "start_date":
      return [issue.start_date ?? null];
    case "due_date":
      return [issue.due_date ?? null];
    default: {
      const cf = /^cf_(\d+)$/.exec(field);
      if (!cf) return [null];
      const f = issue.custom_fields.find((c) => c.id === Number(cf[1]));
      const v = f?.value;
      const list = Array.isArray(v) ? v : v ? [v] : [];
      return list.length ? list : [null];
    }
  }
}

/** Whether an issue matches a condition, the way Redmine would decide. */
export function matchesCondition(issue: Issue, c: Condition, me?: number, closed?: Set<number>): boolean {
  const values = c.values.map((v) => (v === "me" && me !== undefined ? String(me) : v));
  const have = fieldValues(issue, c.field);
  switch (c.op) {
    case "*":
      return have.some((h) => h !== null);
    case "!*":
      return have.every((h) => h === null);
    case "=":
      if (c.field === "issue_id") return values.flatMap((v) => v.split(",")).some((v) => have.includes(v.trim()));
      return have.some((h) => h !== null && values.includes(h));
    case "!":
      return !have.some((h) => h !== null && values.includes(h));
    case "~":
      return values.every((v) =>
        v
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean)
          .every((word) => have.some((h) => h?.toLowerCase().includes(word))),
      );
    case "o":
      return !(closed ? closed.has(issue.status.id) : issue.status.is_closed);
    case "c":
      return closed ? closed.has(issue.status.id) : !!issue.status.is_closed;
    case ">=":
      return have.some((h) => h !== null && dateOnly(h) >= values[0]!);
    case "<=":
      return have.some((h) => h !== null && dateOnly(h).slice(0, values[0]!.length) <= values[0]!);
    case "><":
      return have.some((h) => h !== null && h >= values[0]! && h.slice(0, values[1]!.length) <= values[1]!);
    default:
      return true;
  }
}

/** Whether an issue is among what a filter finds, given the projects under its project. */
export function matchesIssueFilter(
  issue: Issue,
  filter: IssueFilter,
  inScope: (projectId: number, scope: number) => boolean,
  me?: number,
  closed?: Set<number>,
): boolean {
  if (filter.projectId != null && !inScope(issue.project.id, filter.projectId)) return false;
  return filter.conditions.every((c) => c.field === "subproject_id" || matchesCondition(issue, c, me, closed));
}
