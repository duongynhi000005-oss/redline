import { createDemoBackend, demoIssues } from "../lib/demoBackend";
import type { Issue, Metadata } from "../lib/types";
import { groupIssues } from "../lib/views";
import { derive, issuesForRoute } from "./derived";

async function demo(): Promise<{ meta: Metadata; issues: Issue[] }> {
  const backend = createDemoBackend({ signedIn: true });
  return { meta: await backend.getMetadata(), issues: demoIssues() };
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

describe("groupIssues", () => {
  it("orders status groups like Linear and sorts by priority then recency", async () => {
    const { meta, issues } = await demo();
    const d = derive(meta);
    const groups = groupIssues(issues, "status", "priority", d, meta);
    expect(groups.map((g) => g.key)).toEqual(["status:started", "status:unstarted", "status:completed", "status:canceled"]);
    for (const g of groups) {
      const ranks = g.issues.map((i) => [4, 3, 2, 1, 0].indexOf(d.priorities.get(i.priority.id) ?? 0));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});

describe("groupIssues by other fields", () => {
  it("puts you first among assignees and unassigned last", async () => {
    const { meta, issues } = await demo();
    const d = derive(meta);
    const groups = groupIssues(issues, "assignee", "updated", d, meta, 1);
    expect(groups[0]!.key).toBe("assignee:1");
    if (groups.some((g) => g.key === "assignee:none")) expect(groups.at(-1)!.key).toBe("assignee:none");
    for (const g of groups) {
      const stamps = g.issues.map((i) => i.updated_on);
      expect(stamps).toEqual([...stamps].sort().reverse());
    }
  });

  it("lists the most urgent priority first and keeps every issue", async () => {
    const { meta, issues } = await demo();
    const d = derive(meta);
    const groups = groupIssues(issues, "priority", "created", d, meta);
    const levels = groups.map((g) => (g.icon.kind === "priority" ? g.icon.level : -1));
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
    expect(groups.reduce((n, g) => n + g.issues.length, 0)).toBe(issues.length);
  });

  it("orders cycles by due date with No cycle last", async () => {
    const { meta, issues } = await demo();
    const d = derive(meta);
    const keys = groupIssues(issues, "cycle", "priority", d, meta).map((g) => g.key);
    if (keys.includes("cycle:none")) expect(keys.at(-1)).toBe("cycle:none");
    const dues = keys
      .filter((k) => k !== "cycle:none")
      .map((k) => meta.versions.find((v) => `cycle:${v.id}` === k)?.due_date ?? "9999");
    expect(dues).toEqual([...dues].sort());
  });
});
