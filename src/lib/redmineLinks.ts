import type { Route } from "../state/app";
import type { Metadata } from "./types";

/** Percent-encodes a path part or query value, including the marks encodeURIComponent leaves. */
export function encodePart(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The page in Redmine that shows what a view shows, as a path on the server,
 * so every view can be opened in the browser. Null when the view's team is gone.
 */
export function redminePathOf(route: Route, meta: Metadata | null): string | null {
  const project = (id: number | null | undefined) => meta?.projects.find((p) => p.id === id);
  const under = (id: number, page = "") => {
    const p = project(id);
    return p ? `projects/${p.identifier}${page}` : null;
  };
  switch (route.view) {
    case "inbox":
      return "my/page";
    case "my-issues":
      return route.tab === "assigned"
        ? "issues?set_filter=1&assigned_to_id=me&status_id=o"
        : "issues?set_filter=1&author_id=me&status_id=*";
    case "team":
      return under(route.teamId, "/issues");
    case "project":
      return under(route.projectId, "/issues");
    case "overview":
      return under(route.projectId);
    case "cycles":
      return under(route.teamId, "/roadmap");
    case "cycle":
      return `versions/${route.versionId}`;
    case "time":
      return under(route.teamId, "/time_entries");
    case "wiki":
      return under(route.projectId, route.title ? `/wiki/${encodePart(route.title)}` : "/wiki");
    case "news":
      if (route.newsId !== null) return `news/${route.newsId}`;
      return route.projectId === null ? "news" : under(route.projectId, "/news");
    case "files":
      return under(route.projectId, "/files");
    case "activity":
      return under(route.projectId, "/activity");
    case "documents":
      return under(route.projectId, "/documents");
    case "forums":
      return under(route.projectId, "/boards");
    case "query": {
      const q = meta?.queries?.find((x) => x.id === route.queryId);
      const inProject = q?.project_id ? under(q.project_id, "/issues") : null;
      return `${inProject ?? "issues"}?query_id=${route.queryId}`;
    }
    case "search":
      return route.text.trim() ? `search?q=${encodePart(route.text.trim())}` : "search";
  }
}
