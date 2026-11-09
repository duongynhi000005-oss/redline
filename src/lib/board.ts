import type { StatusCategory } from "./model";
import { defaultCategory } from "./model";
import type { Issue, IssueChanges, Metadata, Version } from "./types";
import type { Group, GroupContext, Grouping, Ordering } from "./views";
import { compareBy, groupIssues } from "./views";

// The board (Kanban) layout: one column per value of the list's grouping.
// Dropping an issue on a column sets that value.

export interface BoardColumn {
  key: string;
  label: string;
  icon: Group["icon"];
  issues: Issue[];
  /** What dropping an issue here changes. */
  drop: IssueChanges;
  /** For status columns, the Redmine status the column stands for. */
  statusId?: number;
}

/** Left to right, the way work flows across a board. */
export const BOARD_CATEGORY_ORDER: StatusCategory[] = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];

export interface BoardScope {
  /** You, so your column comes first when grouping by assignee. */
  me?: number;
  /** Versions that belong to the list, offered as empty cycle columns. */
  versions?: Version[];
  showEmpty: boolean;
}

/**
 * The columns of a board. Grouping by status gives one column per Redmine
 * status, so a drop always means one exact status; no grouping does the same.
 */
export function boardColumns(
  issues: Issue[],
  grouping: Grouping,
  ordering: Ordering,
  ctx: GroupContext,
  meta: Metadata,
  scope: BoardScope,
): BoardColumn[] {
  const compare = compareBy(ordering, ctx);
  let columns: BoardColumn[];
  if (grouping === "status" || grouping === "none") {
    const byStatus = new Map<number, Issue[]>();
    for (const issue of issues) {
      const list = byStatus.get(issue.status.id);
      if (list) list.push(issue);
      else byStatus.set(issue.status.id, [issue]);
    }
    const statuses = [...meta.statuses];
    // A status the metadata doesn't know yet still gets a column.
    for (const issue of issues) {
      if (!statuses.some((s) => s.id === issue.status.id)) {
        statuses.push({ id: issue.status.id, name: issue.status.name, is_closed: !!issue.status.is_closed });
      }
    }
    const categoryOf = (id: number, fallback: StatusCategory) => ctx.categories.get(id) ?? fallback;
    columns = statuses
      .map((s, position) => ({ s, position, category: categoryOf(s.id, defaultCategory(s, meta.trackers)) }))
      .sort((a, b) => BOARD_CATEGORY_ORDER.indexOf(a.category) - BOARD_CATEGORY_ORDER.indexOf(b.category) || a.position - b.position)
      .map(({ s, category }) => ({
        key: `status:${s.id}`,
        label: s.name,
        icon: { kind: "status", category },
        issues: (byStatus.get(s.id) ?? []).sort(compare),
        drop: { status_id: s.id },
        statusId: s.id,
      }));
  } else {
    const groups = groupIssues(issues, grouping, ordering, ctx, meta, scope.me);
    columns = groups.map((g) => ({ ...g, drop: dropFor(g.key) }));
    if (scope.showEmpty) columns = withEmptyColumns(columns, grouping, ctx, meta, scope);
  }
  return scope.showEmpty ? columns : columns.filter((c) => c.issues.length > 0);
}

function dropFor(key: string): IssueChanges {
  const [field, raw] = key.split(":");
  const id = raw === "none" ? null : Number(raw);
  switch (field) {
    case "priority":
      return { priority_id: id ?? undefined };
    case "assignee":
      return { assigned_to_id: id };
    case "cycle":
      return { fixed_version_id: id };
    default:
      return {};
  }
}

/** Adds the columns an issue could be dropped into but none is in yet. */
function withEmptyColumns(
  columns: BoardColumn[],
  grouping: Grouping,
  ctx: GroupContext,
  meta: Metadata,
  scope: BoardScope,
): BoardColumn[] {
  const have = new Set(columns.map((c) => c.key));
  const extra: BoardColumn[] = [];
  const add = (column: Omit<BoardColumn, "issues">) => {
    if (!have.has(column.key)) extra.push({ ...column, issues: [] });
  };
  switch (grouping) {
    case "priority":
      for (const p of meta.priorities) {
        add({
          key: `priority:${p.id}`,
          label: p.name,
          icon: { kind: "priority", level: ctx.priorities.get(p.id) ?? 0 },
          drop: { priority_id: p.id },
        });
      }
      break;
    case "assignee": {
      const me = meta.user;
      if (me && me.id === scope.me) {
        const name = `${me.firstname} ${me.lastname}`.trim() || me.login;
        add({ key: `assignee:${me.id}`, label: name, icon: { kind: "assignee", name }, drop: { assigned_to_id: me.id } });
      }
      add({ key: "assignee:none", label: "No assignee", icon: { kind: "assignee", name: null }, drop: { assigned_to_id: null } });
      break;
    }
    case "cycle":
      for (const v of scope.versions ?? []) {
        if (v.status !== "open") continue;
        add({ key: `cycle:${v.id}`, label: v.name, icon: { kind: "cycle" }, drop: { fixed_version_id: v.id } });
      }
      add({ key: "cycle:none", label: "No cycle", icon: { kind: "cycle" }, drop: { fixed_version_id: null } });
      break;
    default:
      break;
  }
  if (!extra.length) return columns;
  // Keep the order the list uses: rebuild it from every column's sort key.
  const all = [...columns, ...extra];
  const rank = (c: BoardColumn): string | number => {
    switch (grouping) {
      case "priority": {
        const id = Number(c.key.split(":")[1]);
        const level = ctx.priorities.get(id) ?? 0;
        // Urgent first, as in the list; the same level keeps Redmine's order, highest first.
        const position = meta.priorities.findIndex((p) => p.id === id);
        return ({ 4: 0, 3: 1, 2: 2, 1: 3, 0: 4 } as const)[level] * 1000 - position;
      }
      case "assignee":
        if (c.key === "assignee:none") return "￿";
        return c.key === `assignee:${scope.me}` ? "" : c.label.toLowerCase();
      case "cycle": {
        if (c.key === "cycle:none") return "￿";
        const due = meta.versions.find((v) => `cycle:${v.id}` === c.key)?.due_date ?? "9999";
        return `${due} ${c.label}`;
      }
      default:
        return 0;
    }
  };
  return all
    .map((c) => ({ c, r: rank(c) }))
    .sort((a, b) => (typeof a.r === "number" && typeof b.r === "number" ? a.r - b.r : String(a.r).localeCompare(String(b.r))))
    .map(({ c }) => c);
}

/** Whether Redmine's workflow lets an issue into a column, when that's known. */
export function canDrop(column: BoardColumn, allowedStatusIds: Set<number> | null): boolean {
  if (column.statusId === undefined || !allowedStatusIds) return true;
  return allowedStatusIds.has(column.statusId);
}
