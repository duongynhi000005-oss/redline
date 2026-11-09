import { Command } from "cmdk";
import { useEffect, useMemo, useState } from "react";
import { issueCategory } from "../lib/model";
import { matchesShortcut, shortcutLabel } from "../lib/platform";
import type { Route } from "../state/app";
import { useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { Icon, StatusIcon } from "./icons";

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
        setOpen(!useApp.getState().paletteOpen);
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
  const issues = useApp((s) => s.issues);
  const d = useDerived();
  const [query, setQuery] = useState("");

  const actions = useMemo<Action[]>(() => {
    const go = (route: Route) => () => navigate(route);
    const list: Action[] = [
      { id: "go-my", label: "Go to My issues", group: "Navigation", icon: <Icon name="my-issues" />, run: go({ view: "my-issues", tab: "assigned" }) },
    ];
    for (const team of d.teams) {
      list.push({
        id: `go-team-${team.id}`,
        label: `Go to ${team.name}`,
        group: "Navigation",
        icon: <Icon name="issues" />,
        keywords: team.identifier,
        run: go({ view: "team", teamId: team.id, tab: "active" }),
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
      { id: "sync", label: "Sync now", group: "Redline", icon: <Icon name="sync" />, run: () => void syncNow() },
      { id: "sign-out", label: "Sign out", group: "Redline", run: () => void signOut() },
    );
    return list;
  }, [d, navigate, syncNow, signOut]);

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
        {issueMatches.length > 0 && (
          <Command.Group heading="Issues">
            {issueMatches.map((issue) => (
              <Command.Item key={issue.id} value={`issue-${issue.id}`} onSelect={() => run(() => openIssue(issue.id))}>
                <StatusIcon category={issueCategory(issue, d.categories)} />
                <span className="palette-id">#{issue.id}</span>
                <span className="palette-label">{issue.subject}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
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
      </Command.List>
    </>
  );
}
