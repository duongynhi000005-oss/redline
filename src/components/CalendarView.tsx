import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Month, Placed } from "../lib/calendar";
import { addMonths, cycleEnds, firstWeekday, monthOf, monthTitle, monthWeeks, placeWeek } from "../lib/calendar";
import { issueCategory } from "../lib/model";
import { isTyping } from "../lib/platform";
import type { Span } from "../lib/timeline";
import { dateChanges, dayDate, draggedSpan, issueSpan, today } from "../lib/timeline";
import type { Issue } from "../lib/types";
import type { ViewOptions } from "../lib/views";
import { compareBy } from "../lib/views";
import type { Route } from "../state/app";
import { overlayOpen, useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { spokenIssue } from "./IssueList";
import { spanLabel } from "./TimelineView";
import { Icon, StatusIcon } from "./icons";

const DAY_HEAD = 28;
const LANE = 22;
const MORE = 18;
const DRAG_THRESHOLD = 4;

interface Drag {
  id: number;
  /** Where the pointer went down, and on which day. */
  x: number;
  y: number;
  from: number | null;
  over: number | null;
  moved: boolean;
}

function dayFromPoint(x: number, y: number): number | null {
  const el = document.elementFromPoint?.(x, y)?.closest<HTMLElement>("[data-day]");
  return el ? Number(el.dataset.day) : null;
}

function fullDate(day: number) {
  return new Date(`${dayDate(day)}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function CalendarView({ issues, view, route }: { issues: Issue[]; view: ViewOptions; route: Route }) {
  const d = useDerived();
  const meta = useApp((s) => s.meta);
  const overlay = useApp(overlayOpen);
  const openIssue = useApp((s) => s.openIssue);
  const updateIssue = useApp((s) => s.updateIssue);
  const focusedId = useApp((s) => s.focusedIssueId);
  const focusIssue = useApp((s) => s.focusIssue);
  const now = today();
  const [month, setMonth] = useState<Month>(() => monthOf(now));
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [more, setMore] = useState<number | null>(null);
  const weeksRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(0);

  const firstDay = useMemo(() => firstWeekday(), []);
  const weeks = useMemo(() => monthWeeks(month, firstDay), [month, firstDay]);
  const inMonth = (day: number) => {
    const m = monthOf(day);
    return m.year === month.year && m.month === month.month;
  };

  // Weeks share the height; each fits as many lanes as it has room for.
  useLayoutEffect(() => {
    const el = weeksRef.current;
    if (!el) return;
    const measure = () => setRowHeight(el.clientHeight / weeks.length);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [weeks.length]);
  const maxLanes = Math.max(2, Math.floor((rowHeight - DAY_HEAD - MORE) / LANE));

  const compare = useMemo(() => compareBy(view.ordering, d), [view.ordering, d]);
  const sorted = useMemo(() => [...issues].sort(compare), [issues, compare]);
  const undated = sorted.filter((i) => !issueSpan(i));

  /** The span an issue shows, with a drag in progress applied. */
  const shownSpan = (issue: Issue): Span | null => {
    const span = issueSpan(issue);
    if (!drag?.moved || drag.id !== issue.id || drag.over === null) return span;
    if (!span) return { start: drag.over, end: drag.over, partial: true };
    if (drag.from === null) return span;
    return {
      ...draggedSpan(span, "move", drag.over - drag.from),
      partial: span.partial,
    };
  };

  const spans = sorted.flatMap((issue) => {
    const span = shownSpan(issue);
    return span ? [{ item: issue, span }] : [];
  });
  const placed = weeks.map((week) => placeWeek(week, spans));

  // Issues in the order the keyboard walks them: by first day shown, then lane.
  const order = useMemo(() => {
    const seen = new Set<number>();
    const out: number[] = [];
    placed.forEach((week) =>
      [...week]
        .sort((a, b) => a.from - b.from || a.lane - b.lane)
        .forEach((p) => {
          if (!seen.has(p.item.id)) {
            seen.add(p.item.id);
            out.push(p.item.id);
          }
        }),
    );
    undated.forEach((i) => out.push(i.id));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, month, compare]);

  const versions = useMemo(() => {
    const projects = new Set(issues.map((i) => i.project.id));
    if ("teamId" in route && route.teamId) projects.add(route.teamId);
    return cycleEnds((meta?.versions ?? []).filter((v) => projects.has(v.project.id)));
  }, [issues, meta, route]);

  function move(issue: Issue, days: number) {
    const span = issueSpan(issue);
    if (!span || !days) return;
    const changes = dateChanges(issue, draggedSpan(span, "move", days), "move");
    if (Object.keys(changes).length) void updateIssue(issue.id, changes);
  }

  function schedule(issue: Issue, day: number) {
    void updateIssue(issue.id, { due_date: dayDate(day) });
  }

  function startDrag(e: React.PointerEvent, issue: Issue) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const state: Drag = {
      id: issue.id,
      x: e.clientX,
      y: e.clientY,
      from: dayFromPoint(e.clientX, e.clientY),
      over: null,
      moved: false,
    };
    dragRef.current = state;
    focusIssue(issue.id);
    const onMove = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const moved = cur.moved || Math.hypot(ev.clientX - cur.x, ev.clientY - cur.y) >= DRAG_THRESHOLD;
      if (!moved) return;
      const next = {
        ...cur,
        moved,
        over: dayFromPoint(ev.clientX, ev.clientY) ?? cur.over,
      };
      dragRef.current = next;
      setDrag(next);
    };
    const finish = (cancel: boolean) => {
      const cur = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
      if (!cur?.moved) return;
      suppressClick.current = true;
      if (cancel || cur.over === null) return;
      if (!issueSpan(issue)) schedule(issue, cur.over);
      else if (cur.from !== null) move(issue, cur.over - cur.from);
    };
    const onUp = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        finish(true);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
  }

  const open = (id: number) => {
    if (suppressClick.current) suppressClick.current = false;
    else openIssue(id);
  };

  // A click anywhere else closes a day's list.
  useEffect(() => {
    if (more === null) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest(".calendar-popover, .calendar-more")) setMore(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [more]);

  // Keyboard: ↑/↓ or j/k move between issues, Enter opens, Shift+arrows move
  // the dates a day or a week, Page Up and Page Down change the month.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (overlay || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && more !== null) {
        e.preventDefault();
        setMore(null);
        return;
      }
      if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        setMonth((m) => addMonths(m, e.key === "PageUp" ? -1 : 1));
        return;
      }
      if (!order.length) return;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (e.shiftKey && step !== undefined && focusedId !== null) {
        e.preventDefault();
        const issue = useApp.getState().issues.get(focusedId);
        if (!issue) return;
        if (issueSpan(issue)) move(issue, step);
        else useApp.getState().showToast(`#${issue.id} has no dates yet. Drag it onto a day to set its due date.`);
        return;
      }
      if (e.shiftKey) return;
      const pos = focusedId === null ? -1 : order.indexOf(focusedId);
      let next: number | null = null;
      if (e.key === "ArrowDown" || e.key === "j") next = pos < 0 ? 0 : Math.min(order.length - 1, pos + 1);
      else if (e.key === "ArrowUp" || e.key === "k") next = pos < 0 ? 0 : Math.max(0, pos - 1);
      else if (e.key === "Enter" && focusedId !== null) {
        e.preventDefault();
        openIssue(focusedId);
        return;
      }
      if (next === null) return;
      e.preventDefault();
      if (rootRef.current && !rootRef.current.contains(document.activeElement)) rootRef.current.focus({ preventScroll: true });
      focusIssue(order[next]!);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The first segment of each issue is the one the keyboard and screen readers use.
  const firstSegment = new Set<string>();
  const segmentKey = (week: number, p: Placed<Issue>) => `${week}:${p.item.id}`;
  {
    const seen = new Set<number>();
    placed.forEach((week, w) =>
      [...week]
        .sort((a, b) => a.from - b.from)
        .forEach((p) => {
          if (!seen.has(p.item.id)) {
            seen.add(p.item.id);
            firstSegment.add(segmentKey(w, p));
          }
        }),
    );
  }
  const shownIds = new Set(placed.flatMap((week) => week.filter((p) => p.lane < maxLanes).map((p) => p.item.id)));
  const activeId = focusedId !== null && (shownIds.has(focusedId) || undated.some((i) => i.id === focusedId)) ? focusedId : null;
  const weekdayNames = weeks[0]!.map((day) =>
    new Date(`${dayDate(day)}T00:00:00Z`).toLocaleDateString(undefined, {
      weekday: "short",
      timeZone: "UTC",
    }),
  );

  return (
    <div
      ref={rootRef}
      className={`calendar${drag?.moved ? " dragging" : ""}`}
      role="listbox"
      aria-label="Issues calendar"
      aria-activedescendant={activeId !== null ? `issue-cal-${activeId}` : undefined}
      tabIndex={0}
    >
      <div className="calendar-main">
        <div className="calendar-toolbar">
          <h2 aria-live="polite">{monthTitle(month)}</h2>
          <span className="header-spacer" />
          <button type="button" className="header-button" onClick={() => setMonth(monthOf(now))}>
            Today
          </button>
          <button
            type="button"
            className="header-button icon-only"
            aria-label="Previous month"
            title="Previous month (Page Up)"
            onClick={() => setMonth((m) => addMonths(m, -1))}
          >
            <Icon name="chevron-right" className="flip" />
          </button>
          <button
            type="button"
            className="header-button icon-only"
            aria-label="Next month"
            title="Next month (Page Down)"
            onClick={() => setMonth((m) => addMonths(m, 1))}
          >
            <Icon name="chevron-right" />
          </button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdayNames.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
        <div
          ref={weeksRef}
          className="calendar-weeks"
          style={{
            gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))`,
          }}
        >
          {weeks.map((week, w) => {
            const hidden = new Map<number, number>();
            for (const p of placed[w]!) {
              if (p.lane < maxLanes) continue;
              for (let c = p.from; c <= p.to; c++) hidden.set(c, (hidden.get(c) ?? 0) + 1);
            }
            return (
              <div key={week[0]} className="calendar-week">
                {week.map((day, c) => {
                  const ends = versions.get(day);
                  return (
                    <div
                      key={day}
                      data-day={day}
                      className={`calendar-day${inMonth(day) ? "" : " outside"}${day === now ? " today" : ""}${drag?.moved && drag.over === day ? " drop-over" : ""}`}
                      aria-hidden="true"
                    >
                      <div className="calendar-day-head">
                        <span className="calendar-date">{new Date(`${dayDate(day)}T00:00:00Z`).getUTCDate()}</span>
                        {ends && (
                          <span className="calendar-cycle" title={`${ends.join(", ")} ends`}>
                            <Icon name="cycle" />
                            {ends.join(", ")}
                          </span>
                        )}
                      </div>
                      {hidden.has(c) && (
                        <button
                          type="button"
                          className="calendar-more"
                          style={{ top: DAY_HEAD + maxLanes * LANE }}
                          onClick={() => setMore(more === day ? null : day)}
                        >
                          {hidden.get(c)} more
                        </button>
                      )}
                      {more === day && (
                        <div className="calendar-popover" role="dialog" aria-label={fullDate(day)}>
                          <div className="calendar-popover-title">{fullDate(day)}</div>
                          {placed[w]!.filter((p) => p.from <= c && p.to >= c).map((p) => (
                            <button
                              type="button"
                              key={p.item.id}
                              className="calendar-popover-issue"
                              onClick={() => {
                                setMore(null);
                                openIssue(p.item.id);
                              }}
                            >
                              <StatusIcon category={issueCategory(p.item, d.categories)} title={p.item.status.name} />
                              <span className="issue-id">#{p.item.id}</span>
                              <span>{p.item.subject}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {placed[w]!.filter((p) => p.lane < maxLanes).map((p) => {
                  const issue = p.item;
                  const key = segmentKey(w, p);
                  const primary = firstSegment.has(key);
                  const category = issueCategory(issue, d.categories);
                  const dates = spanLabel(issueSpan(issue), issue);
                  return (
                    <div
                      key={key}
                      {...(primary
                        ? {
                            id: `issue-cal-${issue.id}`,
                            role: "option",
                            "aria-selected": issue.id === focusedId,
                            "aria-label": `${spokenIssue(issue, d, route.view !== "cycle")}. ${dates}.`,
                          }
                        : { "aria-hidden": true })}
                      className={`calendar-bar cat-${category}${p.before ? " before" : ""}${p.after ? " after" : ""}${issue.id === focusedId ? " focused" : ""}${issue.status.is_closed ? " closed" : ""}${drag?.moved && drag.id === issue.id ? " dragging" : ""}`}
                      style={{
                        // Inset from the day's edges, except where it carries on into the next week.
                        left: `calc(${(p.from / 7) * 100}% + ${p.before ? 0 : 3}px)`,
                        width: `calc(${((p.to - p.from + 1) / 7) * 100}% - ${(p.before ? 0 : 3) + (p.after ? 0 : 3)}px)`,
                        top: DAY_HEAD + p.lane * LANE,
                      }}
                      title={`#${issue.id} ${issue.subject}. ${dates}.`}
                      onPointerDown={(e) => startDrag(e, issue)}
                      onClick={() => open(issue.id)}
                      onMouseMove={() => !drag && focusedId !== issue.id && focusIssue(issue.id)}
                    >
                      <StatusIcon category={category} title={issue.status.name} />
                      <span className="calendar-bar-title">{issue.subject}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {undated.length > 0 && (
        <aside className="calendar-undated" aria-label="Issues without dates">
          <div className="calendar-undated-head">
            <span>No dates</span>
            <span className="count">{undated.length}</span>
          </div>
          <p className="calendar-undated-hint">Drag one onto a day to set its due date.</p>
          <div className="calendar-undated-list">
            {undated.map((issue) => (
              <div
                key={issue.id}
                id={`issue-cal-${issue.id}`}
                role="option"
                aria-selected={issue.id === focusedId}
                aria-label={`${spokenIssue(issue, d, route.view !== "cycle")}. No dates.`}
                className={`calendar-undated-issue${issue.id === focusedId ? " focused" : ""}`}
                onPointerDown={(e) => startDrag(e, issue)}
                onClick={() => open(issue.id)}
                onMouseMove={() => !drag && focusedId !== issue.id && focusIssue(issue.id)}
              >
                <StatusIcon category={issueCategory(issue, d.categories)} title={issue.status.name} />
                <span className="issue-id">#{issue.id}</span>
                <span className="calendar-bar-title">{issue.subject}</span>
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
