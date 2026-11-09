import type { Issue } from "./types";
import type { Zoom } from "./views";

// The timeline (Gantt) layout: issues as bars from their start date to their
// due date. Redmine has no API for its Gantt chart, so it's drawn here from
// the issues' dates. Dates are Redmine's YYYY-MM-DD, handled as whole days
// in UTC so time zones never shift a bar.

const DAY_MS = 86_400_000;

/** Pixels per day at each zoom. */
export const DAY_WIDTH: Record<Zoom, number> = { week: 36, month: 14, quarter: 5 };

/** Days since 1970-01-01 for a YYYY-MM-DD date. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / DAY_MS);
}

/** The YYYY-MM-DD date of a day number. */
export function dayDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Today, as a day number in the person's own time zone. */
export function today(now = new Date()): number {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

export interface Span {
  start: number;
  /** Inclusive: a one-day issue starts and ends on the same day. */
  end: number;
  /** Only one of the two dates is set, so the bar is a single day. */
  partial: boolean;
}

/** Where an issue sits in time, or null when it has neither date. */
export function issueSpan(issue: Pick<Issue, "start_date" | "due_date">): Span | null {
  const start = issue.start_date ? dayNumber(issue.start_date) : null;
  const due = issue.due_date ? dayNumber(issue.due_date) : null;
  if (start === null && due === null) return null;
  if (start === null) return { start: due!, end: due!, partial: true };
  if (due === null) return { start, end: start, partial: true };
  return { start: Math.min(start, due), end: Math.max(start, due), partial: false };
}

/**
 * The days a timeline covers: every dated issue and today, with room on
 * either side to drag into. Always starts on a Monday.
 */
export function timelineRange(issues: Iterable<Issue>, now: number, zoom: Zoom): { start: number; end: number } {
  let lo = now;
  let hi = now;
  for (const issue of issues) {
    const span = issueSpan(issue);
    if (!span) continue;
    lo = Math.min(lo, span.start);
    hi = Math.max(hi, span.end);
  }
  const pad = { week: 21, month: 60, quarter: 180 }[zoom];
  let start = lo - pad;
  // 1970-01-01 was a Thursday; day 4 is a Monday.
  start -= (((start - 4) % 7) + 7) % 7;
  return { start, end: hi + pad };
}

export type DragMode = "move" | "start" | "end";

/** The dates after dragging a bar by `days`: moving keeps its length, the ends resize it. */
export function draggedSpan(span: Span, mode: DragMode, days: number): { start: number; end: number } {
  switch (mode) {
    case "move":
      return { start: span.start + days, end: span.end + days };
    case "start":
      return { start: Math.min(span.start + days, span.end), end: span.end };
    case "end":
      return { start: span.start, end: Math.max(span.end + days, span.start) };
  }
}

/**
 * The fields to send for new dates. An issue with only a due date keeps
 * having only a due date when moved, and likewise for a start date; resizing
 * one sets both.
 */
export function dateChanges(
  issue: Pick<Issue, "start_date" | "due_date">,
  next: { start: number; end: number },
  mode: DragMode,
): { start_date?: string; due_date?: string } {
  const start = dayDate(next.start);
  const end = dayDate(next.end);
  const out: { start_date?: string; due_date?: string } = {};
  const onlyDue = !issue.start_date && !!issue.due_date;
  const onlyStart = !!issue.start_date && !issue.due_date;
  if (mode === "move" && onlyDue) return end !== issue.due_date ? { due_date: end } : {};
  if (mode === "move" && onlyStart) return start !== issue.start_date ? { start_date: start } : {};
  if (start !== issue.start_date) out.start_date = start;
  if (end !== issue.due_date) out.due_date = end;
  return out;
}

export interface Tick {
  day: number;
  label: string;
  /** Starts a new month (or year at the widest zoom), drawn stronger. */
  major: boolean;
}

/** Labels along the top: days at week zoom, weeks at month zoom, months at quarter zoom. */
export function ticks(range: { start: number; end: number }, zoom: Zoom, locale?: string): Tick[] {
  const out: Tick[] = [];
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  for (let day = range.start; day <= range.end; day++) {
    const date = new Date(day * DAY_MS);
    const first = date.getUTCDate() === 1;
    if (zoom === "week") {
      out.push({ day, label: first ? `${month.format(date)} ${date.getUTCDate()}` : String(date.getUTCDate()), major: first });
    } else if (zoom === "month") {
      if (date.getUTCDay() === 1) out.push({ day, label: `${month.format(date)} ${date.getUTCDate()}`, major: false });
    } else if (first) {
      const january = date.getUTCMonth() === 0;
      out.push({ day, label: january ? `${month.format(date)} ${date.getUTCFullYear()}` : month.format(date), major: january });
    }
  }
  return out;
}

/** Relations drawn as arrows: the first issue has to finish before the second. */
export function dependencies(issues: Iterable<Issue>): { from: number; to: number; kind: "precedes" | "blocks" }[] {
  const seen = new Set<number>();
  const out: { from: number; to: number; kind: "precedes" | "blocks" }[] = [];
  for (const issue of issues) {
    for (const r of issue.relations ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (r.relation_type === "precedes" || r.relation_type === "blocks") out.push({ from: r.issue_id, to: r.issue_to_id, kind: r.relation_type });
      else if (r.relation_type === "follows") out.push({ from: r.issue_to_id, to: r.issue_id, kind: "precedes" });
      else if (r.relation_type === "blocked") out.push({ from: r.issue_to_id, to: r.issue_id, kind: "blocks" });
    }
  }
  return out;
}
