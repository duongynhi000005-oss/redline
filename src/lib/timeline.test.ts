import type { Issue, Relation } from "./types";
import { dateChanges, dayDate, dayNumber, dependencies, draggedSpan, issueSpan, ticks, timelineRange } from "./timeline";

const dated = (start_date: string | null, due_date: string | null) => ({ start_date, due_date }) as Issue;

describe("timeline dates", () => {
  it("turns dates into whole days and back", () => {
    expect(dayDate(dayNumber("2026-11-09"))).toBe("2026-11-09");
    expect(dayNumber("2026-11-10") - dayNumber("2026-11-09")).toBe(1);
  });

  it("spans an issue from its start to its due date", () => {
    expect(issueSpan(dated(null, null))).toBeNull();
    expect(issueSpan(dated("2026-11-02", "2026-11-06"))).toEqual({
      start: dayNumber("2026-11-02"),
      end: dayNumber("2026-11-06"),
      partial: false,
    });
    expect(issueSpan(dated(null, "2026-11-06"))).toMatchObject({ start: dayNumber("2026-11-06"), partial: true });
    expect(issueSpan(dated("2026-11-02", null))).toMatchObject({ end: dayNumber("2026-11-02"), partial: true });
  });

  it("covers every issue and today, starting on a Monday", () => {
    const now = dayNumber("2026-11-09");
    const range = timelineRange([dated("2026-12-01", "2026-12-20")], now, "week");
    expect(new Date(`${dayDate(range.start)}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(range.start).toBeLessThanOrEqual(now - 21);
    expect(range.end).toBe(dayNumber("2026-12-20") + 21);
  });

  it("moves and resizes without turning a bar inside out", () => {
    const span = { start: 10, end: 14, partial: false };
    expect(draggedSpan(span, "move", 3)).toEqual({ start: 13, end: 17 });
    expect(draggedSpan(span, "start", 9)).toEqual({ start: 14, end: 14 });
    expect(draggedSpan(span, "end", -9)).toEqual({ start: 10, end: 10 });
  });

  it("keeps an issue with only a due date that way when moved", () => {
    const issue = dated(null, "2026-11-06");
    const span = issueSpan(issue)!;
    expect(dateChanges(issue, draggedSpan(span, "move", 2), "move")).toEqual({ due_date: "2026-11-08" });
    expect(dateChanges(issue, draggedSpan(span, "start", -3), "start")).toEqual({ start_date: "2026-11-03" });
  });

  it("only sends the dates that changed", () => {
    const issue = dated("2026-11-02", "2026-11-06");
    const span = issueSpan(issue)!;
    expect(dateChanges(issue, draggedSpan(span, "end", 1), "end")).toEqual({ due_date: "2026-11-07" });
    expect(dateChanges(issue, draggedSpan(span, "move", 0), "move")).toEqual({});
  });

  it("labels weeks at month zoom and months at quarter zoom", () => {
    const range = { start: dayNumber("2026-11-02"), end: dayNumber("2027-01-31") };
    const weeks = ticks(range, "month", "en-US");
    expect(weeks[0]).toEqual({ day: range.start, label: "Nov 2", major: false });
    expect(weeks.every((t) => new Date(`${dayDate(t.day)}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    const months = ticks(range, "quarter", "en-US").map((t) => t.label);
    expect(months).toEqual(["Dec", "Jan 2027"]);
  });
});

describe("timeline dependencies", () => {
  const rel = (id: number, issue_id: number, issue_to_id: number, relation_type: Relation["relation_type"]): Relation => ({
    id,
    issue_id,
    issue_to_id,
    relation_type,
    delay: null,
  });

  it("draws each relation once, the earlier issue first", () => {
    const precedes = rel(1, 1, 2, "precedes");
    const blocked = rel(2, 3, 4, "blocked");
    const issues = [
      { id: 1, relations: [precedes] },
      { id: 2, relations: [precedes] },
      { id: 3, relations: [blocked, rel(3, 3, 5, "relates")] },
    ] as Issue[];
    expect(dependencies(issues)).toEqual([
      { from: 1, to: 2, kind: "precedes" },
      { from: 4, to: 3, kind: "blocks" },
    ]);
  });
});
