import { createDemoBackend } from "./demoBackend";
import { boardColumns, canDrop } from "./board";
import { derive } from "../state/derived";
import type { Issue, Metadata } from "./types";

async function demo(): Promise<{ meta: Metadata; issues: Issue[] }> {
  const backend = createDemoBackend({ signedIn: true });
  return { meta: await backend.getMetadata(), issues: await backend.listIssues() };
}

describe("boardColumns", () => {
  it("gives every Redmine status a column, in the order work flows", async () => {
    const { meta, issues } = await demo();
    const columns = boardColumns(issues, "status", "priority", derive(meta), meta, { showEmpty: true });
    expect(columns.map((c) => c.label)).toEqual(["New", "In Progress", "Resolved", "Feedback", "Closed", "Rejected"]);
    expect(columns.every((c) => c.statusId !== undefined && c.drop.status_id === c.statusId)).toBe(true);
    expect(columns.reduce((n, c) => n + c.issues.length, 0)).toBe(issues.length);
    expect(columns[0]!.issues.every((i) => i.status.id === 1)).toBe(true);
  });

  it("hides empty columns when asked", async () => {
    const { meta, issues } = await demo();
    const some = issues.filter((i) => i.status.id === 2);
    const columns = boardColumns(some, "status", "priority", derive(meta), meta, { showEmpty: false });
    expect(columns.map((c) => c.label)).toEqual(["In Progress"]);
  });

  it("offers empty cycle and assignee columns to drop into", async () => {
    const { meta, issues } = await demo();
    const d = derive(meta);
    const cycles = boardColumns(issues.slice(0, 1), "cycle", "priority", d, meta, { showEmpty: true, versions: meta.versions });
    expect(cycles.map((c) => c.key)).toEqual(expect.arrayContaining(["cycle:2", "cycle:3", "cycle:none"]));
    expect(cycles.find((c) => c.key === "cycle:none")!.drop).toEqual({ fixed_version_id: null });
    const people = boardColumns([], "assignee", "priority", d, meta, { showEmpty: true, me: 1 });
    expect(people.map((c) => c.label)).toEqual(["Dana Developer", "No assignee"]);
    expect(people[0]!.drop).toEqual({ assigned_to_id: 1 });
  });

  it("lists priorities like the list does, with the default (no priority) last", async () => {
    const { meta } = await demo();
    const columns = boardColumns([], "priority", "priority", derive(meta), meta, { showEmpty: true });
    expect(columns.map((c) => c.label)).toEqual(["Immediate", "Urgent", "High", "Low", "Normal"]);
    expect(columns[0]!.drop).toEqual({ priority_id: 5 });
  });

  it("checks status columns against Redmine's workflow", async () => {
    const { meta, issues } = await demo();
    const [, inProgress] = boardColumns(issues, "status", "priority", derive(meta), meta, { showEmpty: true });
    expect(canDrop(inProgress!, null)).toBe(true);
    expect(canDrop(inProgress!, new Set([1, 2]))).toBe(true);
    expect(canDrop(inProgress!, new Set([1, 3]))).toBe(false);
  });
});
