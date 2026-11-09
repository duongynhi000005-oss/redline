import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { issueCategory, issueLabels, hueFor, relativeTime } from "../lib/model";
import { matchesFilters } from "../lib/filters";
import { blockingIssues } from "../lib/relations";
import { isTyping } from "../lib/platform";
import { clickSelection } from "../lib/selection";
import type { Issue } from "../lib/types";
import type { MyIssuesTab, Route, TeamTab } from "../state/app";
import { overlayOpen, routeKey, useApp, viewFor } from "../state/app";
import type { Derived } from "../state/derived";
import { routeTitle, showsProject, useDerived } from "../state/derived";
import type { Group, Layout, ViewOptions } from "../lib/views";
import { LAYOUTS, groupIssues } from "../lib/views";
import { matchesShortcut, shortcutLabel } from "../lib/platform";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { TimelineView } from "./TimelineView";
import { DisplayMenu } from "./DisplayMenu";
import { Avatar } from "./Avatar";
import { CycleHeader } from "./Cycle";
import { FilterBar, useRouteIssues } from "./Filters";
import { SelectionBar } from "./SelectionBar";
import { Icon, PriorityIcon, StatusIcon } from "./icons";
import { OpenInRedmineButton } from "./OpenInRedmine";

type Row = { kind: "group"; group: Group; count: number } | { kind: "issue"; issue: Issue };

export function GroupIcon({ icon }: { icon: Group["icon"] }) {
  switch (icon.kind) {
    case "status":
      return <StatusIcon category={icon.category} />;
    case "priority":
      return <PriorityIcon level={icon.level} />;
    case "assignee":
      return <Avatar name={icon.name} size={16} />;
    case "cycle":
      return <Icon name="cycle" />;
    case "category":
      return <Icon name="category" />;
    case "none":
      return null;
  }
}

const ROW_HEIGHT = 36;
const GROUP_HEIGHT = 36;

const TEAM_TABS: { tab: TeamTab; label: string }[] = [
  { tab: "all", label: "All issues" },
  { tab: "active", label: "Active" },
  { tab: "backlog", label: "Backlog" },
];

const MY_TABS: { tab: MyIssuesTab; label: string }[] = [
  { tab: "assigned", label: "Assigned" },
  { tab: "created", label: "Created" },
];

function Tabs({ route }: { route: Route }) {
  const navigate = useApp((s) => s.navigate);
  if (route.view !== "team" && route.view !== "my-issues") return null;
  const items =
    route.view === "team"
      ? TEAM_TABS.map((t) => ({ key: t.tab, label: t.label, active: route.tab === t.tab, go: () => navigate({ ...route, tab: t.tab }) }))
      : MY_TABS.map((t) => ({ key: t.tab, label: t.label, active: route.tab === t.tab, go: () => navigate({ ...route, tab: t.tab }) }));
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.active} className="tab" onClick={t.go}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** One sentence for screen readers instead of every chip read out in turn. */
export function spokenIssue(issue: Issue, d: Derived, showCycle: boolean): string {
  const labels = issueLabels(issue, d.labelFields);
  return [
    `${issue.subject}, #${issue.id}`,
    issue.status.name,
    `${issue.priority.name} priority`,
    issue.assigned_to ? `assigned to ${issue.assigned_to.name}` : "unassigned",
    ...labels.map((l) => l.value),
    showCycle && issue.fixed_version ? issue.fixed_version.name : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** List or Board, like Linear's view switcher. */
export function LayoutSwitcher({ layout, onChange }: { layout: Layout; onChange: (layout: Layout) => void }) {
  return (
    <div className="layout-switcher" role="radiogroup" aria-label="Layout">
      {LAYOUTS.map((l) => (
        <button
          key={l.value}
          type="button"
          role="radio"
          aria-checked={layout === l.value}
          aria-label={l.label}
          title={`${l.label} (${shortcutLabel(l.shortcut)})`}
          className="layout-option"
          onClick={() => onChange(l.value)}
        >
          <Icon name={l.value} />
        </button>
      ))}
    </div>
  );
}

/** A small mark on issues blocked by another open issue. */
export function BlockedMark({ issue }: { issue: Issue }) {
  const issues = useApp((s) => s.issues);
  const blockers = issue.relations?.length ? blockingIssues(issue, issues) : [];
  if (!blockers.length) return null;
  const text = `Blocked by ${blockers.map((b) => `#${b}`).join(", ")}`;
  return (
    <span className="blocked-mark" role="img" aria-label={text} title={text}>
      <Icon name="blocked" size={12} />
    </span>
  );
}

export function IssueRow({
  issue,
  d,
  focused,
  showProject,
  showCycle = true,
  selected = false,
  selecting = false,
  onOpen,
  onFocus,
}: {
  issue: Issue;
  d: Derived;
  focused: boolean;
  showProject: boolean;
  showCycle?: boolean;
  /** Picked for changing several issues at once. */
  selected?: boolean;
  /** Whether any issue is picked, so every row shows its box. */
  selecting?: boolean;
  onOpen: (e: React.MouseEvent) => void;
  onFocus: () => void;
}) {
  const category = issueCategory(issue, d.categories);
  const labels = issueLabels(issue, d.labelFields);
  const spoken = spokenIssue(issue, d, showCycle);
  return (
    <div
      id={`issue-row-${issue.id}`}
      role="option"
      aria-label={spoken}
      // While issues are picked, selected means picked; otherwise it's the highlighted row.
      aria-selected={selecting ? selected : focused}
      className={`issue-row${focused ? " focused" : ""}${selected ? " selected" : ""}${selecting ? " selecting" : ""}`}
      onClick={onOpen}
      onMouseMove={onFocus}
    >
      <span className="issue-check" aria-hidden="true">
        {selected && <Icon name="check" size={10} />}
      </span>
      <PriorityIcon level={d.priorities.get(issue.priority.id) ?? 0} title={issue.priority.name} />
      <span className="issue-id">#{issue.id}</span>
      <StatusIcon category={category} title={issue.status.name} />
      <span className="issue-subject">{issue.subject}</span>
      <BlockedMark issue={issue} />
      <span className="issue-meta">
        {labels.slice(0, 3).map((l) => (
          <span key={`${l.field}:${l.value}`} className="chip" title={l.field}>
            <span className="chip-dot" style={{ background: `hsl(${hueFor(l.field + l.value)} 55% 55%)` }} />
            {l.value}
          </span>
        ))}
        {showProject && <span className="chip chip-plain">{issue.project.name}</span>}
        {issue.fixed_version && showCycle && <span className="chip chip-plain">{issue.fixed_version.name}</span>}
        <Avatar name={issue.assigned_to?.name} />
        <span className="issue-date">{relativeTime(issue.updated_on)}</span>
      </span>
    </div>
  );
}

export function IssueList() {
  const route = useApp((s) => s.route);
  const overlay = useApp(overlayOpen);
  const d = useDerived();
  const openFilterMenu = useApp((s) => s.openFilterMenu);
  const updateView = useApp((s) => s.updateView);
  const key = routeKey(route);
  const view = useApp((s) => viewFor(s, key));
  const filters = view.filters;

  const base = useRouteIssues(route);
  const run = useApp((s) => (route.view === "query" ? s.queryRuns.get(route.queryId) : undefined));
  const issues = useMemo(() => (filters.length ? base.filter((i) => matchesFilters(i, filters, d)) : base), [base, filters, d]);
  const total = issues.length;

  // F filters; Cmd/Ctrl+1 to 4 switch between list, board, timeline and calendar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (overlay || isTyping(e.target)) return;
      const layout = LAYOUTS.find((l) => matchesShortcut(e, l.shortcut));
      if (layout) {
        e.preventDefault();
        updateView(key, { layout: layout.value });
        return;
      }
      if (e.key === "f" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openFilterMenu(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, openFilterMenu, updateView, key]);

  return (
    <section className="main" aria-label={routeTitle(route, d)}>
      <header className="main-header" data-tauri-drag-region>
        <h1>{routeTitle(route, d)}</h1>
        <span className="count">{total}</span>
        <Tabs route={route} />
        <span className="header-spacer" />
        <LayoutSwitcher layout={view.layout} onChange={(layout) => updateView(key, { layout })} />
        <button type="button" className="header-button" title="Filter (F)" onClick={() => openFilterMenu(null)}>
          <Icon name="filter" />
          <span>Filter</span>
        </button>
        <DisplayMenu route={route} />
        <OpenInRedmineButton />
      </header>
      {route.view === "cycle" && <CycleHeader teamId={route.teamId} versionId={route.versionId} />}
      <FilterBar route={route} shown={total} total={base.length} />
      {run && !run.loading && !run.error && run.total > run.ids.length && (
        <p className="list-note muted">
          Showing the first {run.ids.length} of {run.total} issues this view finds in Redmine.
        </p>
      )}
      {run?.error && !run.ids.length ? (
        <div className="empty-state" role="alert">
          <p>Couldn't run this view.</p>
          <p className="muted">{run.error}</p>
        </div>
      ) : !run?.ids.length && run?.loading ? (
        <div className="empty-state" aria-busy="true">
          <p className="muted">Asking Redmine…</p>
        </div>
      ) : total === 0 && filters.length ? (
        <div className="empty-state">
          <p>No issues match these filters.</p>
          <p className="muted">Remove a filter above, or press F to change them.</p>
        </div>
      ) : total === 0 ? (
        <div className="empty-state">
          <p>No issues here.</p>
          <p className="muted">
            {route.view === "my-issues"
              ? "Issues assigned to you in Redmine show up here."
              : route.view === "cycle"
                ? "Set an issue's cycle with Shift+C to add it here."
                : route.view === "query"
                  ? "Redmine finds no issues for this view."
                  : "Nothing matches this view yet."}
          </p>
        </div>
      ) : view.layout === "board" ? (
        <BoardView issues={issues} view={view} route={route} />
      ) : view.layout === "timeline" ? (
        <TimelineView issues={issues} view={view} route={route} />
      ) : view.layout === "calendar" ? (
        <CalendarView issues={issues} view={view} route={route} />
      ) : (
        <ListBody issues={issues} view={view} route={route} />
      )}
      <SelectionBar />
    </section>
  );
}

function ListBody({ issues, view, route }: { issues: Issue[]; view: ViewOptions; route: Route }) {
  const openIssue = useApp((s) => s.openIssue);
  const overlay = useApp(overlayOpen);
  const d = useDerived();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["status:canceled"]));
  const focusedId = useApp((s) => s.focusedIssueId);
  const setFocusedId = useApp((s) => s.focusIssue);
  const selection = useApp((s) => s.selection);
  const selected = useMemo(() => new Set(selection), [selection]);
  const setSelection = useApp((s) => s.setSelection);
  const meta = useApp((s) => s.meta);
  const me = useApp((s) => s.account?.userId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(
    () => (meta ? groupIssues(issues, view.grouping, view.ordering, d, meta, me) : []),
    [issues, view.grouping, view.ordering, d, meta, me],
  );
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const g of groups) {
      // Without grouping there's one group, and no heading for it.
      if (view.grouping !== "none") out.push({ kind: "group", group: g, count: g.issues.length });
      if (view.grouping === "none" || !collapsed.has(g.key)) g.issues.forEach((issue) => out.push({ kind: "issue", issue }));
    }
    return out;
  }, [groups, collapsed, view.grouping]);
  const issueRows = useMemo(() => rows.flatMap((r, i) => (r.kind === "issue" ? [{ id: r.issue.id, index: i }] : [])), [rows]);

  // TanStack Virtual returns fresh functions each render, so the React
  // Compiler skips this component; that's expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === "group" ? GROUP_HEIGHT : ROW_HEIGHT),
    overscan: 12,
  });

  const order = useMemo(() => issueRows.map((r) => r.id), [issueRows]);

  // Keyboard: ↑/↓ or j/k move, Home/End and Page Up/Down jump, Enter opens, Shift+↑/↓ pick as they move, Cmd/Ctrl+A picks all.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (overlay || isTyping(e.target) || !issueRows.length) return;
      if (matchesShortcut(e, "mod+a")) {
        e.preventDefault();
        setSelection(order);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const pos = issueRows.findIndex((r) => r.id === focusedId);
      let next: number | null = null;
      if (e.key === "ArrowDown" || e.key === "j") next = pos < 0 ? 0 : Math.min(issueRows.length - 1, pos + 1);
      else if (e.key === "ArrowUp" || e.key === "k") next = pos < 0 ? 0 : Math.max(0, pos - 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = issueRows.length - 1;
      else if (e.key === "PageDown" || e.key === "PageUp") {
        // A page is the rows that fit on screen, less one so the last stays in view.
        const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / ROW_HEIGHT) - 1);
        const from = pos < 0 ? 0 : pos;
        next = e.key === "PageDown" ? Math.min(issueRows.length - 1, from + page) : Math.max(0, from - page);
      }
      else if (e.key === "Enter" && focusedId !== null) {
        e.preventDefault();
        openIssue(focusedId);
        return;
      }
      if (next === null) return;
      e.preventDefault();
      // Screen readers follow aria-activedescendant only while the list has focus.
      if (scrollRef.current && !scrollRef.current.contains(document.activeElement)) {
        scrollRef.current.focus({ preventScroll: true });
      }
      const target = issueRows[next]!;
      if (e.shiftKey && focusedId !== null) {
        const picked = useApp.getState().selection;
        setSelection([...picked, focusedId, target.id]);
      }
      setFocusedId(target.id);
      virtualizer.scrollToIndex(target.index, { align: "auto" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [issueRows, order, focusedId, overlay, openIssue, setFocusedId, setSelection, virtualizer]);

  // Issues that drop out of the list (filtered, moved, closed) stop being picked.
  useEffect(() => {
    const picked = useApp.getState().selection;
    if (!picked.length) return;
    // A Set, because after Select all both lists hold every issue.
    const listed = new Set(order);
    if (picked.some((id) => !listed.has(id))) setSelection(picked.filter((id) => listed.has(id)));
  }, [order, setSelection]);

  // Coming back from an issue, scroll its row into view.
  useEffect(() => {
    const row = issueRows.find((r) => r.id === useApp.getState().focusedIssueId);
    if (row) virtualizer.scrollToIndex(row.index, { align: "auto" });
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleGroup = (c: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  return (
    <div
      ref={scrollRef}
      className="issue-scroll"
      role="listbox"
      aria-label="Issues"
      aria-multiselectable="true"
      aria-activedescendant={focusedId ? `issue-row-${focusedId}` : undefined}
      tabIndex={0}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!;
          return (
            <div
              key={item.key}
              className="virtual-row"
              style={{ transform: `translateY(${item.start}px)`, height: item.size }}
            >
              {row.kind === "group" ? (
                <button
                  type="button"
                  role="presentation"
                  className="group-header"
                  aria-expanded={!collapsed.has(row.group.key)}
                  onClick={() => toggleGroup(row.group.key)}
                >
                  <GroupIcon icon={row.group.icon} />
                  <span>{row.group.label}</span>
                  <span className="count">{row.count}</span>
                </button>
              ) : (
                <IssueRow
                  issue={row.issue}
                  d={d}
                  focused={row.issue.id === focusedId}
                  showProject={showsProject(route, row.issue.project.id, d)}
                  showCycle={route.view !== "cycle"}
                  selected={selected.has(row.issue.id)}
                  selecting={selection.length > 0}
                  onOpen={(e) => {
                    const anchor = selection.length ? selection[selection.length - 1]! : focusedId;
                    const onBox = e.target instanceof Element && e.target.closest(".issue-check");
                    const picked = onBox
                      ? clickSelection(order, selection, anchor, row.issue.id, { shiftKey: e.shiftKey, metaKey: true, ctrlKey: true })
                      : clickSelection(order, selection, anchor, row.issue.id, e);
                    if (picked) {
                      e.preventDefault();
                      setSelection(picked);
                      setFocusedId(row.issue.id);
                    } else openIssue(row.issue.id);
                  }}
                  onFocus={() => focusedId !== row.issue.id && setFocusedId(row.issue.id)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
