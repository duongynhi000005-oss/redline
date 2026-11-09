import { matchesQuery } from "./CommandPalette";
import { linkIssueRefs } from "./Markdown";
import { syncLabel } from "./Sidebar";

describe("linkIssueRefs", () => {
  it("links #123 references outside code", () => {
    expect(linkIssueRefs("See #12 and (#3).")).toBe("See [#12](#issue-12) and ([#3](#issue-3)).");
    expect(linkIssueRefs("Run `git log #12` first")).toBe("Run `git log #12` first");
    expect(linkIssueRefs("```\n#12\n```\n#4")).toBe("```\n#12\n```\n[#4](#issue-4)");
    expect(linkIssueRefs("# Heading\nissue#5")).toBe("# Heading\nissue#5");
  });
});

describe("matchesQuery", () => {
  it("needs every word, in any order", () => {
    expect(matchesQuery("Go to Mobile", "mob go")).toBe(true);
    expect(matchesQuery("Go to Mobile", "web")).toBe(false);
  });
});

describe("syncLabel", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  it("says how long ago the last sync was", () => {
    expect(syncLabel("idle", null, now - 10_000, now)).toBe("Synced just now");
    expect(syncLabel("idle", null, now - 5 * 60_000, now)).toBe("Synced 5m ago");
    expect(syncLabel("idle", null, now - 3 * 3_600_000, now)).toBe("Synced 3h ago");
    expect(syncLabel("offline", null, now, now)).toBe("Offline, showing saved issues");
    expect(syncLabel("error", "Redmine is busy", now, now)).toBe("Redmine is busy");
  });
});
