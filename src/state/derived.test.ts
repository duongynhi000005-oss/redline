import { createDemoBackend } from "../lib/demoBackend";
import type { Issue, Metadata } from "../lib/types";
import { derive, groupByCategory, issuesForRoute } from "./derived";

async function demo(): Promise<{ meta: Metadata; issues: Issue[] }> {
  const backend = createDemoBackend({ signedIn: true });
  return { meta: await backend.getMetadata(), issues: await backend.listIssues() };
}

describe("derive", () => {
  it("treats top-level projects as teams and nests subprojects under them", async () => {
    const { meta } = await demo();
    const d = derive(meta);
    expect(d.teams.map((t) => t.name)).toEqual(["Mobile", "Web"]);
    expect(d.teamProjects.get(1)?.map((p) => p.name)).toEqual(["Design"]);
  });
});

describe("issuesForRoute", () => {
  it("shows my assigned issues", async () => {
    const { meta, issues } = await demo();
    const mine = issuesForRoute({ view: "my-issues", tab: "assigned" }, issues, derive(meta), 1, meta);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((i) => i.assigned_to?.id === 1)).toBe(true);
  });

  it("keeps a team's active view to triage, todo and in-progress work", async () => {
    const { meta, issues } = await demo();
    const d = derive(meta);
    const active = issuesForRoute({ view: "team", teamId: 1, tab: "active" }, issues, d, 1, meta);
    expect(active.every((i) => !i.status.is_closed)).toBe(true);
    // Subprojects belong to the team.
    expect(active.some((i) => i.project.id === 3) || issues.every((i) => i.project.id !== 3)).toBe(true);
    const all = issuesForRoute({ view: "team", teamId: 1, tab: "all" }, issues, d, 1, meta);
    expect(all.length).toBeGreaterThan(active.length);
    expect(all.every((i) => i.project.id !== 2)).toBe(true);
  });
});

describe("groupByCategory", () => {
  it("orders groups like Linear and sorts by priority then recency", async () => {
    const { meta, issues } = await demo();
    const d = derive(meta);
    const groups = groupByCategory(issues, d);
    expect(groups.map((g) => g.category)).toEqual(["started", "unstarted", "completed", "canceled"]);
    for (const g of groups) {
      const ranks = g.issues.map((i) => [4, 3, 2, 1, 0].indexOf(d.priorities.get(i.priority.id) ?? 0));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});
