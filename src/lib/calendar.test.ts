import { addMonths, cycleEnds, firstWeekday, monthTitle, monthWeeks, placeWeek, weekday } from "./calendar";
import { dayDate, dayNumber } from "./timeline";

describe("calendar weeks", () => {
  it("knows the weekday of a day", () => {
    expect(weekday(dayNumber("2026-11-09"))).toBe(1);
    expect(weekday(dayNumber("2026-11-08"))).toBe(0);
  });

  it("covers a month in whole weeks starting on the locale's first day", () => {
    const nov = { year: 2026, month: 10 };
    const monday = monthWeeks(nov, 1);
    expect(dayDate(monday[0]![0]!)).toBe("2026-10-26");
    expect(dayDate(monday.at(-1)!.at(-1)!)).toBe("2026-12-06");
    expect(monday.every((w) => w.length === 7)).toBe(true);
    const sunday = monthWeeks(nov, 0);
    expect(dayDate(sunday[0]![0]!)).toBe("2026-11-01");
  });

  it("steps across years", () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(monthTitle({ year: 2026, month: 10 }, "en-US")).toBe("November 2026");
  });

  it("reads the first day of the week from the locale", () => {
    expect([0, 1, 6]).toContain(firstWeekday("en-US"));
    expect(firstWeekday("not a locale!")).toBe(1);
  });
});

describe("placing issues in a week", () => {
  const week = Array.from({ length: 7 }, (_, i) => 100 + i);
  const at = (id: number, start: number, end: number) => ({ item: id, span: { start, end, partial: false } });

  it("stacks overlapping issues and reuses free lanes", () => {
    const placed = placeWeek(week, [at(1, 100, 103), at(2, 101, 102), at(3, 104, 106), at(4, 90, 95)]);
    expect(placed.map((p) => [p.item, p.from, p.to, p.lane])).toEqual([
      [1, 0, 3, 0],
      [2, 1, 2, 1],
      [3, 4, 6, 0],
    ]);
  });

  it("marks spans that carry on into the weeks around", () => {
    const [p] = placeWeek(week, [at(1, 98, 110)]);
    expect(p).toMatchObject({ from: 0, to: 6, before: true, after: true });
  });

  it("collects cycles by their due day", () => {
    const ends = cycleEnds([
      { id: 1, name: "Sprint 1", due_date: "2026-11-16" },
      { id: 2, name: "Sprint 2", due_date: "2026-11-16" },
      { id: 3, name: "Someday", due_date: null },
    ]);
    expect(ends.get(dayNumber("2026-11-16"))).toEqual(["Sprint 1", "Sprint 2"]);
    expect(ends.size).toBe(1);
  });
});
