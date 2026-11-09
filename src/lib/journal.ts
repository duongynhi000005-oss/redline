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
    case "category_id":
      return find(meta.projects.flatMap((p) => p.issue_categories ?? []));
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

/** How a relation change reads, by Redmine's relation type, from this issue's side. */
const RELATION_PHRASE: Record<string, { added: string; removed: string }> = {
  relates: { added: "marked as related to", removed: "removed the relation to" },
  blocks: { added: "marked as blocking", removed: "no longer blocks" },
  blocked: { added: "marked as blocked by", removed: "no longer blocked by" },
  duplicates: { added: "marked as a duplicate of", removed: "no longer a duplicate of" },
  duplicated: { added: "marked as duplicated by", removed: "no longer duplicated by" },
  precedes: { added: "marked as preceding", removed: "no longer precedes" },
  follows: { added: "marked as following", removed: "no longer follows" },
  copied_to: { added: "copied to", removed: "removed the copy link to" },
  copied_from: { added: "copied from", removed: "removed the copy link to" },
};

export function describeDetail(detail: JournalDetail, meta: Metadata): string {
  if (detail.property === "attachment") {
    return detail.new_value ? `attached ${detail.new_value}` : `removed ${detail.old_value ?? "an attachment"}`;
  }
  if (detail.property === "relation") {
    const phrase = RELATION_PHRASE[detail.name] ?? { added: "linked", removed: "unlinked" };
    return detail.new_value ? `${phrase.added} #${detail.new_value}` : `${phrase.removed} #${detail.old_value ?? ""}`;
  }
  if (detail.property === "attr" && detail.name === "child_id") {
    return detail.new_value ? `added sub-issue #${detail.new_value}` : `removed sub-issue #${detail.old_value ?? ""}`;
  }
  if (detail.property === "attr" && detail.name === "parent_id") {
    if (!detail.new_value) return `removed parent #${detail.old_value ?? ""}`;
    if (!detail.old_value) return `set parent to #${detail.new_value}`;
    return `moved from parent #${detail.old_value} to #${detail.new_value}`;
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
