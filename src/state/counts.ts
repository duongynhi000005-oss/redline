// Counts read from Redmine for summaries (cycle progress, open issues),
// the way its own pages count: one small request each, read again when
// shown after a change or after a few minutes. See docs/architecture.md,
// "Loading".

import { useEffect, useMemo } from "react";
import { filterKey, statusIds } from "../lib/issueFilter";
import type { StatusCategory } from "../lib/model";
import type { IssueFilter, Metadata } from "../lib/types";
import { useApp } from "./app";
import type { Derived } from "./derived";

/** How many issues Redmine finds for a filter; null until read. */
export function useIssueCount(filter: IssueFilter | null): number | null {
  const key = filter ? `count:${filterKey(filter)}` : null;
  // The effect reads the filter back from this, so a new object with the same contents asks nothing.
  const asked = filter ? JSON.stringify(filter) : null;
  const value = useApp((s) =>
    key ? (s.counts.get(key)?.value ?? null) : null,
  );
  const epoch = useApp((s) => s.countEpoch);
  const requestCount = useApp((s) => s.requestCount);
  useEffect(() => {
    if (key && asked) requestCount(key, JSON.parse(asked) as IssueFilter);
  }, [key, asked, epoch, requestCount]);
  return value;
}

/** Open (or closed) issues in a project and its sub-projects. */
export function projectIssues(projectId: number, open: boolean): IssueFilter {
  return {
    projectId,
    conditions: [{ field: "status_id", op: open ? "o" : "c", values: [] }],
  };
}

export interface CycleProgress {
  total: number;
  done: number;
  started: number;
}

/**
 * How far along a cycle is: its issues apart from canceled ones, and how
 * many are done or started. Null until Redmine has said. `withStarted`
 * false skips the started count, for lists of cycles, where a request saved
 * per row matters more than the bar's middle part.
 */
export function useCycleProgress(
  versionId: number | null,
  d: Derived,
  meta: Metadata | null,
  withStarted = true,
): CycleProgress | null {
  const filters = useMemo(() => {
    if (versionId === null || !meta) return null;
    const version = {
      field: "fixed_version_id",
      op: "=",
      values: [String(versionId)],
    };
    const ids = (c: StatusCategory[]) => statusIds(c, d, meta);
    const canceled = ids(["canceled"]);
    const among = (statuses: string[]): IssueFilter | null =>
      statuses.length
        ? {
            conditions: [
              version,
              { field: "status_id", op: "=", values: statuses },
            ],
          }
        : null;
    return {
      total: {
        conditions: [
          version,
          canceled.length
            ? { field: "status_id", op: "!", values: canceled }
            : { field: "status_id", op: "*", values: [] },
        ],
      },
      done: among(ids(["completed"])),
      started: withStarted ? among(ids(["started"])) : null,
    } satisfies {
      total: IssueFilter;
      done: IssueFilter | null;
      started: IssueFilter | null;
    };
  }, [versionId, d, meta, withStarted]);
  const total = useIssueCount(filters?.total ?? null);
  const done = useIssueCount(filters?.done ?? null);
  const started = useIssueCount(filters?.started ?? null);
  if (!filters || total === null) return null;
  return {
    total,
    done: filters.done ? (done ?? 0) : 0,
    started: filters.started ? (started ?? 0) : 0,
  };
}
