import type { Issue, Journal, NewRelation, Relation, RelationType } from "./types";

// How issues connect: Redmine relations (blocks, relates, duplicates...),
// parent and sub-issues, and #123 mentions in descriptions and comments.

/** The same relation seen from the other issue. */
export const INVERSE: Record<RelationType, RelationType> = {
  relates: "relates",
  duplicates: "duplicated",
  duplicated: "duplicates",
  blocks: "blocked",
  blocked: "blocks",
  precedes: "follows",
  follows: "precedes",
  copied_to: "copied_from",
  copied_from: "copied_to",
};

/** Section names, from this issue's side, in the order they're shown. */
export const RELATION_LABEL: [RelationType, string][] = [
  ["blocked", "Blocked by"],
  ["blocks", "Blocking"],
  ["relates", "Related to"],
  ["duplicates", "Duplicate of"],
  ["duplicated", "Duplicated by"],
  ["precedes", "Precedes"],
  ["follows", "Follows"],
  ["copied_from", "Copied from"],
  ["copied_to", "Copied to"],
];

export interface RelatedIssue {
  relation: Relation;
  /** The relation's type from this issue's side. */
  type: RelationType;
  otherId: number;
  other: Issue | undefined;
}

/** This issue's relations from its own side, grouped and ordered for display. */
export function relatedGroups(issue: Issue, issues: Map<number, Issue>): { type: RelationType; label: string; items: RelatedIssue[] }[] {
  const items = (issue.relations ?? []).map((relation): RelatedIssue => {
    const outgoing = relation.issue_id === issue.id;
    const otherId = outgoing ? relation.issue_to_id : relation.issue_id;
    const type = outgoing ? relation.relation_type : INVERSE[relation.relation_type];
    return { relation, type, otherId, other: issues.get(otherId) };
  });
  return RELATION_LABEL.map(([type, label]) => ({
    type,
    label,
    items: items.filter((i) => i.type === type).sort((a, b) => a.otherId - b.otherId),
  })).filter((g) => g.items.length > 0);
}

/**
 * Whether an issue is blocked by another that's still open. An issue the
 * cache doesn't have (another project, say) counts as open.
 */
export function blockingIssues(issue: Issue, issues: Map<number, Issue>): number[] {
  return (issue.relations ?? [])
    .filter((r) => (r.issue_id === issue.id ? r.relation_type === "blocked" : r.relation_type === "blocks"))
    .map((r) => (r.issue_id === issue.id ? r.issue_to_id : r.issue_id))
    .filter((id) => !issues.get(id)?.status.is_closed);
}

/** Sub-issues of an issue that the cache knows, by id. */
export function subIssues(issue: Issue, issues: Iterable<Issue>): Issue[] {
  const out: Issue[] = [];
  for (const i of issues) if (i.parent?.id === issue.id) out.push(i);
  return out.sort((a, b) => a.id - b.id);
}

/**
 * Issue ids mentioned in text the way Redmine links them: #123 or ##123,
 * but not &#123; (an HTML entity) or abc#123. Matches redline-core's mentions.rs.
 */
export function mentionedIds(text: string): number[] {
  const ids: number[] = [];
  for (const m of text.matchAll(/(?:^|^#|[^\w&#]|[^\w&]#)#(\d+)(?!\w)/g)) {
    const id = Number(m[1]);
    if (id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Issues this one mentions in its description and comments, leaving out itself. */
export function mentionsIn(issue: Issue, journals: Journal[] | null): number[] {
  const texts = [issue.description ?? "", ...(journals ?? []).map((j) => j.notes ?? "")];
  const ids: number[] = [];
  for (const text of texts) for (const id of mentionedIds(text)) if (id !== issue.id && !ids.includes(id)) ids.push(id);
  return ids;
}

/** The ways to connect another issue to this one, for the relation picker. */
export type RelationChoice = RelationType | "parent" | "sub-issue";

export const RELATION_CHOICES: { choice: RelationChoice; label: string; placeholder: string }[] = [
  { choice: "sub-issue", label: "Add sub-issue…", placeholder: "Add a sub-issue…" },
  { choice: "parent", label: "Set parent issue…", placeholder: "Set the parent issue…" },
  { choice: "blocked", label: "Mark as blocked by…", placeholder: "Blocked by…" },
  { choice: "blocks", label: "Mark as blocking…", placeholder: "Blocking…" },
  { choice: "relates", label: "Mark as related to…", placeholder: "Related to…" },
  { choice: "duplicates", label: "Mark as duplicate of…", placeholder: "Duplicate of…" },
  { choice: "precedes", label: "Mark as preceding…", placeholder: "Precedes…" },
  { choice: "follows", label: "Mark as following…", placeholder: "Follows…" },
];

export function newRelation(type: RelationType, otherId: number): NewRelation {
  return { issue_to_id: otherId, relation_type: type };
}
