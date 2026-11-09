import { useMemo } from "react";
import { useApp } from "../state/app";
import { routeTitle, teamCycles, useDerived } from "../state/derived";
import { Icon } from "./icons";

function dateLabel(iso: string | null | undefined) {
  if (!iso) return "No due date";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function CycleList({ teamId }: { teamId: number }) {
  const issues = useApp((s) => s.issues);
  const meta = useApp((s) => s.meta);
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const d = useDerived();
  const cycles = useMemo(() => (meta ? teamCycles(teamId, issues.values(), d, meta) : []), [teamId, issues, d, meta]);
  const open = cycles.filter((c) => c.version.status !== "closed");
  const closed = cycles.filter((c) => c.version.status === "closed").reverse();

  const row = (c: (typeof cycles)[number]) => {
    const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
    return (
      <li key={c.version.id}>
        <button
          type="button"
          className="cycle-row"
          onClick={() => navigate({ view: "cycle", teamId, versionId: c.version.id })}
        >
          <Icon name="cycle" />
          <span className="cycle-name">{c.version.name}</span>
          {c.current && <span className="chip chip-current">Current</span>}
          <span className="cycle-dates">{dateLabel(c.version.due_date)}</span>
          <span
            className="cycle-progress"
            role="progressbar"
            aria-label={`${c.version.name} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span className="cycle-progress-done" style={{ width: `${pct}%` }} />
            <span
              className="cycle-progress-started"
              style={{ width: `${c.total ? Math.round((c.started / c.total) * 100) : 0}%` }}
            />
          </span>
          <span className="cycle-count">
            {c.done} of {c.total} done
          </span>
        </button>
      </li>
    );
  };

  return (
    <section className="main" aria-label={routeTitle(route, d)}>
      <header className="main-header" data-tauri-drag-region>
        <h1>{routeTitle(route, d)}</h1>
        <span className="count">{cycles.length}</span>
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
