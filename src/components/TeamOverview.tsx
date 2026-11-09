import { useMemo } from "react";
import { projectTree, teamOf } from "../lib/model";
import { allowed, documentsAccess, filesAccess, forumsAccess, newsAccess, wikiAccess } from "../lib/permissions";
import type { Layout } from "../lib/views";
import type { Membership, Metadata, Project } from "../lib/types";
import type { Route } from "../state/app";
import { useApp } from "../state/app";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./icons";
import { OpenInRedmineButton } from "./OpenInRedmine";
import { Markdown } from "./Markdown";
import { MenuButton, type MenuItem } from "./Menu";
import { PersonButton } from "./PersonCard";
import { Property } from "./Properties";

/** Where one of a project's Redmine modules lives: a Redline view, or a page in Redmine. */
export interface Area {
  module: string;
  label: string;
  icon: IconName;
  /** A Redline view, or failing that, a path on the Redmine server. */
  route?: Route;
  layout?: Layout;
  path?: string;
}

const AREAS: Record<string, { label: string; icon: IconName; page?: string }> = {
  issue_tracking: { label: "Issues", icon: "issues" },
  time_tracking: { label: "Time", icon: "time" },
  calendar: { label: "Calendar", icon: "calendar" },
  gantt: { label: "Gantt", icon: "timeline" },
  wiki: { label: "Wiki", icon: "wiki", page: "wiki" },
  news: { label: "News", icon: "news", page: "news" },
  files: { label: "Files", icon: "file", page: "files" },
  documents: { label: "Documents", icon: "file", page: "documents" },
  boards: { label: "Forums", icon: "forum", page: "boards" },
  repository: { label: "Repository", icon: "repository", page: "repository" },
};

/** A project's issue list: the team's own list for a team, the project's for a sub-team. */
export function issuesRoute(project: Project): Route {
  return project.parent ? { view: "project", projectId: project.id } : { view: "team", teamId: project.id, tab: "all" };
}

/** The project's enabled modules, each with where it opens. Unknown modules open the project in Redmine. */
export function areasOf(project: Project, meta: Metadata): Area[] {
  const team = teamOf(project.id, meta);
  // Redmine's Activity isn't a module; every project has it.
  const out: Area[] = [{ module: "activity", label: "Activity", icon: "activity", route: { view: "activity", projectId: project.id } }];
  for (const { name } of project.enabled_modules) {
    const known = AREAS[name];
    const label = known?.label ?? name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    const icon = known?.icon ?? "external";
    const base = `projects/${project.identifier}`;
    if (name === "issue_tracking") {
      out.push({ module: name, label, icon, route: issuesRoute(project) });
      if (meta.versions.some((v) => v.project.id === project.id))
        out.push({ module: "versions", label: "Cycles", icon: "cycle", route: { view: "cycles", teamId: team } });
    } else if (name === "time_tracking") {
      out.push({ module: name, label, icon, route: { view: "time", teamId: team } });
    } else if (name === "wiki" && wikiAccess(meta, project.id).view) {
      out.push({ module: name, label, icon, route: { view: "wiki", projectId: project.id, title: null } });
    } else if (name === "news" && newsAccess(meta, project.id).view) {
      out.push({ module: name, label, icon, route: { view: "news", projectId: project.id, newsId: null } });
    } else if (name === "files" && filesAccess(meta, project.id).view) {
      out.push({ module: name, label, icon, route: { view: "files", projectId: project.id } });
    } else if (name === "documents" && documentsAccess(meta, project.id).view) {
      out.push({ module: name, label, icon, route: { view: "documents", projectId: project.id } });
    } else if (name === "boards" && forumsAccess(meta, project.id).view) {
      out.push({ module: name, label, icon, route: { view: "forums", projectId: project.id } });
    } else if (name === "calendar" || name === "gantt") {
      out.push({ module: name, label, icon, route: issuesRoute(project), layout: name === "calendar" ? "calendar" : "timeline" });
    } else {
      out.push({ module: name, label, icon, path: known?.page ? `${base}/${known.page}` : base });
    }
  }
  return out;
}

/** Members by role, roles in Redmine's order; a member with two roles shows under both. */
export function membersByRole(memberships: Membership[], meta: Metadata): { role: string; members: Membership[] }[] {
  const order = new Map((meta.roles ?? []).map((r, i) => [r.id, i]));
  const groups = new Map<number, { role: string; members: Membership[] }>();
  for (const m of memberships) {
    for (const r of m.roles) {
      const g = groups.get(r.id) ?? { role: r.name, members: [] };
      if (!g.members.includes(m)) g.members.push(m);
      groups.set(r.id, g);
    }
  }
  const name = (m: Membership) => m.user?.name ?? m.group?.name ?? "";
  return [...groups.entries()]
    .sort(([a, x], [b, y]) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || x.role.localeCompare(y.role))
    .map(([, g]) => ({ ...g, members: [...g.members].sort((a, b) => name(a).localeCompare(name(b))) }));
}

/** What the user may do to a team, as far as Redline knows. A closed team is read-only: it can only be reopened or deleted. */
export function teamActions(meta: Metadata, project: Project) {
  const may = (permission: string) => allowed(meta, project.id, permission) !== false;
  const closed = project.status === 5;
  const parentClosed = project.parent ? meta.projects.find((p) => p.id === project.parent!.id)?.status === 5 : false;
  return {
    edit: !closed && may("edit_project"),
    newSubTeam: !closed && may("add_subprojects"),
    // Redmine reopens a sub-project only while its parent is open.
    close: may("close_project") && !(closed && parentClosed),
    delete: may("delete_project"),
  };
}

function TeamMenu({ project }: { project: Project }) {
  const meta = useApp((s) => s.meta)!;
  const openTeamDialog = useApp((s) => s.openTeamDialog);
  const openDeleteTeamDialog = useApp((s) => s.openDeleteTeamDialog);
  const setProjectClosed = useApp((s) => s.setProjectClosed);
  const can = teamActions(meta, project);
  const closed = project.status === 5;
  const items: MenuItem[] = [];
  if (can.edit) items.push({ label: "Edit team…", icon: "edit", run: () => openTeamDialog({ projectId: project.id }) });
  if (can.newSubTeam) items.push({ label: "New sub-team…", icon: "plus", run: () => openTeamDialog({ parentId: project.id }) });
  if (can.close)
    items.push({
      label: closed ? "Reopen team" : "Close team",
      icon: closed ? "project" : "lock",
      run: () => void setProjectClosed(project.id, !closed),
    });
  if (can.delete) items.push({ label: "Delete team…", icon: "trash", danger: true, run: () => openDeleteTeamDialog(project.id) });
  return <MenuButton label="Team actions" menuLabel="Team actions" items={items} />;
}

function projectStatus(status: number | null | undefined) {
  if (status === 5) return "Closed";
  if (status === 9) return "Archived";
  return "Active";
}

function longDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** A team's (or sub-team's) page: what it is, its sub-teams, its members and where its Redmine areas are. */
export function TeamOverview({ projectId }: { projectId: number }) {
  const meta = useApp((s) => s.meta);
  const issues = useApp((s) => s.issues);
  const navigate = useApp((s) => s.navigate);
  const updateView = useApp((s) => s.updateView);
  const openInRedmine = useApp((s) => s.openInRedmine);
  const backend = useApp((s) => s.backend);
  const showToast = useApp((s) => s.showToast);
  const project = meta?.projects.find((p) => p.id === projectId);

  const counts = useMemo(() => {
    if (!meta) return { open: 0, closed: 0 };
    const tree = projectTree(projectId, meta.projects);
    const closed = new Set(meta.statuses.filter((s) => s.is_closed).map((s) => s.id));
    let open = 0;
    let done = 0;
    for (const i of issues.values()) {
      if (!tree.has(i.project.id)) continue;
      if (closed.has(i.status.id)) done++;
      else open++;
    }
    return { open, closed: done };
  }, [meta, issues, projectId]);

  if (!meta || !project) {
    return (
      <section className="main" aria-label="Team">
        <header className="main-header" data-tauri-drag-region />
        <div className="empty-state muted">This team is gone from Redmine, or you can no longer see it.</div>
      </section>
    );
  }

  const children = meta.projects.filter((p) => p.parent?.id === project.id).sort((a, b) => a.name.localeCompare(b.name));
  const members = meta.memberships.filter((m) => m.project.id === project.id);
  const roles = membersByRole(members, meta);
  const areas = areasOf(project, meta);
  const openCount = (p: Project) => {
    const tree = projectTree(p.id, meta.projects);
    const closed = new Set(meta.statuses.filter((s) => s.is_closed).map((s) => s.id));
    let n = 0;
    for (const i of issues.values()) if (tree.has(i.project.id) && !closed.has(i.status.id)) n++;
    return n;
  };
  const go = (area: Area) => {
    if (area.route) {
      if (area.layout) updateView(area.route.view === "team" ? `team:${area.route.teamId}` : `project:${project.id}`, { layout: area.layout });
      navigate(area.route);
    } else if (area.path) {
      openInRedmine(area.path);
    }
  };
  const homepage = project.homepage?.trim();
  const status = projectStatus(project.status);

  return (
    <section className="main detail team-overview" aria-label={`${project.name} overview`}>
      <header className="main-header" data-tauri-drag-region>
        <span className="breadcrumb">
          {project.parent && (
            <>
              <button
                type="button"
                className="link-button"
                onClick={() => navigate({ view: "overview", projectId: project.parent!.id })}
              >
                {project.parent.name}
              </button>
              <Icon name="chevron-right" size={12} />
            </>
          )}
          {project.name}
        </span>
        <span className="header-spacer" data-tauri-drag-region />
        <OpenInRedmineButton />
        <TeamMenu project={project} />
      </header>
      <div className="detail-body">
        <div className="detail-content">
          <div className="team-title">
            <span className="team-mark team-mark-large" aria-hidden>
              {project.identifier.slice(0, 1).toUpperCase()}
            </span>
            <h1 className="detail-title">{project.name}</h1>
            {status !== "Active" && <span className="chip chip-plain">{status}</span>}
          </div>
          {project.description ? <Markdown text={project.description} /> : <p className="muted">No description.</p>}

          {children.length > 0 && (
            <section className="connections" aria-label="Sub-teams">
              <header className="connections-header">
                <h2>Sub-teams</h2>
                <span className="count">{children.length}</span>
              </header>
              <ul className="linked-issues">
                {children.map((c) => (
                  <li key={c.id} className="linked-issue">
                    <button
                      type="button"
                      className="linked-issue-open"
                      onClick={() => navigate({ view: "overview", projectId: c.id })}
                    >
                      <Icon name="project" />
                      <span className="linked-issue-subject">{c.name}</span>
                      {c.status === 5 && <span className="chip chip-plain">Closed</span>}
                      <span className="muted team-open-count">{openCount(c)} open</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="connections" aria-label="Members">
            <header className="connections-header">
              <h2>Members</h2>
              {members.length > 0 && <span className="count">{members.length}</span>}
            </header>
            {roles.length === 0 ? (
              <p className="muted connections-empty">Redmine lists no members here, or your role can't see them.</p>
            ) : (
              roles.map((g) => (
                <div key={g.role} className="connection-group">
                  <h3>{g.role}</h3>
                  <ul className="team-members">
                    {g.members.map((m) => (
                      <li key={m.id}>
                        {m.user ? (
                          <PersonButton userId={m.user.id} name={m.user.name} className="team-member">
                            <Avatar name={m.user.name} size={20} />
                            <span>{m.user.name}</span>
                          </PersonButton>
                        ) : (
                          <span className="team-member">
                            <Icon name="people" />
                            <span>{m.group?.name}</span>
                            <span className="muted">Group</span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>

          {areas.length > 0 && (
            <section className="connections" aria-label="Areas">
              <header className="connections-header">
                <h2>Areas</h2>
              </header>
              <ul className="team-areas">
                {areas.map((a) => (
                  <li key={a.module}>
                    <button type="button" className="team-area" onClick={() => go(a)}>
                      <Icon name={a.icon} />
                      <span>{a.label}</span>
                      {a.path && <Icon name="external" size={12} className="team-area-external" />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="detail-properties" aria-label="Properties">
          <dl>
            <Property label="Status">{status}</Property>
            <Property label="Visibility">{project.is_public === false ? "Private" : project.is_public ? "Public" : "Unknown"}</Property>
            <Property label="Identifier">
              <span className="team-identifier">{project.identifier}</span>
            </Property>
            {project.parent && (
              <Property label="Parent" action={`Open ${project.parent.name}`} onEdit={() => navigate({ view: "overview", projectId: project.parent!.id })}>
                {project.parent.name}
              </Property>
            )}
            {homepage && (
              <Property
                label="Homepage"
                action="Open homepage"
                onEdit={() =>
                  void backend
                    ?.openHomepage(project.id)
                    .catch((e: { message?: string }) => showToast(e.message ?? "Couldn't open the homepage."))
                }
              >
                <Icon name="link" size={12} />
                <span className="team-homepage">{homepage.replace(/^https?:\/\//, "")}</span>
              </Property>
            )}
            {project.created_on && <Property label="Created">{longDay(project.created_on)}</Property>}
            <Property label="Open" action="Show issues" onEdit={() => navigate(issuesRoute(project))}>
              {counts.open} {counts.open === 1 ? "issue" : "issues"}
            </Property>
            <Property label="Closed">
              {counts.closed} {counts.closed === 1 ? "issue" : "issues"}
            </Property>
          </dl>
        </aside>
      </div>
    </section>
  );
}
