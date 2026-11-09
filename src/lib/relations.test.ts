import type { Issue, Relation } from "./types";
import { blockingIssues, mentionedIds, mentionsIn, relatedGroups, subIssues } from "./relations";

function issue(id: number, extra: Partial<Issue> = {}): Issue {
  return {
    id,
    project: { id: 1, name: "Web" },
    tracker: { id: 1, name: "Bug" },
    status: { id: 1, name: "New", is_closed: false },
    priority: { id: 2, name: "Normal" },
    subject: `Issue ${id}`,
    is_private: false,
    custom_fields: [],
    created_on: "2026-11-01T00:00:00Z",
    updated_on: "2026-11-02T00:00:00Z",
    ...extra,
  };
}

const rel = (id: number, from: number, to: number, type: Relation["relation_type"]): Relation => ({
  id,
  issue_id: from,
  issue_to_id: to,
  relation_type: type,
});

describe("mentions", () => {
  it("finds #123 and ##123 the way Redmine links them", () => {
    expect(mentionedIds("See #12 and (#7), also ##3.")).toEqual([12, 7, 3]);
    expect(mentionedIds("##4 first")).toEqual([4]);
    expect(mentionedIds("#12 then #12 again")).toEqual([12]);
  });

  it("ignores entities, words and zero", () => {
    expect(mentionedIds("&#123; abc#5 #12a #0 # 4 # x##4")).toEqual([]);
  });

  it("reads descriptions and comments, leaving out the issue itself", () => {
    const i = issue(5, { description: "Follows #4 and #5" });
    expect(mentionsIn(i, [{ id: 1, notes: "Also #9", created_on: "", private_notes: false, details: [] }])).toEqual([4, 9]);
  });
});

describe("relations", () => {
  it("names each relation from this issue's side", () => {
    const blocks = rel(1, 2, 1, "blocks");
    const dup = rel(2, 1, 3, "duplicates");
    const one = issue(1, { relations: [blocks, dup] });
    const issues = new Map([1, 2, 3].map((id) => [id, id === 1 ? one : issue(id)]));
    expect(relatedGroups(one, issues).map((g) => [g.label, g.items.map((i) => i.otherId)])).toEqual([
      ["Blocked by", [2]],
      ["Duplicate of", [3]],
    ]);
    const two = issue(2, { relations: [blocks] });
    expect(relatedGroups(two, issues).map((g) => g.label)).toEqual(["Blocking"]);
  });

  it("counts an issue as blocked only while its blocker is open", () => {
    const blocked = issue(1, { relations: [rel(1, 2, 1, "blocks"), rel(2, 1, 3, "blocked"), rel(3, 1, 4, "relates")] });
    const issues = new Map<number, Issue>([
      [1, blocked],
      [2, issue(2, { status: { id: 5, name: "Closed", is_closed: true } })],
      [3, issue(3)],
      [4, issue(4)],
    ]);
    expect(blockingIssues(blocked, issues)).toEqual([3]);
    // An issue Redline hasn't synced counts as open.
    issues.delete(3);
    expect(blockingIssues(blocked, issues)).toEqual([3]);
  });

  it("finds sub-issues by their parent", () => {
    const parent = issue(1);
    const all = [parent, issue(3, { parent: { id: 1 } }), issue(2, { parent: { id: 1 } }), issue(4)];
    expect(subIssues(parent, all).map((i) => i.id)).toEqual([2, 3]);
  });
});
