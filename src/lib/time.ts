import type { TimeEntry } from "./types";

// Logged time: reading what people type, showing hours, and the ranges and
// groupings of the Time view.

/**
 * Hours from what people type: "1.5", "1,5", "1:30", "1h 30m", "90m",
 * "2h". Null when it isn't a positive amount of time.
 */
export function parseHours(text: string): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  const clock = t.match(/^(\d+):([0-5]?\d)$/);
  const units = t.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?|s)?)?)?$/);
  let hours: number | null = null;
  if (clock) hours = Number(clock[1]) + Number(clock[2]) / 60;
  else if (units && (units[1] || units[2])) hours = Number(units[1] ?? 0) + Number(units[2] ?? 0) / 60;
  else if (/^\d+(?:\.\d+)?$/.test(t)) hours = Number(t);
  if (hours === null || !Number.isFinite(hours) || hours <= 0) return null;
  return Math.round(hours * 100) / 100;
}

/** "1h 30m", "45m", "8h". */
export function formatHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** A local day as YYYY-MM-DD. */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export type TimeRange = "this-week" | "last-week" | "this-month" | "last-30";

export const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "this-week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "this-month", label: "This month" },
  { value: "last-30", label: "Last 30 days" },
];

/** The first and last day of a range, weeks starting on `firstDay` (0 is Sunday). */
export function rangeDays(range: TimeRange, today: Date, firstDay = 1): { from: string; to: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const back = (start.getDay() - firstDay + 7) % 7;
  const weekStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - back);
  const plus = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  switch (range) {
    case "this-week":
      return { from: isoDay(weekStart), to: isoDay(plus(weekStart, 6)) };
    case "last-week":
      return { from: isoDay(plus(weekStart, -7)), to: isoDay(plus(weekStart, -1)) };
    case "this-month":
      return {
        from: isoDay(new Date(start.getFullYear(), start.getMonth(), 1)),
        to: isoDay(new Date(start.getFullYear(), start.getMonth() + 1, 0)),
      };
    case "last-30":
      return { from: isoDay(plus(start, -29)), to: isoDay(start) };
  }
}

export type TimeGrouping = "day" | "person" | "issue";

export interface TimeGroup {
  key: string;
  label: string;
  hours: number;
  entries: TimeEntry[];
}

/** "Today", "Yesterday", "Mon, Nov 3". */
export function dayLabel(day: string, today: Date): string {
  const t = isoDay(today);
  const y = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  if (day === t) return "Today";
  if (day === y) return "Yesterday";
  return parseDay(day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: day.slice(0, 4) === t.slice(0, 4) ? undefined : "numeric",
  });
}

/**
 * Entries in groups with totals: days newest first, people and issues by
 * most time first. Entries keep the order they came in (newest first).
 */
export function groupTime(entries: TimeEntry[], by: TimeGrouping, today: Date, issueTitle: (id: number) => string): TimeGroup[] {
  const groups = new Map<string, TimeGroup>();
  for (const e of entries) {
    const [key, label] =
      by === "day"
        ? [e.spent_on, dayLabel(e.spent_on, today)]
        : by === "person"
          ? [`user:${e.user.id}`, e.user.name]
          : e.issue
            ? [`issue:${e.issue.id}`, issueTitle(e.issue.id)]
            : [`project:${e.project.id}`, `${e.project.name}, no issue`];
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { key, label, hours: 0, entries: [] }));
    group.hours += e.hours;
    group.entries.push(e);
  }
  const list = [...groups.values()];
  return by === "day"
    ? list.sort((a, b) => b.key.localeCompare(a.key))
    : list.sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label));
}

export function totalHours(entries: TimeEntry[]): number {
  return entries.reduce((sum, e) => sum + e.hours, 0);
}
