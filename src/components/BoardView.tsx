import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardColumn } from "../lib/board";
import { boardColumns, canDrop } from "../lib/board";
import { hueFor, issueCategory, issueLabels, teamOf } from "../lib/model";
import { isTyping, matchesShortcut } from "../lib/platform";
import { clickSelection } from "../lib/selection";
import type { Issue } from "../lib/types";
import type { ViewOptions } from "../lib/views";
import type { Route } from "../state/app";
import { overlayOpen, useApp } from "../state/app";
import type { Derived } from "../state/derived";
import { showsProject, useDerived } from "../state/derived";
import { Avatar } from "./Avatar";
import { BlockedMark, GroupIcon, spokenIssue } from "./IssueList";
import { Icon, PriorityIcon, StatusIcon } from "./icons";

const CARD_ESTIMATE = 92;
const DRAG_THRESHOLD = 4;
const EDGE = 48;

interface Drag {
  issue: Issue;
  fromKey: string;
  /** Pointer position and where in the card it was grabbed. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  width: number;
  overKey: string | null;
  /** Statuses Redmine's workflow allows for the issue, once known. */
  allowed: Set<number> | null;
}

/** A due date the way Linear shows it on a card. */
function dueLabel(date: string, today = new Date()): { text: string; overdue: boolean } {
  const d = new Date(`${date}T00:00:00`);
  const day = today.toISOString().slice(0, 10);
  const sameYear = d.getFullYear() === today.getFullYear();
  return {
    text: d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }),
    overdue: date < day,
  };
}

function Card({
  issue,
  d,
  column,
  focused,
  dragging,
  showProject,
  grouping,
  ghost = false,
  selected = false,
  selecting = false,
  onPointerDown,
  onOpen,
  onFocus,
}: {
  issue: Issue;
  d: Derived;
  column: BoardColumn;
  focused: boolean;
  dragging: boolean;
  showProject: boolean;
  grouping: ViewOptions["grouping"];
  /** The copy that follows the pointer while dragging. */
  ghost?: boolean;
  /** Picked for changing several issues at once. */
  selected?: boolean;
  /** Whether any issue is picked. */
  selecting?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onOpen?: (e: React.MouseEvent) => void;
  onFocus?: () => void;
}) {
  const category = issueCategory(issue, d.categories);
  const labels = issueLabels(issue, d.labelFields);
  const due = issue.due_date && !issue.status.is_closed ? dueLabel(issue.due_date) : null;
  const byStatus = grouping === "status" || grouping === "none";
  return (
    <div
      {...(ghost
        ? {}
        : {
            id: `issue-card-${issue.id}`,
            role: "option",
            "aria-selected": selecting ? selected : focused,
            "aria-label": `${spokenIssue(issue, d, true)}. In ${column.label}.`,
          })}
      className={`board-card${focused ? " focused" : ""}${selected ? " selected" : ""}${dragging ? " drag-source" : ""}`}
      onPointerDown={onPointerDown}
      onClick={onOpen}
      onMouseMove={onFocus}
    >
      <div className="board-card-top">
        <span className="issue-id">#{issue.id}</span>
        {showProject && <span className="board-card-project">{issue.project.name}</span>}
        <BlockedMark issue={issue} />
        <span className="header-spacer" />
        {grouping !== "assignee" && <Avatar name={issue.assigned_to?.name} size={18} />}
      </div>
      <div className="board-card-title">
        {!byStatus && <StatusIcon category={category} title={issue.status.name} />}
        <span>{issue.subject}</span>
      </div>
      <div className="board-card-meta">
        {grouping !== "priority" && (
          <span className="board-card-pill" title={issue.priority.name}>
            <PriorityIcon level={d.priorities.get(issue.priority.id) ?? 0} />
          </span>
        )}
        {labels.slice(0, 3).map((l) => (
          <span key={`${l.field}:${l.value}`} className="chip" title={l.field}>
            <span className="chip-dot" style={{ background: `hsl(${hueFor(l.field + l.value)} 55% 55%)` }} />
            {l.value}
          </span>
        ))}
        {grouping !== "cycle" && issue.fixed_version && (
          <span className="chip chip-plain">
            <Icon name="cycle" size={12} />
            {issue.fixed_version.name}
          </span>
        )}
        {due && (
          <span className={`chip chip-plain${due.overdue ? " chip-overdue" : ""}`} title={`Due ${issue.due_date}`}>
            {due.text}
          </span>
        )}
      </div>
    </div>
  );
}

function Column({
  column,
  d,
  grouping,
  focusedId,
  selection,
  drag,
  showProject,
  registerColumn,
  onCardPointerDown,
  onOpen,
  onFocus,
}: {
  column: BoardColumn;
  d: Derived;
  grouping: ViewOptions["grouping"];
  focusedId: number | null;
  selection: number[];
  drag: Drag | null;
  showProject: (issue: Issue) => boolean;
  registerColumn: (key: string, el: HTMLElement | null) => void;
  onCardPointerDown: (e: React.PointerEvent, issue: Issue, column: BoardColumn) => void;
  onOpen: (id: number, e: React.MouseEvent) => void;
  onFocus: (id: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => new Set(selection), [selection]);
  // TanStack Virtual returns fresh functions each render, so the React
  // Compiler skips this component; that's expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: column.issues.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_ESTIMATE,
    getItemKey: (i) => column.issues[i]!.id,
    overscan: 6,
  });

  const focusedIndex = column.issues.findIndex((i) => i.id === focusedId);
  useEffect(() => {
    if (focusedIndex >= 0) virtualizer.scrollToIndex(focusedIndex, { align: "auto" });
  }, [focusedIndex, virtualizer]);

  const isOver = drag !== null && drag.overKey === column.key && drag.fromKey !== column.key;
  const blocked = drag !== null && drag.fromKey !== column.key && !canDrop(column, drag.allowed, drag.issue);
  return (
    <section
      ref={(el) => registerColumn(column.key, el)}
      role="group"
      aria-label={`${column.label}, ${column.issues.length} ${column.issues.length === 1 ? "issue" : "issues"}`}
      className={`board-column${isOver ? (blocked ? " drop-blocked" : " drop-over") : ""}${blocked ? " drop-dim" : ""}`}
    >
      <header className="board-column-header">
        <GroupIcon icon={column.icon} />
        <span className="board-column-name">{column.label}</span>
        <span className="count">{column.issues.length}</span>
      </header>
      <div ref={scrollRef} className="board-column-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const issue = column.issues[item.index]!;
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="board-card-slot"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <Card
                  issue={issue}
                  d={d}
                  column={column}
                  grouping={grouping}
                  focused={issue.id === focusedId}
                  dragging={drag?.issue.id === issue.id}
                  showProject={showProject(issue)}
                  onPointerDown={(e) => onCardPointerDown(e, issue, column)}
                  selected={selected.has(issue.id)}
                  selecting={selection.length > 0}
                  onOpen={(e) => onOpen(issue.id, e)}
                  onFocus={() => issue.id !== focusedId && onFocus(issue.id)}
                />
              </div>
            );
          })}
        </div>
        {column.issues.length === 0 && <div className="board-column-empty">No issues</div>}
      </div>
    </section>
  );
}

/** Issues as a board of columns, one per value of the list's grouping. */
export function BoardView({ issues, view, route }: { issues: Issue[]; view: ViewOptions; route: Route }) {
  const d = useDerived();
  const meta = useApp((s) => s.meta);
  const me = useApp((s) => s.account?.userId);
  const backend = useApp((s) => s.backend);
  const focusedId = useApp((s) => s.focusedIssueId);
  const focusIssue = useApp((s) => s.focusIssue);
  const openIssue = useApp((s) => s.openIssue);
  const selection = useApp((s) => s.selection);
  const setSelection = useApp((s) => s.setSelection);
  const updateIssue = useApp((s) => s.updateIssue);
  const showToast = useApp((s) => s.showToast);
  const overlay = useApp(overlayOpen);
  const boardRef = useRef<HTMLDivElement>(null);
  const columnEls = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pending = useRef<{ issue: Issue; column: BoardColumn; x: number; y: number; rect: DOMRect } | null>(null);
  const suppressClick = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });

  const versions = useMemo(() => {
    if (!meta) return [];
    switch (route.view) {
      case "team":
        return meta.versions.filter((v) => teamOf(v.project.id, meta) === route.teamId);
      case "project":
        return meta.versions.filter((v) => v.project.id === route.projectId);
      case "cycle":
        return meta.versions.filter((v) => v.id === route.versionId);
      default:
        return [];
    }
  }, [meta, route]);

  const columns = useMemo(
    () =>
      meta ? boardColumns(issues, view.grouping, view.ordering, d, meta, { me, versions, showEmpty: view.showEmptyColumns }) : [],
    [issues, view.grouping, view.ordering, view.showEmptyColumns, d, meta, me, versions],
  );

  const showProject = useCallback((issue: Issue) => showsProject(route, issue.project.id, d), [route, d]);

  const setDragState = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  /** Statuses Redmine allows next for an issue, from the server. */
  const loadAllowed = useCallback(
    async (issueId: number): Promise<Set<number> | null> => {
      try {
        const details = await backend?.getIssueDetails(issueId, true);
        const allowed = details?.allowedStatuses;
        return allowed?.length ? new Set(allowed.map((s) => s.id)) : null;
      } catch {
        return null;
      }
    },
    [backend],
  );

  const moveTo = useCallback(
    async (issue: Issue, column: BoardColumn, allowed: Set<number> | null) => {
      if (column.statusId !== undefined && column.statusId === issue.status.id) return;
      if (column.projectId !== undefined && column.projectId !== issue.project.id) {
        showToast(`${column.label} is a category of another project, so #${issue.id} can't go in it.`);
        return;
      }
      if (!canDrop(column, allowed)) {
        showToast(`Redmine's workflow doesn't allow moving #${issue.id} from ${issue.status.name} to ${column.label}.`);
        return;
      }
      await updateIssue(issue.id, column.drop);
    },
    [showToast, updateIssue],
  );

  const columnAt = (x: number, y: number): string | null => {
    for (const [key, el] of columnEls.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 40 && y <= r.bottom + 40) return key;
    }
    return null;
  };

  // Dragging uses pointer events rather than HTML drag and drop, which the
  // Windows web view gives to the shell for dropping files.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      pointer.current = { x: e.clientX, y: e.clientY };
      const current = dragRef.current;
      if (!current) {
        const p = pending.current;
        if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
        pending.current = null;
        const next: Drag = {
          issue: p.issue,
          fromKey: p.column.key,
          x: e.clientX,
          y: e.clientY,
          dx: p.x - p.rect.left,
          dy: p.y - p.rect.top,
          width: p.rect.width,
          overKey: p.column.key,
          allowed: null,
        };
        setDragState(next);
        focusIssue(p.issue.id);
        if (columns.some((c) => c.statusId !== undefined)) {
          void loadAllowed(p.issue.id).then((allowed) => {
            if (dragRef.current?.issue.id === p.issue.id) setDragState({ ...dragRef.current, allowed });
          });
        }
        return;
      }
      setDragState({ ...current, x: e.clientX, y: e.clientY, overKey: columnAt(e.clientX, e.clientY) });
    }
    function onUp() {
      pending.current = null;
      const current = dragRef.current;
      if (!current) return;
      setDragState(null);
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      const target = columns.find((c) => c.key === current.overKey);
      if (target && target.key !== current.fromKey) void moveTo(current.issue, target, current.allowed);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && dragRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setDragState(null);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [columns, focusIssue, loadAllowed, moveTo]);

  // While dragging near the board's edges, scroll it.
  useEffect(() => {
    if (!drag) return;
    const timer = setInterval(() => {
      const board = boardRef.current;
      if (!board) return;
      const r = board.getBoundingClientRect();
      const { x } = pointer.current;
      if (x < r.left + EDGE) board.scrollLeft -= 14;
      else if (x > r.right - EDGE) board.scrollLeft += 14;
    }, 16);
    return () => clearInterval(timer);
  }, [drag]);

  // Keyboard: arrows and J/K move between cards, Enter opens, Shift+←/→
  // moves the card to the next column.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (overlay || isTyping(e.target) || dragRef.current) return;
      if (matchesShortcut(e, "mod+a")) {
        e.preventDefault();
        setSelection(columns.flatMap((c) => c.issues.map((i) => i.id)));
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const filled = columns.filter((c) => c.issues.length);
      if (!filled.length) return;
      let col = columns.findIndex((c) => c.issues.some((i) => i.id === focusedId));
      const row = col >= 0 ? columns[col]!.issues.findIndex((i) => i.id === focusedId) : -1;
      const focusFirst = () => focusIssue(filled[0]!.issues[0]!.id);
      const key = e.key;
      if (key === "Enter" && focusedId !== null && col >= 0) {
        e.preventDefault();
        openIssue(focusedId);
        return;
      }
      const vertical = key === "ArrowDown" || key === "j" || key === "ArrowUp" || key === "k";
      const horizontal = key === "ArrowLeft" || key === "ArrowRight";
      if (!vertical && !horizontal) return;
      e.preventDefault();
      if (boardRef.current && !boardRef.current.contains(document.activeElement)) {
        boardRef.current.focus({ preventScroll: true });
      }
      if (col < 0) return focusFirst();
      const step = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
      if (horizontal && e.shiftKey) {
        const target = columns[col + step];
        const issue = columns[col]!.issues[row]!;
        if (!target) return;
        if (target.statusId === undefined) void moveTo(issue, target, null);
        else void loadAllowed(issue.id).then((allowed) => moveTo(issue, target, allowed));
        columnEls.current.get(target.key)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        return;
      }
      if (vertical) {
        const list = columns[col]!.issues;
        const next = key === "ArrowDown" || key === "j" ? Math.min(list.length - 1, row + 1) : Math.max(0, row - 1);
        focusIssue(list[next]!.id);
        return;
      }
      // Across: the next column with cards, at the same height or its last card.
      do col += step;
      while (col >= 0 && col < columns.length && !columns[col]!.issues.length);
      const target = columns[col];
      if (!target) return;
      focusIssue(target.issues[Math.min(row, target.issues.length - 1)]!.id);
      columnEls.current.get(target.key)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [columns, focusedId, overlay, focusIssue, openIssue, loadAllowed, moveTo, setSelection]);

  // Cards that drop off the board stop being picked.
  useEffect(() => {
    const ids = new Set(columns.flatMap((c) => c.issues.map((i) => i.id)));
    const picked = useApp.getState().selection;
    if (picked.some((id) => !ids.has(id))) setSelection(picked.filter((id) => ids.has(id)));
  }, [columns, setSelection]);

  const registerColumn = useCallback((key: string, el: HTMLElement | null) => {
    if (el) columnEls.current.set(key, el);
    else columnEls.current.delete(key);
  }, []);

  const onCardPointerDown = useCallback((e: React.PointerEvent, issue: Issue, column: BoardColumn) => {
    if (e.button !== 0) return;
    pending.current = { issue, column, x: e.clientX, y: e.clientY, rect: e.currentTarget.getBoundingClientRect() };
  }, []);

  // A plain click opens; Cmd/Ctrl+click and Shift+click pick cards to change together.
  const open = useCallback(
    (id: number, e: React.MouseEvent) => {
      if (suppressClick.current) return;
      const { selection: picked, focusedIssueId } = useApp.getState();
      const anchor = picked.length ? picked[picked.length - 1]! : focusedIssueId;
      const order = columns.flatMap((c) => c.issues.map((i) => i.id));
      const next = clickSelection(order, picked, anchor, id, e);
      if (next) {
        setSelection(next);
        focusIssue(id);
      } else openIssue(id);
    },
    [columns, focusIssue, openIssue, setSelection],
  );

  const sourceColumn = drag ? columns.find((c) => c.key === drag.fromKey) : undefined;
  return (
    <div
      ref={boardRef}
      className={`board${drag ? " is-dragging" : ""}`}
      role="listbox"
      aria-label="Issues board"
      aria-multiselectable="true"
      aria-activedescendant={focusedId ? `issue-card-${focusedId}` : undefined}
      tabIndex={0}
    >
      {columns.map((column) => (
        <Column
          key={column.key}
          column={column}
          d={d}
          grouping={view.grouping}
          focusedId={focusedId}
          selection={selection}
          drag={drag}
          showProject={showProject}
          registerColumn={registerColumn}
          onCardPointerDown={onCardPointerDown}
          onOpen={open}
          onFocus={focusIssue}
        />
      ))}
      {drag && sourceColumn && (
        <div className="board-ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }} aria-hidden>
          <Card
            issue={drag.issue}
            d={d}
            column={sourceColumn}
            grouping={view.grouping}
            focused={false}
            dragging={false}
            showProject={showProject(drag.issue)}
            ghost
          />
        </div>
      )}
    </div>
  );
}
