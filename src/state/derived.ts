import { useMemo } from "react";
import type { CategoryMap, PriorityLevel, StatusCategory } from "../lib/model";
import { CATEGORY_ORDER, categoryMap, issueCategory, priorityLevels, teamOf } from "../lib/model";
import type { Issue, Metadata, Project } from "../lib/types";
import type { Route } from "./app";
import { useApp } from "./app";

export interface Derived {
  categories: CategoryMap;
  priorities: Map<number, PriorityLevel>;
  projects: Map<number, Project>;
  /** Top-level projects, alphabetically. */
  teams: Project[];
  /** Subprojects of each team, at any depth. */
  teamProjects: Map<number, Project[]>;
}

export function derive(meta: Metadata): Derived {
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
  return {
    categories: categoryMap(meta),
    priorities: priorityLevels(meta.priorities),
    projects,
    teams,
    teamProjects,
  };
}

const EMPTY: Derived = {
  categories: new Map(),
  priorities: new Map(),
  projects: new Map(),
  teams: [],
  teamProjects: new Map(),
};

export function useDerived(): Derived {
  const meta = useApp((s) => s.meta);
  return useMemo(() => (meta ? derive(meta) : EMPTY), [meta]);
}

/** Priority order for sorting: Urgent, High, Medium, Low, then no priority. */
const PRIORITY_RANK: Record<PriorityLevel, number> = { 4: 0, 3: 1, 2: 2, 1: 3, 0: 4 };

export function compareIssues(a: Issue, b: Issue, d: Derived): number {
  const pa = PRIORITY_RANK[d.priorities.get(a.priority.id) ?? 0];
  const pb = PRIORITY_RANK[d.priorities.get(b.priority.id) ?? 0];
  if (pa !== pb) return pa - pb;
  return b.updated_on.localeCompare(a.updated_on);
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
  const projectTree = (rootId: number) => {
    const ids = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of d.projects.values()) {
        if (p.parent && ids.has(p.parent.id) && !ids.has(p.id)) {
          ids.add(p.id);
          grew = true;
        }
      }
    }
    return ids;
  };
  const inProject = route.view === "project" ? projectTree(route.projectId) : null;
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
    }
  }
  return out;
}

export interface IssueGroup {
  category: StatusCategory;
  issues: Issue[];
}

export function groupByCategory(issues: Issue[], d: Derived): IssueGroup[] {
  const groups = new Map<StatusCategory, Issue[]>();
  for (const issue of issues) {
    const cat = issueCategory(issue, d.categories);
    let list = groups.get(cat);
    if (!list) groups.set(cat, (list = []));
    list.push(issue);
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => ({
    category,
    issues: groups.get(category)!.sort((a, b) => compareIssues(a, b, d)),
  }));
}

export function routeTitle(route: Route, d: Derived): string {
  switch (route.view) {
    case "my-issues":
      return "My issues";
    case "team":
      return d.projects.get(route.teamId)?.name ?? "Team";
    case "project":
      return d.projects.get(route.projectId)?.name ?? "Project";
  }
}
