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
  if (c.due_date !== undefined) next.due_date = c.due_date;
  if (c.start_date !== undefined) next.start_date = c.start_date;
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
