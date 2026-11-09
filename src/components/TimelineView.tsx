import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { issueCategory } from "../lib/model";
import { isTyping } from "../lib/platform";
import type { DragMode, Span } from "../lib/timeline";
import { DAY_WIDTH, dateChanges, dayDate, dependencies, draggedSpan, issueSpan, ticks, timelineRange, today } from "../lib/timeline";
import type { Issue } from "../lib/types";
import type { Group, ViewOptions } from "../lib/views";
import { groupIssues } from "../lib/views";
import type { Route } from "../state/app";
import { overlayOpen, useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { BlockedMark, GroupIcon, spokenIssue } from "./IssueList";
import { StatusIcon } from "./icons";

const ROW = 36;
const HEADER = 32;
/** Width of the issue names on the left. */
const LABELS = 300;
const DRAG_THRESHOLD = 4;
/** Narrower bars put their title beside them. */
const TITLE_INSIDE = 72;

type Row = { kind: "group"; group: Group; count: number } | { kind: "issue"; issue: Issue };

interface Drag {
  id: number;
  mode: DragMode | "create";
  x: number;
  /** The day the pointer went down on, for "create". */
  anchor: number;
  days: number;
  moved: boolean;
}

function longDate(day: number) {
  return new Date(`${dayDate(day)}T00:00:00Z`).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

/** How a span reads aloud and in tooltips. */
export function spanLabel(span: Span | null, issue: Issue): string {
  if (!span) return "No dates";
  if (span.partial) return issue.due_date ? `Due ${longDate(span.end)}` : `Starts ${longDate(span.start)}`;
  return span.start === span.end ? longDate(span.start) : `${longDate(span.start)} to ${longDate(span.end)}`;
}

export function TimelineView({ issues, view, route }: { issues: Issue[]; view: ViewOptions; route: Route }) {
  const d = useDerived();
  const meta = useApp((s) => s.meta);
  const me = useApp((s) => s.account?.userId);
  const overlay = useApp(overlayOpen);
  const openIssue = useApp((s) => s.openIssue);
  const updateIssue = useApp((s) => s.updateIssue);
  const showToast = useApp((s) => s.showToast);
  const focusedId = useApp((s) => s.focusedIssueId);
  const focusIssue = useApp((s) => s.focusIssue);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["status:canceled"]));
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);

  const dayWidth = DAY_WIDTH[view.zoom];
  const now = today();
  const range = useMemo(() => timelineRange(issues, now, view.zoom), [issues, now, view.zoom]);
  const trackWidth = (range.end - range.start + 1) * dayWidth;
  const x = (day: number) => (day - range.start) * dayWidth;

  const groups = useMemo(
    () => (meta ? groupIssues(issues, view.grouping, view.ordering, d, meta, me) : []),
    [issues, view.grouping, view.ordering, d, meta, me],
  );
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const g of groups) {
      if (view.grouping !== "none") out.push({ kind: "group", group: g, count: g.issues.length });
      if (view.grouping === "none" || !collapsed.has(g.key)) g.issues.forEach((issue) => out.push({ kind: "issue", issue }));
    }
    return out;
  }, [groups, collapsed, view.grouping]);
  const rowOf = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r, i) => r.kind === "issue" && m.set(r.issue.id, i));
    return m;
  }, [rows]);
  const issueRows = useMemo(() => rows.flatMap((r, i) => (r.kind === "issue" ? [{ id: r.issue.id, index: i }] : [])), [rows]);

  // TanStack Virtual returns fresh functions each render, so the React
  // Compiler skips this component; that's expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    paddingStart: HEADER,
    overscan: 10,
  });

  // Open on today, a third of the way in, and again when the scale changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, x(now) - (el.clientWidth - LABELS) / 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.zoom]);

  /** The span an issue shows, with a drag in progress applied. */
  const shownSpan = (issue: Issue): Span | null => {
    const span = issueSpan(issue);
    if (!drag || drag.id !== issue.id) return span;
    if (drag.mode === "create") {
      const end = drag.anchor + drag.days;
      return { start: Math.min(drag.anchor, end), end: Math.max(drag.anchor, end), partial: false };
    }
    if (!span) return null;
    return { ...draggedSpan(span, drag.mode, drag.days), partial: span.partial };
  };

  function commit(issue: Issue, next: { start: number; end: number }, mode: DragMode | "create") {
    const changes =
      mode === "create" ? { start_date: dayDate(next.start), due_date: dayDate(next.end) } : dateChanges(issue, next, mode);
    if (Object.keys(changes).length) void updateIssue(issue.id, changes);
  }

  function startDrag(e: React.PointerEvent, issue: Issue, mode: DragMode | "create") {
    if (e.button !== 0) return;
    e.stopPropagation();
    const track = (e.currentTarget.closest(".timeline-track") as HTMLElement | null)?.getBoundingClientRect();
    const anchor = range.start + Math.floor((e.clientX - (track?.left ?? 0)) / dayWidth);
    const state: Drag = { id: issue.id, mode, x: e.clientX, anchor, days: 0, moved: false };
    dragRef.current = state;
    focusIssue(issue.id);

    const onMove = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const dx = ev.clientX - cur.x;
      const moved = cur.moved || Math.abs(dx) >= DRAG_THRESHOLD;
      const next = { ...cur, moved, days: moved ? Math.round(dx / dayWidth) : 0 };
      dragRef.current = next;
      if (moved) setDrag(next);
    };
    const finish = (cancel: boolean) => {
      const cur = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
      if (!cur || !cur.moved) return;
      suppressClick.current = true;
      if (cancel) return;
      if (cur.mode === "create") {
        const end = cur.anchor + cur.days;
        commit(issue, { start: Math.min(cur.anchor, end), end: Math.max(cur.anchor, end) }, "create");
      } else if (cur.days !== 0) {
        const span = issueSpan(issue);
        if (span) commit(issue, draggedSpan(span, cur.mode, cur.days), cur.mode);
      }
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

  // Keyboard: ↑/↓ or j/k move, Enter opens, Shift+←/→ moves the dates a day.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (overlay || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || !issueRows.length) return;
      const pos = issueRows.findIndex((r) => r.id === focusedId);
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.shiftKey && focusedId !== null) {
        e.preventDefault();
        const issue = useApp.getState().issues.get(focusedId);
        const span = issue && issueSpan(issue);
        if (!issue) return;
        if (!span) {
          showToast(`#${issue.id} has no dates yet. Drag across its row to set them.`);
          return;
        }
        commit(issue, draggedSpan(span, "move", e.key === "ArrowRight" ? 1 : -1), "move");
        return;
      }
      if (e.shiftKey) return;
      let next: number | null = null;
      if (e.key === "ArrowDown" || e.key === "j") next = pos < 0 ? 0 : Math.min(issueRows.length - 1, pos + 1);
      else if (e.key === "ArrowUp" || e.key === "k") next = pos < 0 ? 0 : Math.max(0, pos - 1);
      else if (e.key === "Enter" && focusedId !== null) {
        e.preventDefault();
        openIssue(focusedId);
        return;
      }
      if (next === null) return;
      e.preventDefault();
      if (scrollRef.current && !scrollRef.current.contains(document.activeElement)) {
        scrollRef.current.focus({ preventScroll: true });
      }
      const target = issueRows[next]!;
      focusIssue(target.id);
      virtualizer.scrollToIndex(target.index, { align: "auto" });
      // Bring its bar into view too.
      const issue = useApp.getState().issues.get(target.id);
      const span = issue && issueSpan(issue);
      const el = scrollRef.current;
      if (span && el) {
        const left = x(span.start);
        const right = x(span.end + 1);
        const visibleLeft = el.scrollLeft;
        const visibleRight = el.scrollLeft + el.clientWidth - LABELS;
        if (right < visibleLeft || left > visibleRight) el.scrollLeft = Math.max(0, left - 48);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const marks = useMemo(() => ticks(range, view.zoom), [range, view.zoom]);
  const byId = useMemo(() => new Map(issues.map((i) => [i.id, i])), [issues]);
  const arrows = dependencies(issues).flatMap((dep) => {
    const from = byId.get(dep.from);
    const to = byId.get(dep.to);
    const fromRow = rowOf.get(dep.from);
    const toRow = rowOf.get(dep.to);
    const a = from && shownSpan(from);
    const b = to && shownSpan(to);
    if (!a || !b || fromRow === undefined || toRow === undefined) return [];
    const x1 = x(a.end + 1);
    const y1 = HEADER + fromRow * ROW + ROW / 2;
    const x2 = x(b.start);
    const y2 = HEADER + toRow * ROW + ROW / 2;
    const bend = Math.max(16, Math.min(48, Math.abs(x2 - x1) / 2));
    return [
      {
        key: `${dep.from}-${dep.to}`,
        // The later issue starts before the earlier one ends.
        late: b.start <= a.end,
        path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
        label: `#${dep.from} ${dep.kind === "blocks" ? "blocks" : "precedes"} #${dep.to}`,
      },
    ];
  });

  const showProject = (issue: Issue) =>
    route.view === "my-issues" || ((route.view === "team" || route.view === "cycle") && issue.project.id !== route.teamId);
  const height = virtualizer.getTotalSize();

  return (
    <div
      ref={scrollRef}
      className={`timeline${drag ? " dragging" : ""}`}
      role="listbox"
      aria-label="Issues timeline"
      aria-activedescendant={focusedId && rowOf.has(focusedId) ? `issue-bar-${focusedId}` : undefined}
      tabIndex={0}
    >
      <div className="timeline-canvas" style={{ width: LABELS + trackWidth, height }}>
        <div className="timeline-header" style={{ width: LABELS + trackWidth }} aria-hidden="true">
          <div className="timeline-corner">Issue</div>
          <div className="timeline-ticks" style={{ width: trackWidth }}>
            {marks.map((t) => (
              <span key={t.day} className={`timeline-tick${t.major ? " major" : ""}`} style={{ left: x(t.day) }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
        <div className="timeline-lines" style={{ left: LABELS, width: trackWidth, top: HEADER, height: height - HEADER }} aria-hidden="true">
          {marks.map((t) => (
            <span key={t.day} className={`timeline-line${t.major ? " major" : ""}`} style={{ left: x(t.day) }} />
          ))}
          <span className="timeline-today" style={{ left: x(now) + dayWidth / 2 }} title={`Today, ${longDate(now)}`} />
        </div>
        <svg
          className="timeline-arrows"
          style={{ left: LABELS, width: trackWidth, height }}
          viewBox={`0 0 ${trackWidth} ${height}`}
          aria-hidden="true"
        >
          <defs>
            <marker id="timeline-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 8 4 0 8z" fill="context-stroke" />
            </marker>
          </defs>
          {arrows.map((a) => (
            <path key={a.key} className={a.late ? "late" : undefined} d={a.path} markerEnd="url(#timeline-arrow)">
              <title>{a.label}</title>
            </path>
          ))}
        </svg>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!;
          if (row.kind === "group") {
            return (
              <div key={item.key} className="timeline-row timeline-group" style={{ top: item.start, width: LABELS + trackWidth }}>
                <button
                  type="button"
                  role="presentation"
                  className="group-header timeline-label"
                  aria-expanded={!collapsed.has(row.group.key)}
                  onClick={() => toggleGroup(row.group.key)}
                >
                  <GroupIcon icon={row.group.icon} />
                  <span>{row.group.label}</span>
                  <span className="count">{row.count}</span>
                </button>
              </div>
            );
          }
          const issue = row.issue;
          const span = shownSpan(issue);
          const category = issueCategory(issue, d.categories);
          const focused = issue.id === focusedId;
          const width = span ? x(span.end + 1) - x(span.start) : 0;
          const dates = spanLabel(span, issue);
          return (
            <div
              key={item.key}
              id={`issue-bar-${issue.id}`}
              role="option"
              aria-selected={focused}
              aria-label={`${spokenIssue(issue, d, route.view !== "cycle")}. ${dates}.`}
              className={`timeline-row${focused ? " focused" : ""}`}
              style={{ top: item.start, width: LABELS + trackWidth }}
              onMouseMove={() => !drag && focusedId !== issue.id && focusIssue(issue.id)}
            >
              <div
                className="timeline-label"
                onClick={() => openIssue(issue.id)}
                title={`#${issue.id} ${issue.subject}`}
              >
                <StatusIcon category={category} title={issue.status.name} />
                <span className="issue-id">#{issue.id}</span>
                <span className="timeline-subject">{issue.subject}</span>
                {showProject(issue) && <span className="chip chip-plain">{issue.project.name}</span>}
                <BlockedMark issue={issue} />
              </div>
              <div
                className={`timeline-track${span ? "" : " undated"}`}
                style={{ width: trackWidth }}
                onPointerDown={span ? undefined : (e) => startDrag(e, issue, "create")}
              >
                {span ? (
                  span.partial ? (
                    <div
                      className={`timeline-milestone cat-${category}`}
                      style={{ left: x(span.start) + dayWidth / 2 }}
                      title={`${dates}. Drag to move.`}
                      onPointerDown={(e) => startDrag(e, issue, "move")}
                      onClick={() => {
                        if (suppressClick.current) suppressClick.current = false;
                        else openIssue(issue.id);
                      }}
                    >
                      <span className="timeline-outside">{issue.subject}</span>
                    </div>
                  ) : (
                    <div
                      className={`timeline-bar cat-${category}`}
                      style={{ left: x(span.start), width }}
                      title={dates}
                      onPointerDown={(e) => startDrag(e, issue, "move")}
                      onClick={() => {
                        if (suppressClick.current) suppressClick.current = false;
                        else openIssue(issue.id);
                      }}
                    >
                      <span className="timeline-handle start" onPointerDown={(e) => startDrag(e, issue, "start")} />
                      {width >= TITLE_INSIDE && <span className="timeline-bar-title">{issue.subject}</span>}
                      <span className="timeline-handle end" onPointerDown={(e) => startDrag(e, issue, "end")} />
                      {width < TITLE_INSIDE && <span className="timeline-outside">{issue.subject}</span>}
                    </div>
                  )
                ) : (
                  <span className="timeline-hint">Drag to set dates</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
