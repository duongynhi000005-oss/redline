import { CATEGORY_LABEL, CATEGORY_ORDER, issueCategory, issueLabels } from "./model";
import type { CategoryMap, PriorityLevel, StatusCategory } from "./model";
import type { Issue, Metadata } from "./types";

// Narrowing a view, Linear style: "Status is In progress or Todo", "Label is UI".

export type FilterField = "status" | "priority" | "assignee" | "label" | "cycle" | "project" | "tracker";

export interface Filter {
  field: FilterField;
  /** Matching any one value is enough. Values are ids, "none", or "Field:Value" for labels. */
  values: string[];
}

export const FILTER_FIELDS: { field: FilterField; label: string }[] = [
  { field: "status", label: "Status" },
  { field: "priority", label: "Priority" },
  { field: "assignee", label: "Assignee" },
  { field: "label", label: "Label" },
  { field: "cycle", label: "Cycle" },
  { field: "project", label: "Project" },
  { field: "tracker", label: "Tracker" },
];

export interface FilterContext {
  categories: CategoryMap;
  priorities: Map<number, PriorityLevel>;
  labelFields: Set<number> | null;
}

/** The values an issue has for a field, in the same form filters store them. */
export function valuesOf(issue: Issue, field: FilterField, ctx: FilterContext): string[] {
  switch (field) {
    case "status":
      // Statuses filter by Linear's group, so "Done" covers Closed and Resolved alike.
      return [issueCategory(issue, ctx.categories)];
    case "priority":
      return [String(issue.priority.id)];
    case "assignee":
      return [issue.assigned_to ? String(issue.assigned_to.id) : "none"];
    case "label": {
      const labels = issueLabels(issue, ctx.labelFields).map((l) => `${l.field}:${l.value}`);
      return labels.length ? labels : ["none"];
    }
    case "cycle":
      return [issue.fixed_version ? String(issue.fixed_version.id) : "none"];
    case "project":
      return [String(issue.project.id)];
    case "tracker":
      return [String(issue.tracker.id)];
  }
}

/** An issue passes when it matches every filter. */
export function matchesFilters(issue: Issue, filters: Filter[], ctx: FilterContext): boolean {
  return filters.every((f) => {
    if (!f.values.length) return true;
    const have = valuesOf(issue, f.field, ctx);
    return have.some((v) => f.values.includes(v));
  });
}

/** Turns a value on or off within a field's filter, dropping empty filters. */
export function toggleFilterValue(filters: Filter[], field: FilterField, value: string): Filter[] {
  const existing = filters.find((f) => f.field === field);
  if (!existing) return [...filters, { field, values: [value] }];
  const values = existing.values.includes(value)
    ? existing.values.filter((v) => v !== value)
    : [...existing.values, value];
  return values.length
    ? filters.map((f) => (f.field === field ? { ...f, values } : f))
    : filters.filter((f) => f.field !== field);
}

export interface FilterOption {
  value: string;
  label: string;
  /** How many issues in the view have this value. */
  count: number;
}

/**
 * The values worth offering for a field: the ones the view's issues actually
 * have, so the menu never lists a choice that would empty the list.
 */
export function filterOptions(
  field: FilterField,
  issues: Issue[],
  meta: Metadata,
  ctx: FilterContext,
  me?: number,
): FilterOption[] {
  const counts = new Map<string, number>();
  for (const issue of issues) for (const v of valuesOf(issue, field, ctx)) counts.set(v, (counts.get(v) ?? 0) + 1);
  const name = (v: string): string => {
    if (v === "none") return NONE_LABEL[field];
    const id = Number(v);
    switch (field) {
      case "status":
        return CATEGORY_LABEL[v as StatusCategory];
      case "priority":
        return meta.priorities.find((p) => p.id === id)?.name ?? v;
      case "assignee": {
        const issue = issues.find((i) => i.assigned_to?.id === id);
        const n = issue?.assigned_to?.name ?? v;
        return id === me ? `${n} (you)` : n;
      }
      case "label":
        return v.slice(v.indexOf(":") + 1);
      case "cycle":
        return (
          meta.versions.find((x) => x.id === id)?.name ??
          issues.find((i) => i.fixed_version?.id === id)?.fixed_version?.name ??
          v
        );
      case "project":
        return meta.projects.find((p) => p.id === id)?.name ?? v;
      case "tracker":
        return meta.trackers.find((t) => t.id === id)?.name ?? v;
    }
  };
  const options = [...counts].map(([value, count]) => ({
    value,
    label: name(value),
    count,
  }));
  const rank = (o: FilterOption): number => {
    if (o.value === "none") return field === "priority" ? -1 : Number.MAX_SAFE_INTEGER;
    if (field === "status") return CATEGORY_ORDER.indexOf(o.value as StatusCategory);
    // Most urgent first, as in Linear's priority menu.
    if (field === "priority") return -(ctx.priorities.get(Number(o.value)) ?? 0);
    if (field === "assignee" && Number(o.value) === me) return -1;
    return 0;
  };
  return options.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

const NONE_LABEL: Record<FilterField, string> = {
  status: "No status",
  priority: "No priority",
  assignee: "No assignee",
  label: "No labels",
  cycle: "No cycle",
  project: "No project",
  tracker: "No tracker",
};

/** "Status is Todo or In progress", for a filter chip. */
export function describeFilter(filter: Filter, options: FilterOption[]): { field: string; values: string } {
  const field = FILTER_FIELDS.find((f) => f.field === filter.field)?.label ?? filter.field;
  const names = filter.values.map((v) => options.find((o) => o.value === v)?.label ?? v);
  const values = names.length > 2 ? `${names.length} values` : names.join(" or ");
  return { field, values };
}
