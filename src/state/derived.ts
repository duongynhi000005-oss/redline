import { useMemo } from "react";
import type { CategoryMap, PriorityLevel, StatusCategory } from "../lib/model";
import { categoryMap, issueCategory, priorityLevels, projectTree, teamOf } from "../lib/model";
import { moduleEnabled, timeAccess } from "../lib/permissions";
import type { Issue, Metadata, Project, SavedQuery, Version } from "../lib/types";
import type { ServerSettings } from "../lib/settings";
import { DEFAULT_SETTINGS } from "../lib/settings";
import type { Route } from "./app";
import { useApp } from "./app";

export interface Derived {
  categories: CategoryMap;
  /** Custom fields shown as labels; null means every multi-value field. */
  labelFields: Set<number> | null;
  priorities: Map<number, PriorityLevel>;
  projects: Map<number, Project>;
  versions: Map<number, Version>;
  /** Top-level projects, alphabetically. */
  teams: Project[];
  /** Subprojects of each team, at any depth. */
  teamProjects: Map<number, Project[]>;
  /** Teams where the user can see time logged in at least one project. */
  teamTime: Set<number>;
  /** Saved Redmine queries, by id. */
  queries: Map<number, SavedQuery>;
}

export function derive(meta: Metadata, settings: ServerSettings = DEFAULT_SETTINGS): Derived {
  const projects = new Map(meta.projects.map((p) => [p.id, p]));
  const teams = meta.projects
    .filter((p) => !p.parent || !projects.has(p.parent.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const teamProjects = new Map<number, Project[]>(teams.map((t) => [t.id, []]));
  for (const p of meta.projects) {
    const team = teamOf(p.id, meta);
    if (team !== p.id) teamProjects.get(team)?.push(p);
  }
  teamProjects.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
  const teamTime = new Set<number>();
  for (const p of meta.projects) if (moduleEnabled(meta, p.id, "time_tracking") && timeAccess(meta, p.id).view) teamTime.add(teamOf(p.id, meta));
  return {
    categories: categoryMap(meta, settings.statusCategories),
    labelFields: settings.labelFields ? new Set(settings.labelFields) : null,
    priorities: priorityLevels(meta.priorities),
    projects,
    versions: new Map(meta.versions.map((v) => [v.id, v])),
    teams,
    teamProjects,
    teamTime,
    queries: new Map((meta.queries ?? []).map((q) => [q.id, q])),
  };
}

export interface CycleSummary {
  version: Version;
  total: number;
  done: number;
  started: number;
  current: boolean;
}

/** A team's cycles: its versions and its subprojects', soonest due first. */
export function teamCycles(teamId: number, issues: Iterable<Issue>, d: Derived, meta: Metadata, today = new Date()): CycleSummary[] {
  const versions = [...d.versions.values()].filter((v) => teamOf(v.project.id, meta) === teamId);
  const counts = new Map<number, { total: number; done: number; started: number }>();
  for (const issue of issues) {
    const id = issue.fixed_version?.id;
    if (id === undefined || !d.versions.has(id)) continue;
    let c = counts.get(id);
    if (!c) counts.set(id, (c = { total: 0, done: 0, started: 0 }));
    const cat = issueCategory(issue, d.categories);
    if (cat === "canceled") continue;
    c.total++;
    if (cat === "completed") c.done++;
    else if (cat === "started") c.started++;
  }
  versions.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const day = today.toISOString().slice(0, 10);
  const current = versions.find((v) => v.status === "open" && (v.due_date ?? "9999") >= day);
  return versions
    .map((version) => ({ version, ...(counts.get(version.id) ?? { total: 0, done: 0, started: 0 }), current: version.id === current?.id }));
}

const EMPTY: Derived = {
  versions: new Map(),
  categories: new Map(),
  labelFields: null,
  priorities: new Map(),
  projects: new Map(),
  teams: [],
  teamProjects: new Map(),
  teamTime: new Set(),
  queries: new Map(),
};

export function useDerived(): Derived {
  const meta = useApp((s) => s.meta);
  const settings = useApp((s) => s.settings);
  return useMemo(() => (meta ? derive(meta, settings) : EMPTY), [meta, settings]);
}

const ACTIVE: StatusCategory[] = ["triage", "started", "unstarted"];

/** The issues a route shows, before grouping. */
export function issuesForRoute(
  route: Route,
  issues: Iterable<Issue>,
  d: Derived,
  userId: number | undefined,
  meta: Metadata,
): Issue[] {
  const out: Issue[] = [];
  const inProject = route.view === "project" ? projectTree(route.projectId, d.projects.values()) : null;
  for (const issue of issues) {
    switch (route.view) {
      case "my-issues":
        if (route.tab === "assigned" ? issue.assigned_to?.id === userId : issue.author?.id === userId) out.push(issue);
        break;
      case "team": {
        if (teamOf(issue.project.id, meta) !== route.teamId) break;
        const cat = issueCategory(issue, d.categories);
        if (route.tab === "active" && !ACTIVE.includes(cat)) break;
        if (route.tab === "backlog" && cat !== "backlog") break;
        out.push(issue);
        break;
      }
      case "project":
        if (inProject!.has(issue.project.id)) out.push(issue);
        break;
      case "cycle":
        if (issue.fixed_version?.id === route.versionId) out.push(issue);
        break;
      // A query's issues come from Redmine (see useRouteIssues); search isn't a list of issues.
      case "query":
      case "search":
      case "overview":
      case "cycles":
      case "time":
      case "inbox":
        break;
    }
  }
  return out;
}

/** Whether a list's rows name each issue's project: where they can come from more than one. */
export function showsProject(route: Route, projectId: number, d: Derived): boolean {
  switch (route.view) {
    case "my-issues":
      return true;
    case "team":
    case "cycle":
      return projectId !== route.teamId;
    case "query":
      return !d.queries.get(route.queryId)?.project_id;
    default:
      return false;
  }
}

export function routeTitle(route: Route, d: Derived): string {
  switch (route.view) {
    case "inbox":
      return "Inbox";
    case "my-issues":
      return "My issues";
    case "team":
      return d.projects.get(route.teamId)?.name ?? "Team";
    case "project":
      return d.projects.get(route.projectId)?.name ?? "Project";
    case "overview":
      return d.projects.get(route.projectId)?.name ?? "Team";
    case "cycles":
      return `${d.projects.get(route.teamId)?.name ?? "Team"} cycles`;
    case "time":
      return `${d.projects.get(route.teamId)?.name ?? "Team"} time`;
    case "cycle":
      return d.versions.get(route.versionId)?.name ?? "Cycle";
    case "query":
      return d.queries.get(route.queryId)?.name ?? "View";
    case "search":
      return "Search";
  }
}
