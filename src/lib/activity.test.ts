import { afterEach, beforeEach, vi } from "vitest";
import {
  activitySource,
  activityWindow,
  earlierWindow,
  fileEvents,
  groupByDay,
  issueEvents,
  newsEvents,
  timeEvents,
  MAX_ISSUES,
  wikiEvents,
} from "./activity";
import { createDemoBackend, demoIssues } from "./demoBackend";
import type { Issue, Journal, Metadata, TimeEntry } from "./types";

const meta = {
  statuses: [
    { id: 1, name: "New", is_closed: false },
    { id: 2, name: "In Progress", is_closed: false },
    { id: 5, name: "Closed", is_closed: true },
  ],
  priorities: [],
  trackers: [],
  projects: [],
  versions: [],
  memberships: [],
} as unknown as Metadata;

const w = activityWindow(new Date(2026, 10, 9, 15), 14);
const at = (day: number, hour = 10) => new Date(2026, 10, day, hour).toISOString();

const issue = (id: number, created: string, updated: string): Issue =>
  ({
    id,
    project: { id: 1, name: "Web" },
    subject: `Issue ${id}`,
    author: { id: 2, name: "Sam" },
    created_on: created,
    updated_on: updated,
  }) as Issue;

const journal = (id: number, created: string, rest: Partial<Journal>): Journal => ({
  id,
  created_on: created,
  private_notes: false,
  details: [],
  user: { id: 1, name: "Dana" },
  ...rest,
});

describe("activity windows", () => {
  it("covers whole local days, and earlier windows meet the one after", () => {
    expect(new Date(w.from)).toEqual(new Date(2026, 9, 27));
    expect(new Date(w.until)).toEqual(new Date(2026, 10, 10));
    const before = earlierWindow(w, 14);
    expect(new Date(before.from)).toEqual(new Date(2026, 9, 13));
    expect(before.until).toBe(w.from);
  });
});

describe("issue events", () => {
  it("reads creations, comments, closes and changes in the window, and nothing else", () => {
    const issues = [issue(1, at(3), at(8)), issue(2, at(1, 9), at(9))];
    const journals = new Map<number, Journal[]>([
      [
        1,
        [
          journal(10, at(4), { notes: "Looks good" }),
          journal(11, at(5), { details: [{ property: "attr", name: "status_id", old_value: "2", new_value: "5" }] }),
          journal(12, at(6), { details: [{ property: "attr", name: "status_id", old_value: "1", new_value: "2" }] }),
          // Says nothing.
          journal(13, at(7), { details: [{ property: "attr", name: "status_id", old_value: "1", new_value: "1" }] }),
          // Before the window.
          journal(14, new Date(2026, 9, 20).toISOString(), { notes: "Old" }),
        ],
      ],
      [2, [journal(20, at(9), { notes: "", details: [{ property: "attr", name: "status_id", old_value: "5", new_value: "2" }] })]],
    ]);
    const events = issueEvents(issues, journals, meta, w);
    expect(events.map((e) => `${e.key} ${e.author?.name} ${e.verb} ${e.subject}`)).toEqual([
      "issue:1 Sam created #1 Issue 1",
      "journal:10 Dana commented on #1 Issue 1",
      "journal:11 Dana closed #1 Issue 1",
      "journal:12 Dana updated #1 Issue 1",
      "issue:2 Sam created #2 Issue 2",
      "journal:20 Dana reopened #2 Issue 2",
    ]);
    expect(events[2]!.changes).toEqual(["changed status from In Progress to Closed"]);
    expect(events[1]!.text).toBe("Looks good");
    expect(events[1]!.target).toEqual({ type: "issue", id: 1 });
  });
});

describe("other events", () => {
  it("puts logged time on the day it was spent, with a time only when logged that day", () => {
    const entries = [
      { id: 1, project: { id: 1, name: "Web" }, issue: { id: 1 }, user: { id: 1, name: "Dana" }, activity: { id: 9, name: "Dev" }, hours: 1.5, spent_on: "2026-11-08", created_on: at(8, 17) },
      { id: 2, project: { id: 3, name: "Design" }, issue: null, user: { id: 2, name: "Sam" }, activity: { id: 9, name: "Dev" }, hours: 2, spent_on: "2026-11-02", created_on: at(4), comments: "Icons" },
      { id: 3, project: { id: 1, name: "Web" }, user: { id: 2, name: "Sam" }, activity: { id: 9, name: "Dev" }, hours: 1, spent_on: "2026-10-20" },
    ] as TimeEntry[];
    const issues = new Map([[1, issue(1, at(1), at(2))]]);
    const events = timeEvents(entries, issues, w);
    expect(events.map((e) => [e.day, e.verb, e.subject, !!e.untimed])).toEqual([
      ["2026-11-08", "logged 1h 30m on", "#1 Issue 1", false],
      ["2026-11-02", "logged 2h on", "Design", true],
    ]);
    expect(events[1]!.target).toEqual({ type: "time", projectId: 3 });
    expect(events[1]!.text).toBe("Icons");
  });

  it("reads wiki edits, news and files in the window", () => {
    const wiki = wikiEvents(
      1,
      [
        { title: "Release_checklist", version: 3, updated_on: at(6), author: { id: 1, name: "Dana" }, comments: "Add Windows" },
        { title: "Getting_started", version: 1, updated_on: at(7), author: { id: 2, name: "Sam" } },
        { title: "Old", version: 2, updated_on: new Date(2026, 8, 1).toISOString() },
      ],
      w,
    );
    expect(wiki.map((e) => `${e.verb} ${e.subject}`)).toEqual(["edited the page Release checklist", "created the page Getting started"]);
    expect(wiki[0]!.target).toEqual({ type: "wiki", projectId: 1, title: "Release_checklist" });

    const news = newsEvents([{ id: 4, project: { id: 2, name: "Mobile" }, title: "Beta", summary: "Monday", created_on: at(5), comments: [], attachments: [] }], w);
    expect(news.map((e) => [e.projectId, e.verb, e.subject, e.text])).toEqual([[2, "posted", "Beta", "Monday"]]);

    const files = fileEvents(
      1,
      [
        { id: 7, filename: "notes.txt", filesize: 1, created_on: at(3), version: { id: 2, name: "Sprint 2" }, downloads: 0 },
        { id: 8, filename: "colors.txt", filesize: 1, created_on: at(4), version: null, downloads: 0 },
      ],
      w,
    );
    expect(files.map((e) => `${e.verb} ${e.subject}`)).toEqual(["added a file to Sprint 2: notes.txt", "added a file: colors.txt"]);
  });

  it("groups by day, newest first", () => {
    const events = [...newsEvents([{ id: 1, project: { id: 1, name: "Web" }, title: "A", created_on: at(3, 9), comments: [], attachments: [] }], w)];
    events.push({ ...events[0]!, key: "b", at: at(5, 8), day: "2026-11-05" }, { ...events[0]!, key: "c", at: at(5, 18), day: "2026-11-05" });
    expect(groupByDay(events).map((g) => [g.day, g.events.map((e) => e.key)])).toEqual([
      ["2026-11-05", ["c", "b"]],
      ["2026-11-03", ["news:1"]],
    ]);
  });
});

describe("activity source", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 9, 15));
  });
  afterEach(() => vi.useRealTimers());

  it("gathers a team's activity from every area and reads whole lists once", async () => {
    const backend = createDemoBackend({ signedIn: true });
    const wikiIndex = vi.spyOn(backend, "wikiIndex");
    const journals = vi.spyOn(backend, "issueJournals");
    const meta = await backend.getMetadata();
    const issues = new Map(demoIssues().map((i) => [i.id, i]));
    const source = activitySource(backend, meta, 1, [1, 3]);
    expect(source.kinds).toEqual(["issues", "time", "wiki", "news", "files"]);

    const page = await source.load(activityWindow(new Date(), 14), issues);
    const kinds = new Set(page.events.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(["files", "issues", "news", "time", "wiki"]);
    // Only Web and its sub-team: Mobile's news isn't here.
    expect(page.events.every((e) => [1, 3].includes(e.projectId))).toBe(true);
    const from = Date.parse(activityWindow(new Date(), 14).from);
    const changed = [...issues.values()].filter((i) => [1, 3].includes(i.project.id) && Date.parse(i.updated_on) >= from);
    expect(page.capped).toBe(changed.length > MAX_ISSUES);

    await source.load(earlierWindow(activityWindow(new Date(), 14), 14), issues);
    expect(wikiIndex).toHaveBeenCalledTimes(1);
    // Journals are only asked for issues changed in the window, the most recent first, a few at a time.
    const asked = journals.mock.calls[0]![0];
    expect(asked.length).toBeLessThanOrEqual(MAX_ISSUES);
    expect(asked.every((id) => Date.parse(issues.get(id)!.updated_on) >= from)).toBe(true);
    // An earlier window doesn't ask again for issues already read.
    const again = journals.mock.calls[1]?.[0] ?? [];
    expect(again.some((id) => asked.includes(id))).toBe(false);
  });

  it("offers only what the role may see", async () => {
    const backend = createDemoBackend({ signedIn: true });
    const meta = await backend.getMetadata();
    // In Mobile, Dana is a Developer and only news and time are on.
    expect(activitySource(backend, meta, 2, [2]).kinds).toEqual(["issues", "time", "news"]);
  });
});
