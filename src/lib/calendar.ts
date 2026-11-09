import type { Span } from "./timeline";
import { dayDate, dayNumber } from "./timeline";

// The calendar layout: a month of weeks, with each issue drawn across the
// days from its start date to its due date, like Redmine's calendar. Days
// are whole UTC days, as on the timeline.

export interface Month {
  year: number;
  /** 0 for January. */
  month: number;
}

/** The weekday a week starts on in the person's locale, 0 for Sunday, falling back to Monday. */
export function firstWeekday(locale?: string): number {
  try {
    const loc = new Intl.Locale(locale ?? navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay;
    // Intl numbers Monday 1 to Sunday 7.
    if (first) return first % 7;
  } catch {
    // An unknown locale gets the default.
  }
  return 1;
}

export function monthOf(day: number): Month {
  const date = new Date(`${dayDate(day)}T00:00:00Z`);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

export function addMonths(m: Month, n: number): Month {
  const total = m.year * 12 + m.month + n;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function firstDayOf(m: Month): number {
  return Math.round(Date.UTC(m.year, m.month, 1) / 86_400_000);
}

/** The weekday of a day number, 0 for Sunday. */
export function weekday(day: number): number {
  // 1970-01-01 was a Thursday.
  return (((day + 4) % 7) + 7) % 7;
}

/** The weeks shown for a month: whole weeks from the one holding the 1st to the one holding the last day. */
export function monthWeeks(m: Month, firstDay: number): number[][] {
  const first = firstDayOf(m);
  const last = firstDayOf(addMonths(m, 1)) - 1;
  let start = first - ((weekday(first) - firstDay + 7) % 7);
  const weeks: number[][] = [];
  while (start <= last) {
    weeks.push(Array.from({ length: 7 }, (_, i) => start + i));
    start += 7;
  }
  return weeks;
}

export interface Placed<T> {
  item: T;
  /** Columns 0 to 6 within the week, inclusive. */
  from: number;
  to: number;
  lane: number;
  /** The span carries on before or after this week. */
  before: boolean;
  after: boolean;
}

/**
 * Lays out spans across one week: each gets the first lane free for all of
 * its days, so overlapping issues stack and later ones fill the gaps.
 */
export function placeWeek<T>(week: number[], items: { item: T; span: Span }[]): Placed<T>[] {
  const first = week[0]!;
  const last = week[week.length - 1]!;
  const inWeek = items.filter(({ span }) => span.end >= first && span.start <= last);
  // Earlier first, then longer first, so long spans keep the top lanes.
  inWeek.sort((a, b) => a.span.start - b.span.start || b.span.end - b.span.start - (a.span.end - a.span.start));
  const lanes: boolean[][] = [];
  return inWeek.map(({ item, span }) => {
    const from = Math.max(span.start, first) - first;
    const to = Math.min(span.end, last) - first;
    let lane = 0;
    for (; ; lane++) {
      const used = (lanes[lane] ??= Array(7).fill(false) as boolean[]);
      if (used.slice(from, to + 1).every((u) => !u)) {
        used.fill(true, from, to + 1);
        break;
      }
    }
    return {
      item,
      from,
      to,
      lane,
      before: span.start < first,
      after: span.end > last,
    };
  });
}

/** A month's name and year, as the calendar's title. */
export function monthTitle(m: Month, locale?: string): string {
  return new Date(Date.UTC(m.year, m.month, 1)).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The cycles that end on each day, from their due dates. */
export function cycleEnds(versions: { id: number; name: string; due_date?: string | null }[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const v of versions) {
    if (!v.due_date) continue;
    const day = dayNumber(v.due_date);
    out.set(day, [...(out.get(day) ?? []), v.name]);
  }
  return out;
}
