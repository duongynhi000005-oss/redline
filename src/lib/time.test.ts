import type { TimeEntry } from "./types";
import { dayLabel, formatHours, groupTime, parseHours, rangeDays, totalHours } from "./time";

describe("parseHours", () => {
  it.each([
    ["1.5", 1.5],
    ["1,5", 1.5],
    ["1:30", 1.5],
    ["0:45", 0.75],
    ["1h 30m", 1.5],
    ["1h30m", 1.5],
    ["2 hours", 2],
    ["90m", 1.5],
    ["45 min", 0.75],
    ["2h", 2],
    ["8", 8],
  ])("reads %s", (text, hours) => expect(parseHours(text)).toBe(hours));

  it.each(["", "abc", "0", "-1", "1:75", "h", "1.5.2"])("rejects %j", (text) => expect(parseHours(text)).toBeNull());
});

describe("formatHours", () => {
  it.each([
    [1.5, "1h 30m"],
    [0.75, "45m"],
    [8, "8h"],
    [0.1, "6m"],
    [2.999, "3h"],
  ])("shows %s as %s", (hours, text) => expect(formatHours(hours)).toBe(text));
});

describe("rangeDays", () => {
  // Wednesday, November 12, 2026.
  const today = new Date(2026, 10, 12, 15, 30);

  it("gives the week from Monday, or Sunday where weeks start then", () => {
    expect(rangeDays("this-week", today)).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(rangeDays("this-week", today, 0)).toEqual({ from: "2026-11-08", to: "2026-11-14" });
    expect(rangeDays("last-week", today)).toEqual({ from: "2026-11-02", to: "2026-11-08" });
  });

  it("gives the month and the last 30 days", () => {
    expect(rangeDays("this-month", today)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(rangeDays("last-30", today)).toEqual({ from: "2026-10-14", to: "2026-11-12" });
  });
});

describe("groupTime", () => {
  const today = new Date(2026, 10, 12);
  const entry = (id: number, user: number, issue: number | null, day: string, hours: number): TimeEntry => ({
    id,
    project: { id: 1, name: "Web" },
    issue: issue ? { id: issue } : null,
    user: { id: user, name: user === 1 ? "Dana" : "Sam" },
    activity: { id: 9, name: "Development" },
    hours,
    spent_on: day,
  });
  const entries = [
    entry(4, 1, 3, "2026-11-12", 1),
    entry(3, 2, null, "2026-11-11", 2),
    entry(2, 1, 3, "2026-11-11", 0.5),
    entry(1, 2, 4, "2026-11-03", 4),
  ];
  const title = (id: number) => `#${id}`;

  it("groups by day, newest first, with names people read", () => {
    const groups = groupTime(entries, "day", today, title);
    expect(groups.map((g) => [g.label, g.hours])).toEqual([
      ["Today", 1],
      ["Yesterday", 2.5],
      [dayLabel("2026-11-03", today), 4],
    ]);
  });

  it("groups by person and by issue, most time first", () => {
    expect(groupTime(entries, "person", today, title).map((g) => [g.label, g.hours])).toEqual([
      ["Sam", 6],
      ["Dana", 1.5],
    ]);
    expect(groupTime(entries, "issue", today, title).map((g) => [g.label, g.hours])).toEqual([
      ["#4", 4],
      ["Web, no issue", 2],
      ["#3", 1.5],
    ]);
    expect(totalHours(entries)).toBe(7.5);
  });
});
