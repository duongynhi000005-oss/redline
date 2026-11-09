import type { JournalDetail, Metadata } from "./types";

// Words for a journal's changes, like "changed status from New to In Progress".

const ATTRIBUTE_NAMES: Record<string, string> = {
  status_id: "status",
  priority_id: "priority",
  assigned_to_id: "assignee",
  fixed_version_id: "cycle",
  tracker_id: "tracker",
  project_id: "project",
  category_id: "category",
  parent_id: "parent issue",
  subject: "title",
  description: "description",
  due_date: "due date",
  start_date: "start date",
  done_ratio: "% done",
  estimated_hours: "estimate",
  is_private: "privacy",
};

function lookup(meta: Metadata, attribute: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  const find = (list: { id: number; name: string }[]) => list.find((x) => x.id === id)?.name ?? `#${value}`;
  switch (attribute) {
    case "status_id":
      return find(meta.statuses);
    case "priority_id":
      return find(meta.priorities);
    case "tracker_id":
      return find(meta.trackers);
    case "project_id":
      return find(meta.projects);
    case "fixed_version_id":
      return find(meta.versions);
    case "assigned_to_id": {
      const people = meta.memberships.flatMap((m) => (m.user ? [m.user] : m.group ? [m.group] : []));
      if (meta.user?.id === id) return `${meta.user.firstname} ${meta.user.lastname}`.trim();
      return people.find((p) => p.id === id)?.name ?? `user ${value}`;
    }
    case "parent_id":
      return `#${value}`;
    default:
      return value;
  }
}

export function describeDetail(detail: JournalDetail, meta: Metadata): string {
  if (detail.property === "attachment") {
    return detail.new_value ? `attached ${detail.new_value}` : `removed ${detail.old_value ?? "an attachment"}`;
  }
  if (detail.property === "relation") {
    return detail.new_value ? `linked #${detail.new_value}` : `unlinked #${detail.old_value ?? ""}`;
  }
  let field: string;
  let oldValue: string | null;
  let newValue: string | null;
  if (detail.property === "cf") {
    const id = Number(detail.name);
    field =
      meta.projects.flatMap((p) => p.issue_custom_fields).find((f) => f.id === id)?.name ?? `custom field ${detail.name}`;
    oldValue = detail.old_value || null;
    newValue = detail.new_value || null;
  } else {
    field = ATTRIBUTE_NAMES[detail.name] ?? detail.name.replace(/_id$/, "").replace(/_/g, " ");
    oldValue = lookup(meta, detail.name, detail.old_value);
    newValue = lookup(meta, detail.name, detail.new_value);
  }
  if (detail.name === "description") return "updated the description";
  if (!newValue) return `removed ${field}${oldValue ? ` ${oldValue}` : ""}`;
  if (!oldValue) return `set ${field} to ${newValue}`;
  return `changed ${field} from ${oldValue} to ${newValue}`;
}
