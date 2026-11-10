// Finding issues by number or subject the way Redmine's issue list does:
// one request once typing pauses, for issues Redline hasn't loaded. See
// docs/architecture.md, "Loading".

import { useEffect, useState } from "react";
import type { Issue, IssueFilter } from "../lib/types";
import { useApp } from "./app";

/** How long typing has to pause before Redline asks Redmine. */
export const SEARCH_DELAY = 300;

/** Answers kept for this session, so typing back and forth doesn't ask again. */
const answers = new Map<string, Issue[]>();
const KEPT = 30;

/** What Redmine is asked for a search: an issue number, or words in subjects. */
export function searchFilter(query: string): IssueFilter | null {
  const q = query.trim().replace(/^#/, "").trim();
  if (q.length < 2 && !/^\d+$/.test(q)) return null;
  if (/^\d+$/.test(q)) return { conditions: [{ field: "issue_id", op: "=", values: [q] }] };
  return { conditions: [{ field: "subject", op: "~", values: [q] }], sort: "updated_on:desc,id:desc" };
}

/**
 * Issues Redmine finds for what's typed, once typing pauses; empty until
 * then. Callers show the issues Redline already holds at once, and add these.
 */
export function useIssueSearch(query: string, enabled = true): { found: Issue[]; searching: boolean } {
  const backend = useApp((s) => s.backend);
  // Answers belong to one account on one server.
  const who = useApp((s) => (s.account ? `${s.account.serverUrl}#${s.account.userId}` : ""));
  const filter = enabled ? searchFilter(query) : null;
  const key = filter ? JSON.stringify([who, filter]) : null;
  const [result, setResult] = useState<{ key: string; found: Issue[] } | null>(null);

  useEffect(() => {
    if (!key || !backend || answers.has(key)) return;
    let live = true;
    const timer = setTimeout(() => {
      backend
        .findIssues((JSON.parse(key) as [string, IssueFilter])[1], 0)
        .then((page) => {
          answers.set(key, page.items);
          if (answers.size > KEPT) answers.delete(answers.keys().next().value!);
          if (live) setResult({ key, found: page.items });
        })
        .catch(() => live && setResult({ key, found: [] }));
    }, SEARCH_DELAY);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, backend]);

  if (!key) return { found: [], searching: false };
  const kept = answers.get(key);
  if (kept) return { found: kept, searching: false };
  if (result?.key !== key) return { found: [], searching: true };
  return { found: result.found, searching: false };
}

/** The issues Redline holds, then those a search found that it doesn't. */
export function withFound(issues: Map<number, Issue>, found: Issue[]): Iterable<Issue> {
  const extra = found.filter((i) => !issues.has(i.id));
  return extra.length ? [...issues.values(), ...extra] : issues.values();
}
