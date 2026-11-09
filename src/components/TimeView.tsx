import { useEffect, useMemo, useState } from "react";
import { firstWeekday } from "../lib/calendar";
import { canEditTime } from "../lib/permissions";
import { shortcutLabel } from "../lib/platform";
import type { TimeGrouping, TimeRange } from "../lib/time";
import { TIME_RANGES, dayLabel, formatHours, groupTime, isoDay, rangeDays, totalHours } from "../lib/time";
import type { TimeEntry } from "../lib/types";
import { errorMessage } from "../lib/types";
import { useApp } from "../state/app";
import { routeTitle, useDerived } from "../state/derived";
import { Avatar } from "./Avatar";
import { Icon } from "./icons";
import { OpenInRedmineButton } from "./OpenInRedmine";

const GROUPINGS: { value: TimeGrouping; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "person", label: "Person" },
  { value: "issue", label: "Issue" },
];

/** Every day from one YYYY-MM-DD to another. */
function daysBetween(from: string, to: string): string[] {
  const [y, m, d] = from.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; out.length < 62; i++) {
    const day = isoDay(new Date(y!, m! - 1, d! + i));
    if (day > to) break;
    out.push(day);
  }
  return out;
}

/** The time a team logged in Redmine, by day, person or issue. */
export function TimeView({ teamId }: { teamId: number }) {
  const backend = useApp((s) => s.backend);
  const route = useApp((s) => s.route);
  const me = useApp((s) => s.account?.userId);
  const version = useApp((s) => s.timeVersion);
  const issues = useApp((s) => s.issues);
  const d = useDerived();
  const [range, setRange] = useState<TimeRange>("this-week");
  const [grouping, setGrouping] = useState<TimeGrouping>("day");
  const [onlyMine, setOnlyMine] = useState(false);
  const today = useMemo(() => new Date(), []);
  const { from, to } = useMemo(() => rangeDays(range, today, firstWeekday()), [range, today]);
  const key = `${teamId}:${from}:${to}:${onlyMine ? me : ""}:${version}`;
  const [loaded, setLoaded] = useState<{ key: string; entries?: TimeEntry[]; error?: string } | null>(null);

  useEffect(() => {
    if (!backend) return;
    let live = true;
    backend
      .timeEntries({ project_id: teamId, from, to, user_id: onlyMine ? (me ?? null) : null })
      .then((entries) => live && setLoaded({ key, entries }))
      .catch((e) => live && setLoaded({ key, error: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [backend, teamId, from, to, onlyMine, me, key]);

  const current = loaded?.key === key ? loaded : null;
  // Newest first, the way Redmine lists them.
  const entries = useMemo(
    () =>
      [...(current?.entries ?? [])].sort(
        (a, b) => b.spent_on.localeCompare(a.spent_on) || (b.created_on ?? "").localeCompare(a.created_on ?? "") || b.id - a.id,
      ),
    [current],
  );
  const issueTitle = (id: number) => {
    const issue = issues.get(id);
    return issue ? `#${id} ${issue.subject}` : `#${id}`;
  };
  const groups = groupTime(entries, grouping, today, issueTitle);
  const total = totalHours(entries);
  const days = daysBetween(from, to);
  const perDay = new Map<string, number>();
  for (const e of entries) perDay.set(e.spent_on, (perDay.get(e.spent_on) ?? 0) + e.hours);
  const busiest = Math.max(1, ...perDay.values());
  const title = routeTitle(route, d);

  return (
    <section className="main time-view" aria-label={title}>
      <header className="main-header" data-tauri-drag-region>
        <h1>{title}</h1>
        {current?.entries && <span className="count">{formatHours(total)}</span>}
        <div className="tabs" role="tablist" aria-label="Range">
          {TIME_RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              role="tab"
              aria-selected={range === r.value}
              className="tab"
              onClick={() => setRange(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="header-spacer" />
        <button
          type="button"
          className="header-button"
          aria-pressed={onlyMine}
          onClick={() => setOnlyMine(!onlyMine)}
          title="Show only the time you logged"
        >
          <Icon name="my-issues" />
          <span>Only mine</span>
        </button>
        <label className="header-button time-grouping">
          <span>Group by</span>
          <select aria-label="Group by" value={grouping} onChange={(e) => setGrouping(e.target.value as TimeGrouping)}>
            {GROUPINGS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <OpenInRedmineButton />
      </header>
      {current?.error ? (
        <div className="empty-state">
          <p>Couldn't load the time.</p>
          <p className="muted">{current.error}</p>
        </div>
      ) : !current ? (
        <div className="empty-state muted">Loading…</div>
      ) : (
        <div className="time-scroll">
          <div
            className="time-chart"
            role="img"
            aria-label={`${formatHours(total)} logged from ${dayLabel(from, today)} to ${dayLabel(to, today)}`}
          >
            {days.map((day) => {
              const hours = perDay.get(day) ?? 0;
              const weekend = [0, 6].includes(new Date(`${day}T00:00:00`).getDay());
              return (
                <div
                  key={day}
                  className={`time-bar${day === isoDay(today) ? " today" : ""}${weekend ? " weekend" : ""}`}
                  title={`${dayLabel(day, today)}: ${hours ? formatHours(hours) : "nothing"}`}
                >
                  <span className="time-bar-fill" style={{ height: `${(hours / busiest) * 100}%` }} />
                  {days.length <= 7 && (
                    <span className="time-bar-label">
                      {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {groups.length === 0 ? (
            <div className="empty-state">
              <p>No time logged {onlyMine ? "by you " : ""}in this range.</p>
              <p className="muted">Log time on an issue with {shortcutLabel("mod+shift+t")}.</p>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.key} className="time-group" aria-label={`${g.label}, ${formatHours(g.hours)}`}>
                <h2 className="group-header time-group-header">
                  {grouping === "person" && <Avatar name={g.label} size={16} />}
                  <span className="time-group-label">{g.label}</span>
                  <span className="count">{formatHours(g.hours)}</span>
                </h2>
                <ul className="time-rows">
                  {g.entries.map((e) => (
                    <TimeRow key={e.id} entry={e} grouping={grouping} today={today} issueTitle={issueTitle} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function TimeRow({
  entry: e,
  grouping,
  today,
  issueTitle,
}: {
  entry: TimeEntry;
  grouping: TimeGrouping;
  today: Date;
  issueTitle: (id: number) => string;
}) {
  const meta = useApp((s) => s.meta);
  const me = useApp((s) => s.account?.userId);
  const openIssue = useApp((s) => s.openIssue);
  const openTimeDialog = useApp((s) => s.openTimeDialog);
  const deleteTimeEntry = useApp((s) => s.deleteTimeEntry);
  const editable = canEditTime(meta, e.project.id, e.user.id, me);
  const label = `${formatHours(e.hours)} by ${e.user.name}, ${dayLabel(e.spent_on, today)}`;
  return (
    <li className="time-row">
      <span className="time-row-hours">{formatHours(e.hours)}</span>
      {grouping !== "issue" &&
        (e.issue ? (
          <button type="button" className="time-row-issue" onClick={() => openIssue(e.issue!.id)}>
            {issueTitle(e.issue.id)}
          </button>
        ) : (
          <span className="time-row-issue muted">{e.project.name}, no issue</span>
        ))}
      {grouping === "issue" && (
        <span className="time-row-comment">{e.comments || <span className="muted">No comment</span>}</span>
      )}
      {grouping !== "issue" && e.comments && <span className="time-row-comment muted">{e.comments}</span>}
      <span className="chip chip-plain">{e.activity.name}</span>
      {grouping !== "person" && (
        <span className="time-row-person">
          <Avatar name={e.user.name} size={16} />
          <span>{e.user.id === me ? "You" : e.user.name}</span>
        </span>
      )}
      {grouping !== "day" && <span className="time-row-date">{dayLabel(e.spent_on, today)}</span>}
      <span className="time-row-actions">
        {editable && (
          <>
            <button
              type="button"
              className="icon-button small"
              onClick={() => openTimeDialog(e.issue?.id ?? 0, e)}
              aria-label={`Change ${label}`}
              title="Change"
            >
              <Icon name="edit" size={11} />
            </button>
            <button
              type="button"
              className="icon-button small"
              onClick={() => void deleteTimeEntry(e)}
              aria-label={`Delete ${label}`}
              title="Delete"
            >
              <Icon name="trash" size={11} />
            </button>
          </>
        )}
      </span>
    </li>
  );
}
