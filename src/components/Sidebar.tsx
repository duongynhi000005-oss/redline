import { useEffect, useMemo, useReducer, useState } from "react";
import { teamOf } from "../lib/model";
import { shortcutLabel } from "../lib/platform";
import type { SyncPhase } from "../lib/types";
import type { Route } from "../state/app";
import { useApp } from "../state/app";
import { useDerived } from "../state/derived";
import { Avatar } from "./Avatar";
import { Icon } from "./icons";

function sameRoute(a: Route, b: Route): boolean {
  if (a.view === "cycle" && b.view === "cycles") return a.teamId === b.teamId;
  if (a.view !== b.view) return false;
  if (a.view === "team" && b.view === "team") return a.teamId === b.teamId;
  if (a.view === "project" && b.view === "project") return a.projectId === b.projectId;
  if (a.view === "overview" && b.view === "overview") return a.projectId === b.projectId;
  if (a.view === "wiki" && b.view === "wiki") return a.projectId === b.projectId;
  if (a.view === "news" && b.view === "news") return a.projectId === b.projectId;
  if (a.view === "files" && b.view === "files") return a.projectId === b.projectId;
  if (a.view === "activity" && b.view === "activity") return a.projectId === b.projectId;
  if (a.view === "documents" && b.view === "documents") return a.projectId === b.projectId;
  if (a.view === "forums" && b.view === "forums") return a.projectId === b.projectId;
  if (a.view === "time" && b.view === "time") return a.teamId === b.teamId;
  if (a.view === "query" && b.view === "query") return a.queryId === b.queryId;
  // A cycle's issues light up the team's Cycles item.
  if ((a.view === "cycles" || a.view === "cycle") && (b.view === "cycles" || b.view === "cycle")) return a.teamId === b.teamId;
  return true;
}

function NavItem({
  route,
  icon,
  label,
  depth = 0,
  badge,
  title,
}: {
  route: Route;
  icon: React.ReactNode;
  label: string;
  depth?: number;
  badge?: string;
  title?: string;
}) {
  const current = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const active = sameRoute(current, route);
  return (
    <button
      type="button"
      className={`nav-item${active ? " active" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      aria-current={active ? "page" : undefined}
      title={title}
      onClick={() => navigate(route)}
    >
      {icon}
      <span className="nav-label">{label}</span>
      {badge && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

export const KEY_REFUSED_LABEL = "API key refused · Sign in again";

export const SLOWED_LABEL = "Slowing down for the server";

export function syncLabel(
  state: SyncPhase,
  message: string | null,
  lastSyncedAt: number | null,
  now = Date.now(),
  slowed = false,
): string {
  // Lists load as they're opened, so the server can ask to slow down between syncs too.
  if (slowed && (state === "syncing" || state === "idle")) return `${SLOWED_LABEL}…`;
  if (state === "syncing") return "Syncing…";
  if (state === "busy") return "Server is busy · Trying again soon";
  if (state === "offline") return "Offline, showing saved issues";
  if (state === "error") return message ?? "Couldn't sync";
  if (!lastSyncedAt) return "Up to date";
  const minutes = Math.floor((now - lastSyncedAt) / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  return `Synced ${new Date(lastSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function Sidebar() {
  const account = useApp((s) => s.account);
  const sync = useApp((s) => s.sync);
  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  const syncNow = useApp((s) => s.syncNow);
  const signInAgain = useApp((s) => s.signInAgain);
  const keyRefused = sync.state === "error" && sync.code === "unauthorized";
  const meta = useApp((s) => s.meta);
  const unread = useApp((s) => s.inbox.items.filter((i) => !i.read).length);
  const d = useDerived();
  const { teams, teamProjects } = d;
  // Your own views first, then shared ones, each alphabetically.
  const views = useMemo(
    () =>
      [...d.queries.values()].sort((a, b) => Number(a.is_public) - Number(b.is_public) || a.name.localeCompare(b.name)),
    [d.queries],
  );
  const hasCycles = useMemo(
    () => new Set(meta ? meta.versions.map((v) => teamOf(v.project.id, meta)) : []),
    [meta],
  );
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // Keeps "Synced 5m ago" current.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  const host = account ? new URL(account.serverUrl).host : "";

  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar-top" data-tauri-drag-region>
        <div className="workspace" title={account?.serverUrl}>
          <span className="workspace-mark" aria-hidden>
            {host.slice(0, 1).toUpperCase()}
          </span>
          <span className="workspace-name">{host}</span>
          <Avatar name={account?.name} size={20} />
        </div>
        <button type="button" className="search-button" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" />
          <span>Search</span>
          <kbd>{shortcutLabel("mod+k")}</kbd>
        </button>
      </div>

      <div className="sidebar-scroll">
        <NavItem
          route={{ view: "inbox" }}
          icon={<Icon name="inbox" />}
          label="Inbox"
          badge={unread ? String(unread) : undefined}
        />
        <NavItem route={{ view: "my-issues", tab: "assigned" }} icon={<Icon name="my-issues" />} label="My issues" />
        {d.news.size > 0 && <NavItem route={{ view: "news", projectId: null, newsId: null }} icon={<Icon name="news" />} label="Updates" />}

        {views.length > 0 && (
          <>
            <div className="nav-section">Views</div>
            {views.map((q) => (
              <NavItem
                key={q.id}
                route={{ view: "query", queryId: q.id }}
                icon={<Icon name="view" />}
                label={q.name}
                title={q.project_id ? `${q.name}, in ${d.projects.get(q.project_id)?.name ?? "a project"}` : undefined}
              />
            ))}
          </>
        )}

        <div className="nav-section">Your teams</div>
        {teams.map((team) => {
          const open = !collapsed.has(team.id);
          return (
            <div key={team.id} className="nav-team">
              <button
                type="button"
                className="nav-item nav-team-header"
                aria-expanded={open}
                onClick={() => toggle(team.id)}
              >
                <span className="team-mark" aria-hidden>
                  {team.identifier.slice(0, 1).toUpperCase()}
                </span>
                <span className="nav-label">{team.name}</span>
                <Icon name={open ? "chevron-down" : "chevron-right"} size={12} className="nav-chevron" />
              </button>
              {open && (
                <>
                  <NavItem
                    route={{ view: "overview", projectId: team.id }}
                    icon={<Icon name="overview" />}
                    label="Overview"
                    depth={1}
                  />
                  <NavItem
                    route={{ view: "team", teamId: team.id, tab: "active" }}
                    icon={<Icon name="issues" />}
                    label="Issues"
                    depth={1}
                  />
                  {hasCycles.has(team.id) && (
                    <NavItem
                      route={{ view: "cycles", teamId: team.id }}
                      icon={<Icon name="cycle" />}
                      label="Cycles"
                      depth={1}
                    />
                  )}
                  <NavItem
                    route={{ view: "activity", projectId: team.id }}
                    icon={<Icon name="activity" />}
                    label="Activity"
                    depth={1}
                  />
                  {d.wikis.has(team.id) && (
                    <NavItem
                      route={{ view: "wiki", projectId: team.id, title: null }}
                      icon={<Icon name="wiki" />}
                      label="Wiki"
                      depth={1}
                    />
                  )}
                  {d.news.has(team.id) && (
                    <NavItem route={{ view: "news", projectId: team.id, newsId: null }} icon={<Icon name="news" />} label="News" depth={1} />
                  )}
                  {d.files.has(team.id) && (
                    <NavItem route={{ view: "files", projectId: team.id }} icon={<Icon name="file" />} label="Files" depth={1} />
                  )}
                  {d.teamTime.has(team.id) && (
                    <NavItem route={{ view: "time", teamId: team.id }} icon={<Icon name="time" />} label="Time" depth={1} />
                  )}
                  {teamProjects.get(team.id)?.map((p) => (
                    <NavItem
                      key={p.id}
                      route={{ view: "project", projectId: p.id }}
                      icon={<Icon name="project" />}
                      label={p.name}
                      depth={1}
                    />
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className={`sync-status sync-${sync.state}`}
        onClick={() => void (keyRefused ? signInAgain() : syncNow())}
        title={
          keyRefused
            ? "Redmine no longer accepts your API key. Sign in again with a new one."
            : sync.slowed || sync.state === "busy"
              ? "Your server asked Redline to slow down, so it is pacing its requests"
              : "Sync now"
        }
        aria-live="polite"
      >
        <Icon
          name={keyRefused ? "lock" : sync.state === "offline" ? "offline" : "sync"}
          className={sync.state === "syncing" ? "spin" : ""}
        />
        {keyRefused ? (
          <span>{KEY_REFUSED_LABEL}</span>
        ) : (
          <span>{syncLabel(sync.state, sync.message, sync.lastSyncedAt, undefined, sync.slowed)}</span>
        )}
      </button>
    </nav>
  );
}
