import { createDemoBackend } from "./demoBackend";
import { itemsFrom, mergeItems } from "./inbox";

describe("inbox", () => {
  it("keeps other people's changes since the inbox started, not mine", async () => {
    const backend = createDemoBackend({ signedIn: true });
    const meta = await backend.getMetadata();
    const details = await backend.getIssueDetails(1);
    const items = itemsFrom(details, 1, "2026-10-01T00:00:00Z", meta);
    expect(items.map((i) => [i.actor, i.summary])).toEqual([
      ["Sam Teammate", "created an issue assigned to you"],
      ["Sam Teammate", "changed status from New to New"],
    ]);
    expect(itemsFrom(details, 1, "2026-12-01T00:00:00Z", meta)).toEqual([]);
  });

  it("merges without duplicates, newest first", () => {
    const item = (key: string, at: string) => ({
      key,
      issueId: 1,
      subject: "s",
      at,
      actor: "Sam",
      summary: "commented",
      comment: null,
      read: false,
    });
    const inbox = { since: "2026-01-01T00:00:00Z", items: [item("j1", "2026-11-01T00:00:00Z")] };
    const merged = mergeItems(inbox, [item("j1", "2026-11-01T00:00:00Z"), item("j2", "2026-11-02T00:00:00Z")]);
    expect(merged.items.map((i) => i.key)).toEqual(["j2", "j1"]);
    expect(mergeItems(merged, [item("j2", "2026-11-02T00:00:00Z")])).toBe(merged);
  });
});
