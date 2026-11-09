import { allowed } from "./permissions";
import type { Issue, IssueChanges, Metadata, Named } from "./types";

// Applying an edit to a local copy of an issue, so the UI can show it at once
// while Redmine catches up. The server's answer replaces it.

export function people(meta: Metadata, projectId?: number): Named[] {
  const seen = new Map<number, Named>();
  if (meta.user) seen.set(meta.user.id, { id: meta.user.id, name: `${meta.user.firstname} ${meta.user.lastname}`.trim() });
  for (const m of meta.memberships) {
    if (projectId !== undefined && m.project.id !== projectId) continue;
    const who = m.user ?? m.group;
    if (who && !seen.has(who.id)) seen.set(who.id, who);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether an issue's tracker uses a standard field, like "category_id" or
 * "estimated_hours". Servers that don't say use them all.
 */
export function fieldEnabled(meta: Metadata, trackerId: number, field: string): boolean {
  const fields = meta.trackers.find((t) => t.id === trackerId)?.enabled_standard_fields;
  return !fields || fields.includes(field);
}

/** Projects an issue could move to: ones with trackers, where the role may add issues, as far as Redline knows. */
export function moveTargets(meta: Metadata): Metadata["projects"] {
  return meta.projects.filter((p) => p.trackers.length > 0 && allowed(meta, p.id, "add_issues") !== false);
}

function stamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function applyChanges(issue: Issue, c: IssueChanges, meta: Metadata): Issue {
  const next: Issue = { ...issue, updated_on: stamp() };
  if (c.subject !== undefined) next.subject = c.subject;
  if (c.description !== undefined) next.description = c.description;
  if (c.status_id !== undefined) {
    const s = meta.statuses.find((x) => x.id === c.status_id);
    if (s) next.status = { id: s.id, name: s.name, is_closed: s.is_closed };
  }
  if (c.priority_id !== undefined) {
    const p = meta.priorities.find((x) => x.id === c.priority_id);
    if (p) next.priority = { id: p.id, name: p.name };
  }
  if (c.tracker_id !== undefined) {
    const t = meta.trackers.find((x) => x.id === c.tracker_id);
    if (t) next.tracker = { id: t.id, name: t.name };
  }
  if (c.assigned_to_id !== undefined) {
    next.assigned_to = c.assigned_to_id === null ? null : (people(meta).find((p) => p.id === c.assigned_to_id) ?? null);
  }
  if (c.fixed_version_id !== undefined) {
    const v = meta.versions.find((x) => x.id === c.fixed_version_id);
    next.fixed_version = v ? { id: v.id, name: v.name } : null;
  }
  if (c.project_id !== undefined) {
    const p = meta.projects.find((x) => x.id === c.project_id);
    if (p) next.project = { id: p.id, name: p.name };
  }
  if (c.parent_issue_id !== undefined) next.parent = c.parent_issue_id === null ? null : { id: c.parent_issue_id };
  if (c.due_date !== undefined) next.due_date = c.due_date;
  if (c.start_date !== undefined) next.start_date = c.start_date;
  if (c.category_id !== undefined) {
    const categories = meta.projects.find((p) => p.id === next.project.id)?.issue_categories ?? [];
    next.category = c.category_id === null ? null : (categories.find((x) => x.id === c.category_id) ?? null);
  } else if (c.project_id !== undefined && c.project_id !== issue.project.id) {
    // Categories belong to a project, so a move drops it, as Redmine does.
    next.category = null;
  }
  if (c.estimated_hours !== undefined) next.estimated_hours = c.estimated_hours;
  if (c.done_ratio !== undefined) next.done_ratio = c.done_ratio;
  if (c.is_private !== undefined) next.is_private = c.is_private;
  if (c.custom_fields) {
    next.custom_fields = next.custom_fields.map((f) => {
      const change = c.custom_fields!.find((x) => x.id === f.id);
      return change ? { ...f, value: change.value } : f;
    });
  }
  return next;
}

/**
 * Every value seen for each custom field, for the label picker. Redmine only
 * tells admins a field's possible values, so Redline learns them from issues.
 */
export function knownLabelValues(issues: Iterable<Issue>): Map<number, { name: string; values: string[] }> {
  const fields = new Map<number, { name: string; values: Set<string> }>();
  for (const issue of issues) {
    for (const f of issue.custom_fields) {
      let entry = fields.get(f.id);
      if (!entry) fields.set(f.id, (entry = { name: f.name, values: new Set() }));
      for (const v of Array.isArray(f.value) ? f.value : f.value ? [f.value] : []) if (v) entry.values.add(v);
    }
  }
  return new Map(
    [...fields].map(([id, { name, values }]) => [id, { name, values: [...values].sort((a, b) => a.localeCompare(b)) }]),
  );
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How a custom field is edited, guessed from the values Redline has seen:
 * Redmine shows field definitions only to admins. Date fields hold only
 * days; everything else is edited as a value picked or typed.
 */
export function fieldShape(values: string[]): "date" | "value" {
  return values.length > 0 && values.every((v) => DAY.test(v)) ? "date" : "value";
}

/** The value to send for a custom field after picking or typing one. */
export function nextFieldValue(current: string[], multiple: boolean, value: string): string | string[] {
  if (!multiple) return current.includes(value) ? "" : value;
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  // Redmine clears a multi-value field when sent a single blank.
  return next.length ? next : [""];
}

/** A custom field's value as a list, without blanks. */
export function fieldValues(value: string | string[] | null | undefined): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
}

/**
 * The fields of a new issue copied from another, as Redmine's own Copy does:
 * everything but status, history, files and sub-issues.
 */
export function copyFields(issue: Issue): IssueChanges {
  const custom = issue.custom_fields
    .filter((f) => fieldValues(f.value).length)
    .map((f) => ({ id: f.id, value: f.multiple ? fieldValues(f.value) : fieldValues(f.value)[0]! }));
  const fields: IssueChanges = {
    project_id: issue.project.id,
    tracker_id: issue.tracker.id,
    subject: issue.subject,
    description: issue.description ?? undefined,
    priority_id: issue.priority.id,
    assigned_to_id: issue.assigned_to?.id ?? null,
    category_id: issue.category?.id ?? null,
    fixed_version_id: issue.fixed_version?.id ?? null,
    parent_issue_id: issue.parent?.id ?? null,
    start_date: issue.start_date ?? null,
    due_date: issue.due_date ?? null,
    estimated_hours: issue.estimated_hours ?? null,
    is_private: issue.is_private || undefined,
    ...(custom.length ? { custom_fields: custom } : {}),
  };
  // Leave out what's empty rather than send it.
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined)) as IssueChanges;
}
