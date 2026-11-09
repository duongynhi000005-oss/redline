import { Command } from "cmdk";
import { useEffect, useMemo, useState } from "react";
import { issueCategory } from "../lib/model";
import { matchesShortcut, shortcutLabel } from "../lib/platform";
import type { PickerKind, Route } from "../state/app";
import { routeKey, targetIssueId, useApp } from "../state/app";
import { LAYOUTS } from "../lib/views";
import { RELATION_CHOICES } from "../lib/relations";
import { canManageVersions, cycleProjects } from "./Cycle";
import { ISSUE_SHORTCUTS, bulkCommand, issueCommandAvailable, runIssueCommand, runIssueCommandOn } from "./useIssueShortcuts";
import { useDerived } from "../state/derived";
import type { IconName } from "./icons";
import { issueActions } from "./IssueActions";
import { Icon, StatusIcon } from "./icons";
import { fieldEnabled, moveTargets } from "../lib/edit";

interface Action {
  id: string;
  label: string;
  group: string;
  icon?: React.ReactNode;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

const MAX_ISSUES = 30;

/** True when every word of the query appears in the text. */
export function matchesQuery(text: string, query: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPaletteOpen);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (matchesShortcut(e, "mod+k")) {
        e.preventDefault();
        const s = useApp.getState();
        // The menu would land on top of a dialog and act on the view behind it.
        if (s.composerOpen || s.settingsOpen) return;
        setOpen(!s.paletteOpen);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command menu"
      shouldFilter={false}
      overlayClassName="palette-overlay"
      contentClassName="palette"
    >
      {/* Mounted only while open, so each opening starts with an empty query. */}
      <PaletteContent />
    </Command.Dialog>
  );
}

function PaletteContent() {
  const setOpen = useApp((s) => s.setPaletteOpen);
  const navigate = useApp((s) => s.navigate);
  const openIssue = useApp((s) => s.openIssue);
  const syncNow = useApp((s) => s.syncNow);
  const signOut = useApp((s) => s.signOut);
  const setComposerOpen = useApp((s) => s.setComposerOpen);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const openFilterMenu = useApp((s) => s.openFilterMenu);
  const updateView = useApp((s) => s.updateView);
  const route = useApp((s) => s.route);
  const detailOpen = useApp((s) => s.openIssueId !== null);
  const issues = useApp((s) => s.issues);
  const meta = useApp((s) => s.meta);
  const target = useApp((s) => targetIssueId(s));
  // Several picked issues, when no issue is open: commands then change them all.
  const selection = useApp((s) => (s.openIssueId === null && s.selection.length > 1 ? s.selection : null));
  const d = useDerived();
  const [query, setQuery] = useState("");

  const actions = useMemo<Action[]>(() => {
    const go = (route: Route) => () => navigate(route);
    const list: Action[] = [
      { id: "new-issue", label: "Create new issue", group: "Issues", shortcut: "c", run: () => setComposerOpen(true) },
    ];
    // Lists of issues can be filtered; the inbox, cycle overview and search can't.
    if (route.view !== "inbox" && route.view !== "cycles" && route.view !== "time" && route.view !== "search" && !detailOpen) {
      list.push({
        id: "filter",
        label: "Filter…",
        group: "Issues",
        shortcut: "f",
        icon: <Icon name="filter" />,
        run: () => openFilterMenu(null),
      });
      for (const l of LAYOUTS) {
        list.push({
          id: `layout-${l.value}`,
          label: `Show as ${l.label.toLowerCase()}`,
          group: "View",
          shortcut: l.shortcut,
          keywords:
            l.value === "board"
              ? "kanban columns"
              : l.value === "timeline"
                ? "gantt roadmap schedule dates"
                : l.value === "calendar"
                  ? "month due dates"
                  : "rows",
          icon: <Icon name={l.value} />,
          run: () => updateView(routeKey(route), { layout: l.value }),
        });
      }
    }
    // Cycles are Redmine versions: made, changed and closed from the team's cycles.
    if (route.view === "cycles" || route.view === "cycle") {
      const teamId = route.teamId;
      if (cycleProjects(meta, teamId).length > 0)
        list.push({
          id: "cycle-new",
          label: "New cycle…",
          group: "Cycles",
          icon: <Icon name="plus" />,
          keywords: "version sprint milestone roadmap create",
          run: () => useApp.getState().openVersionDialog(teamId),
        });
      const version = route.view === "cycle" ? meta?.versions.find((v) => v.id === route.versionId) : undefined;
      if (version && canManageVersions(meta, version.project.id)) {
        list.push({
          id: "cycle-edit",
          label: "Edit cycle…",
          group: "Cycles",
          icon: <Icon name="edit" />,
          keywords: "version sprint rename due date wiki sharing delete",
          run: () => useApp.getState().openVersionDialog(teamId, version),
        });
        const closing = version.status !== "closed";
        list.push({
          id: "cycle-close",
          label: closing ? "Close cycle" : "Reopen cycle",
          group: "Cycles",
          icon: <Icon name="cycle" />,
          keywords: "version sprint status complete",
          run: () => void useApp.getState().saveVersion({ id: version.id }, { status: closing ? "closed" : "open" }),
        });
      }
    }
    if (selection) {
      const group = `${selection.length} selected issues`;
      for (const s of ISSUE_SHORTCUTS) {
        if (!bulkCommand(s.kind)) continue;
        list.push({
          id: `bulk-${s.kind}`,
          label: s.label,
          group,
          shortcut: s.shortcut,
          run: () => runIssueCommandOn(s.kind, selection),
        });
      }
      list.push({
        id: "bulk-clear",
        label: "Clear selection",
        group,
        icon: <Icon name="close" />,
        keywords: "deselect unselect",
        run: () => useApp.getState().setSelection([]),
      });
    } else if (target !== null) {
      for (const s of ISSUE_SHORTCUTS) {
        if (!issueCommandAvailable(s.kind, target)) continue;
        list.push({
          id: `issue-${s.kind}`,
          label: s.label,
          group: `Issue #${target}`,
          shortcut: s.shortcut,
          run: () => runIssueCommand(s.kind, target),
        });
      }
      const issue = issues.get(target);
      if (issue && meta) {
        const on = (field: string) => fieldEnabled(meta, issue.tracker.id, field);
        const project = meta.projects.find((p) => p.id === issue.project.id);
        const more: { kind: PickerKind; label: string; icon: IconName; keywords: string; show: boolean }[] = [
          {
            kind: "tracker",
            label: "Change tracker…",
            icon: "tracker",
            keywords: "type bug feature",
            show: (project?.trackers.length ?? 0) > 1,
          },
          {
            kind: "category",
            label: "Change category…",
            icon: "category",
            keywords: "component area",
            show: on("category_id") && (project?.issue_categories.length ?? 0) > 0,
          },
          {
            kind: "project",
            label: "Move to project…",
            icon: "project",
            keywords: "move transfer",
            show: moveTargets(meta).length > 1,
          },
          {
            kind: "done",
            label: "Change % done…",
            icon: "done",
            keywords: "progress percent done ratio",
            show: on("done_ratio"),
          },
        ];
        for (const m of more) {
          if (!m.show) continue;
          list.push({
            id: `issue-${m.kind}`,
            label: m.label,
            group: `Issue #${target}`,
            icon: <Icon name={m.icon} />,
            keywords: m.keywords,
            run: () => useApp.getState().openPicker(m.kind, target),
          });
        }
      }
      list.push({
        id: "issue-subscribers",
        label: "Change subscribers…",
        group: `Issue #${target}`,
        icon: <Icon name="bell" />,
        keywords: "watchers watch notify",
        run: () => useApp.getState().openPicker("subscribers", target),
      });
      const actions = issue ? issueActions(meta, issue) : null;
      if (actions?.duplicate)
        list.push({
          id: "issue-duplicate",
          label: "Duplicate issue",
          group: `Issue #${target}`,
          icon: <Icon name="copy" />,
          keywords: "copy clone",
          run: () => void useApp.getState().duplicateIssue(target),
        });
      if (actions?.delete)
        list.push({
          id: "issue-delete",
          label: "Delete issue…",
          group: `Issue #${target}`,
          icon: <Icon name="trash" />,
          keywords: "remove destroy",
          run: () => useApp.getState().openDeleteDialog(target),
        });
      for (const c of RELATION_CHOICES) {
        list.push({
          id: `issue-relate-${c.choice}`,
          label: c.label,
          group: `Issue #${target}`,
          icon: <Icon name={c.choice === "sub-issue" || c.choice === "parent" ? "sub-issue" : "relation"} />,
          keywords: "relation link connect",
          run: () => useApp.getState().openPicker("relation", target, c.choice),
        });
      }
    }
    list.push(
      { id: "go-inbox", label: "Go to Inbox", group: "Navigation", icon: <Icon name="inbox" />, run: go({ view: "inbox" }) },
      {
        id: "go-my",
        label: "Go to My issues",
        group: "Navigation",
        icon: <Icon name="my-issues" />,
        run: go({ view: "my-issues", tab: "assigned" }),
      },
    );
    for (const q of d.queries.values()) {
      list.push({
        id: `go-query-${q.id}`,
        label: `Go to ${q.name}`,
        group: "Navigation",
        icon: <Icon name="view" />,
        keywords: "view saved query custom query",
        run: go({ view: "query", queryId: q.id }),
      });
    }
    for (const team of d.teams) {
      list.push({
        id: `go-team-${team.id}`,
        label: `Go to ${team.name}`,
        group: "Navigation",
        icon: <Icon name="issues" />,
        keywords: team.identifier,
        run: go({ view: "team", teamId: team.id, tab: "active" }),
      });
      list.push({
        id: `go-cycles-${team.id}`,
        label: `Go to ${team.name} cycles`,
        group: "Navigation",
        icon: <Icon name="cycle" />,
        run: go({ view: "cycles", teamId: team.id }),
      });
      if (d.teamTime.has(team.id))
        list.push({
          id: `go-time-${team.id}`,
          label: `Go to ${team.name} time`,
          group: "Navigation",
          icon: <Icon name="time" />,
          keywords: "spent hours timesheet log",
          run: go({ view: "time", teamId: team.id }),
        });
      for (const p of d.teamProjects.get(team.id) ?? []) {
        list.push({
          id: `go-project-${p.id}`,
          label: `Go to ${p.name}`,
          group: "Navigation",
          icon: <Icon name="project" />,
          keywords: `${team.name} ${p.identifier}`,
          run: go({ view: "project", projectId: p.id }),
        });
      }
    }
    list.push(
      { id: "settings", label: "Open settings", group: "Redline", shortcut: "mod+,", run: () => setSettingsOpen(true) },
      { id: "sync", label: "Sync now", group: "Redline", icon: <Icon name="sync" />, run: () => void syncNow() },
      { id: "sign-out", label: "Sign out", group: "Redline", run: () => void signOut() },
    );
    return list;
  }, [
    d,
    navigate,
    syncNow,
    signOut,
    target,
    selection,
    setComposerOpen,
    setSettingsOpen,
    openFilterMenu,
    updateView,
    route,
    detailOpen,
    meta,
    issues,
  ]);

  const q = query.trim();
  const visibleActions = q ? actions.filter((a) => matchesQuery(`${a.label} ${a.keywords ?? ""}`, q)) : actions;
  const issueMatches = useMemo(() => {
    if (!q) return [];
    const byId = q.replace(/^#/, "");
    const out = [];
    if (/^\d+$/.test(byId)) {
      const exact = issues.get(Number(byId));
      if (exact) out.push(exact);
    }
    for (const issue of issues.values()) {
      if (out.length >= MAX_ISSUES) break;
      if (out[0]?.id === issue.id) continue;
      if (matchesQuery(`${issue.subject} #${issue.id}`, q)) out.push(issue);
    }
    return out;
  }, [q, issues]);

  const groups = [...new Set(visibleActions.map((a) => a.group))];

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <Command.Input value={query} onValueChange={setQuery} placeholder="Type a command or search issues…" />
      <Command.List>
        <Command.Empty>No results.</Command.Empty>
        {groups.map((group) => (
          <Command.Group key={group} heading={group}>
            {visibleActions
              .filter((a) => a.group === group)
              .map((a) => (
                <Command.Item key={a.id} value={a.id} onSelect={() => run(a.run)}>
                  {a.icon ?? <span className="palette-icon-space" />}
                  <span className="palette-label">{a.label}</span>
                  {a.shortcut && <kbd>{shortcutLabel(a.shortcut)}</kbd>}
                </Command.Item>
              ))}
          </Command.Group>
        ))}
        {issueMatches.length > 0 && (
          <Command.Group heading="Issues">
            {issueMatches.map((issue) => (
              <Command.Item key={issue.id} value={`open-${issue.id}`} onSelect={() => run(() => openIssue(issue.id))}>
                <StatusIcon category={issueCategory(issue, d.categories)} />
                <span className="palette-id">#{issue.id}</span>
                <span className="palette-label">{issue.subject}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {q && (
          <Command.Group heading="Redmine">
            <Command.Item value="search-redmine" onSelect={() => run(() => navigate({ view: "search", text: q }))}>
              <Icon name="search" />
              <span className="palette-label">Search Redmine for “{q}”</span>
            </Command.Item>
          </Command.Group>
        )}
      </Command.List>
    </>
  );
}
