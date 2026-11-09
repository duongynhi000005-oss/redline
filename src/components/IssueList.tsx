import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { issueCategory, issueLabels, hueFor, relativeTime } from "../lib/model";
import { matchesFilters } from "../lib/filters";
import { isTyping } from "../lib/platform";
import type { Issue } from "../lib/types";
import type { MyIssuesTab, Route, TeamTab } from "../state/app";
import { overlayOpen, routeKey, useApp, viewFor } from "../state/app";
import type { Derived } from "../state/derived";
import { routeTitle, useDerived } from "../state/derived";
import type { Group } from "../lib/views";
import { groupIssues } from "../lib/views";
import { DisplayMenu } from "./DisplayMenu";
import { Avatar } from "./Avatar";
import { FilterBar, useRouteIssues } from "./Filters";
import { Icon, PriorityIcon, StatusIcon } from "./icons";

type Row = { kind: "group"; group: Group; count: number } | { kind: "issue"; issue: Issue };

function GroupIcon({ icon }: { icon: Group["icon"] }) {
  switch (icon.kind) {
    case "status":
      return <StatusIcon category={icon.category} />;
    case "priority":
      return <PriorityIcon level={icon.level} />;
    case "assignee":
      return <Avatar name={icon.name} size={16} />;
    case "cycle":
      return <Icon name="cycle" />;
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

export function IssueRow({
  issue,
  d,
  focused,
  showProject,
  showCycle = true,
  onOpen,
  onFocus,
}: {
  issue: Issue;
  d: Derived;
  focused: boolean;
  showProject: boolean;
  showCycle?: boolean;
  onOpen: () => void;
  onFocus: () => void;
}) {
  const category = issueCategory(issue, d.categories);
  const labels = issueLabels(issue, d.labelFields);
  // One sentence for screen readers instead of every chip read out in turn.
  const spoken = [
    `${issue.subject}, #${issue.id}`,
    issue.status.name,
    `${issue.priority.name} priority`,
    issue.assigned_to ? `assigned to ${issue.assigned_to.name}` : "unassigned",
    ...labels.map((l) => l.value),
    showCycle && issue.fixed_version ? issue.fixed_version.name : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div
      id={`issue-row-${issue.id}`}
      role="option"
      aria-label={spoken}
      aria-selected={focused}
      className={`issue-row${focused ? " focused" : ""}`}
      onClick={onOpen}
      onMouseMove={onFocus}
    >
      <PriorityIcon level={d.priorities.get(issue.priority.id) ?? 0} title={issue.priority.name} />
      <span className="issue-id">#{issue.id}</span>
      <StatusIcon category={category} title={issue.status.name} />
      <span className="issue-subject">{issue.subject}</span>
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
  const openIssue = useApp((s) => s.openIssue);
  const overlay = useApp(overlayOpen);
  const d = useDerived();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["status:canceled"]));
  const focusedId = useApp((s) => s.focusedIssueId);
  const setFocusedId = useApp((s) => s.focusIssue);
  const openFilterMenu = useApp((s) => s.openFilterMenu);
  const view = useApp((s) => viewFor(s, routeKey(s.route)));
  const filters = view.filters;
  const meta = useApp((s) => s.meta);
  const me = useApp((s) => s.account?.userId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const base = useRouteIssues(route);
  const groups = useMemo(
    () =>
      meta
        ? groupIssues(
            filters.length ? base.filter((i) => matchesFilters(i, filters, d)) : base,
            view.grouping,
            view.ordering,
            d,
            meta,
            me,
          )
        : [],
    [base, filters, view.grouping, view.ordering, d, meta, me],
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
  const total = groups.reduce((n, g) => n + g.issues.length, 0);

  // TanStack Virtual returns fresh functions each render, so the React
  // Compiler skips this component; that's expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === "group" ? GROUP_HEIGHT : ROW_HEIGHT),
    overscan: 12,
  });

  // Keyboard: ↑/↓ or j/k move, Enter opens.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (overlay || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "f" && !e.shiftKey) {
        e.preventDefault();
        openFilterMenu(null);
        return;
      }
      if (!issueRows.length) return;
      const pos = issueRows.findIndex((r) => r.id === focusedId);
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
      // Screen readers follow aria-activedescendant only while the list has focus.
      if (scrollRef.current && !scrollRef.current.contains(document.activeElement)) {
        scrollRef.current.focus({ preventScroll: true });
      }
      const target = issueRows[next]!;
      setFocusedId(target.id);
      virtualizer.scrollToIndex(target.index, { align: "auto" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [issueRows, focusedId, overlay, openFilterMenu, openIssue, setFocusedId, virtualizer]);

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
    <section className="main" aria-label={routeTitle(route, d)}>
      <header className="main-header" data-tauri-drag-region>
        <h1>{routeTitle(route, d)}</h1>
        <span className="count">{total}</span>
        <Tabs route={route} />
        <span className="header-spacer" />
        <button type="button" className="header-button" title="Filter (F)" onClick={() => openFilterMenu(null)}>
          <Icon name="filter" />
          <span>Filter</span>
        </button>
        <DisplayMenu route={route} />
      </header>
      <FilterBar route={route} shown={total} total={base.length} />
      {total === 0 && filters.length ? (
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
                : "Nothing matches this view yet."}
          </p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="issue-scroll"
          role="listbox"
          aria-label="Issues"
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
                      showProject={
                        route.view === "my-issues" ||
                        ((route.view === "team" || route.view === "cycle") && row.issue.project.id !== route.teamId)
                      }
                      showCycle={route.view !== "cycle"}
                      onOpen={() => openIssue(row.issue.id)}
                      onFocus={() => focusedId !== row.issue.id && setFocusedId(row.issue.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
