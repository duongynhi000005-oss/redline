import { useMemo } from "react";
import { useApp } from "../state/app";
import { useCycleProgress } from "../state/counts";
import type { CycleSummary, Derived } from "../state/derived";
import { routeTitle, teamCycles, useDerived } from "../state/derived";
import type { Metadata } from "../lib/types";
import { canManageVersions, cycleProjects } from "./Cycle";
import { Icon } from "./icons";
import { OpenInRedmineButton } from "./OpenInRedmine";

function dateLabel(iso: string | null | undefined) {
  if (!iso) return "No due date";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CycleList({ teamId }: { teamId: number }) {
  const meta = useApp((s) => s.meta);
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const openVersionDialog = useApp((s) => s.openVersionDialog);
  const d = useDerived();
  const cycles = useMemo(
    () => (meta ? teamCycles(teamId, d, meta) : []),
    [teamId, d, meta],
  );
  const open = cycles.filter((c) => c.version.status !== "closed");
  const closed = cycles.filter((c) => c.version.status === "closed").reverse();
  const canCreate = useMemo(
    () => cycleProjects(meta, teamId).length > 0,
    [meta, teamId],
  );

  const row = (c: (typeof cycles)[number]) => {
    return (
      <li key={c.version.id}>
        <button
          type="button"
          className="cycle-row"
          onClick={() =>
            navigate({ view: "cycle", teamId, versionId: c.version.id })
          }
        >
          <Icon name="cycle" />
          <span className="cycle-row-meta">
            <span className="cycle-name">{c.version.name}</span>
            {c.version.description && (
              <span className="cycle-row-description">
                {c.version.description}
              </span>
            )}
          </span>
          {c.current && <span className="chip chip-current">Current</span>}
          {c.version.status === "locked" && (
            <span className="chip cycle-status-locked">Locked</span>
          )}
          <span className="cycle-dates">{dateLabel(c.version.due_date)}</span>
          {c.version.status === "closed" ? (
            <span className="cycle-count muted">Closed</span>
          ) : (
            <CycleRowProgress cycle={c} d={d} meta={meta} />
          )}
        </button>
        {canManageVersions(meta, c.version.project.id) && (
          <span className="cycle-row-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={`Edit ${c.version.name}`}
              title="Edit cycle"
              onClick={() => openVersionDialog(teamId, c.version)}
            >
              <Icon name="edit" size={14} />
            </button>
          </span>
        )}
      </li>
    );
  };

  return (
    <section className="main" aria-label={routeTitle(route, d)}>
      <header className="main-header" data-tauri-drag-region>
        <h1>{routeTitle(route, d)}</h1>
        <span className="count">{cycles.length}</span>
        <span className="header-spacer" />
        {canCreate && (
          <button
            type="button"
            className="header-button"
            onClick={() => openVersionDialog(teamId)}
          >
            <Icon name="plus" size={12} />
            <span>New cycle</span>
          </button>
        )}
        <OpenInRedmineButton />
      </header>
      <div className="cycle-scroll">
        {cycles.length === 0 ? (
          <div className="empty-state">
            <p>No cycles yet.</p>
            <p className="muted">Versions in Redmine show up here as cycles.</p>
          </div>
        ) : (
          <>
            {open.length > 0 && <ul className="cycle-list">{open.map(row)}</ul>}
            {closed.length > 0 && (
              <>
                <h2 className="cycle-section">Past cycles</h2>
                <ul className="cycle-list">{closed.map(row)}</ul>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** An open cycle's progress, counted by Redmine; past cycles aren't counted, to keep requests down. */
function CycleRowProgress({
  cycle,
  d,
  meta,
}: {
  cycle: CycleSummary;
  d: Derived;
  meta: Metadata | null;
}) {
  const progress = useCycleProgress(cycle.version.id, d, meta, false);
  const pct = progress?.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  const startedPct = progress?.total
    ? Math.round((progress.started / progress.total) * 100)
    : 0;
  return (
    <>
      <span
        className="cycle-progress"
        role="progressbar"
        aria-label={`${cycle.version.name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="cycle-progress-done" style={{ width: `${pct}%` }} />
        <span
          className="cycle-progress-started"
          style={{ width: `${startedPct}%` }}
        />
      </span>
      <span className="cycle-count">
        {progress ? `${progress.done} of ${progress.total} done` : "…"}
      </span>
    </>
  );
}
