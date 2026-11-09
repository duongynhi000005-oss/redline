import { matchesQuery, rankIssues } from "./CommandPalette";
import type { Issue } from "../lib/types";
import { linkIssueRefs } from "./Markdown";
import { syncLabel } from "./Sidebar";

describe("linkIssueRefs", () => {
  it("links #123 references outside code", () => {
    expect(linkIssueRefs("See #12 and (#3).")).toBe("See [#12](#issue-12) and ([#3](#issue-3)).");
    expect(linkIssueRefs("Run `git log #12` first")).toBe("Run `git log #12` first");
    expect(linkIssueRefs("```\n#12\n```\n#4")).toBe("```\n#12\n```\n[#4](#issue-4)");
    expect(linkIssueRefs("# Heading\nissue#5")).toBe("# Heading\nissue#5");
  });

  it("marks @mentions but not email addresses", () => {
    expect(linkIssueRefs("@dev can you look?")).toBe("[@dev](#user-dev) can you look?");
    expect(linkIssueRefs("Mail dev@example.com.")).toBe("Mail dev@example.com.");
    expect(linkIssueRefs("Thanks @sam.")).toBe("Thanks [@sam](#user-sam).");
  });
});

describe("matchesQuery", () => {
  it("needs every word, in any order", () => {
    expect(matchesQuery("Go to Mobile", "mob go")).toBe(true);
    expect(matchesQuery("Go to Mobile", "web")).toBe(false);
  });
});

describe("rankIssues", () => {
  const issue = (id: number, subject: string, updated = "2026-11-01T00:00:00Z", closed = false) =>
    ({ id, subject, updated_on: updated, status: { id: 1, name: "S", is_closed: closed } }) as Issue;
  const ids = (list: Issue[]) => list.map((i) => i.id);

  it("puts the issue with that number first, then numbers that start with it", () => {
    const all = [issue(1999, "a"), issue(127, "b"), issue(12, "c"), issue(1, "d"), issue(31, "e"), issue(41, "#1 regression")];
    expect(ids(rankIssues(all, "#1", 10))).toEqual([1, 12, 127, 1999, 41]);
    expect(ids(rankIssues(all, "12", 10))).toEqual([12, 127]);
  });

  it("prefers subjects that start with the words, then open and recent issues", () => {
    const all = [
      issue(1, "Fix the sign-in form", "2026-11-05T00:00:00Z"),
      issue(2, "Sign-in form crashes", "2026-11-01T00:00:00Z"),
      issue(3, "Redesign sign-in", "2026-11-09T00:00:00Z"),
      issue(4, "Sign-in form, old", "2026-11-09T00:00:00Z", true),
      issue(5, "Unrelated"),
    ];
    expect(ids(rankIssues(all, "sign-in form", 10))).toEqual([2, 4, 1]);
    expect(ids(rankIssues(all, "sign", 10))).toEqual([2, 4, 3, 1]);
    expect(ids(rankIssues(all, "sign", 2))).toEqual([2, 4]);
    expect(rankIssues(all, "  ", 10)).toEqual([]);
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

  it("counts a long sync's progress", () => {
    expect(syncLabel("syncing", null, null, now)).toBe("Syncing…");
    expect(syncLabel("syncing", null, null, now, { fetched: 1200, total: 5000 })).toBe(
      `Syncing ${(1200).toLocaleString()} of ${(5000).toLocaleString()} issues`,
    );
    // Progress left over from a finished sync isn't shown.
    expect(syncLabel("idle", null, now - 10_000, now, { fetched: 5000, total: 5000 })).toBe("Synced just now");
  });
});
