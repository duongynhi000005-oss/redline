import { defaultCategory, priorityLevels, issueLabels, relativeTime, teamOf, activeCycle, initials } from "./model";
import { createDemoBackend } from "./demoBackend";

const trackers = [{ id: 1, name: "Bug", default_status: { id: 1, name: "New" } }];

describe("status categories", () => {
  it("maps Redmine's default statuses the Linear way", () => {
    const cat = (name: string, is_closed = false, id = 9) => defaultCategory({ id, name, is_closed }, trackers);
    expect(cat("New", false, 1)).toBe("unstarted");
    expect(cat("In Progress")).toBe("started");
    expect(cat("Feedback")).toBe("started");
    expect(cat("Closed", true)).toBe("completed");
    expect(cat("Rejected", true)).toBe("canceled");
    expect(cat("Duplicate", true)).toBe("canceled");
    expect(cat("Backlog")).toBe("backlog");
  });
});

describe("priority levels", () => {
  it("puts the default priority at no priority and climbs from there", () => {
    const levels = priorityLevels([
      { id: 1, name: "Low", is_default: false, active: true },
      { id: 2, name: "Normal", is_default: true, active: true },
      { id: 3, name: "High", is_default: false, active: true },
      { id: 4, name: "Urgent", is_default: false, active: true },
      { id: 5, name: "Immediate", is_default: false, active: true },
    ]);
    expect([1, 2, 3, 4, 5].map((id) => levels.get(id))).toEqual([1, 0, 3, 4, 4]);
  });
});

describe("labels and teams", () => {
  it("reads labels from multi-value custom fields by default", async () => {
    const backend = createDemoBackend({ signedIn: true });
    const [issue] = await backend.getIssues([3]);
    expect(issueLabels(issue!, null).map((l) => l.value)).toEqual(["UI", "Performance"]);
    expect(issueLabels(issue!, new Set([2])).map((l) => l.value)).toEqual(["L"]);
  });

  it("files subprojects under their top-level team", async () => {
    const meta = await createDemoBackend().getMetadata();
    expect(teamOf(3, meta)).toBe(1);
    expect(teamOf(2, meta)).toBe(2);
  });

  it("finds the active cycle", async () => {
    const meta = await createDemoBackend().getMetadata();
    expect(activeCycle(1, meta.versions, new Date("2026-11-09"))?.name).toBe("Sprint 2");
  });
});

describe("formatting", () => {
  it("shows short relative times", () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    expect(relativeTime("2026-11-09T11:59:30Z", now)).toBe("now");
    expect(relativeTime("2026-11-09T11:00:00Z", now)).toBe("1h");
    expect(relativeTime("2026-11-08T10:00:00Z", now)).toBe("Yesterday");
  });

  it("makes initials", () => {
    expect(initials("Dana Developer")).toBe("DD");
    expect(initials("sam")).toBe("S");
  });
});
