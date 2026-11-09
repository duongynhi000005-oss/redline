import { useEffect, useState } from "react";
import { canEditTime } from "../lib/permissions";
import { dayLabel, formatHours, totalHours } from "../lib/time";
import type { Issue, TimeEntry } from "../lib/types";
import { errorMessage } from "../lib/types";
import { useApp } from "../state/app";
import { Avatar } from "./Avatar";
import { Icon } from "./icons";

/** The time logged on an issue, newest first, with a way to log more. */
export function IssueTime({ issue, canLog }: { issue: Issue; canLog: boolean }) {
  const backend = useApp((s) => s.backend);
  const meta = useApp((s) => s.meta);
  const me = useApp((s) => s.account?.userId);
  const version = useApp((s) => s.timeVersion);
  const openTimeDialog = useApp((s) => s.openTimeDialog);
  const deleteTimeEntry = useApp((s) => s.deleteTimeEntry);
  const [loaded, setLoaded] = useState<{ issueId: number; key: string; entries?: TimeEntry[]; error?: string } | null>(null);
  const key = `${issue.id}:${version}:${issue.spent_hours ?? ""}`;

  useEffect(() => {
    if (!backend) return;
    let live = true;
    backend
      .timeEntries({ issue_id: issue.id })
      .then((entries) => live && setLoaded({ issueId: issue.id, key, entries }))
      .catch((e) => live && setLoaded({ issueId: issue.id, key, error: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [backend, issue.id, key]);

  // The last list stays on screen while a newer one loads, so it doesn't flicker.
  const entries = loaded?.issueId === issue.id ? (loaded.entries ?? null) : null;
  const error = loaded?.key === key ? loaded.error : undefined;
  const today = new Date();

  return (
    <section className="issue-time" aria-label="Time">
      <header className="subscribers-header">
        <h3>Time{entries && entries.length > 0 && <span className="count">{formatHours(totalHours(entries))}</span>}</h3>
        {canLog && (
          <button
            type="button"
            className="icon-button small"
            onClick={() => openTimeDialog(issue.id)}
            aria-label="Log time"
            title="Log time"
          >
            <Icon name="plus" size={12} />
          </button>
        )}
      </header>
      {error ? (
        <p className="muted subscribers-note">Couldn't load the time: {error}</p>
      ) : entries === null ? (
        <p className="muted subscribers-note">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="muted subscribers-note">No time logged yet.</p>
      ) : (
        <ul className="time-entries">
          {entries.map((e) => {
            const editable = canEditTime(meta, e.project.id, e.user.id, me);
            const label = `${formatHours(e.hours)} by ${e.user.name}, ${dayLabel(e.spent_on, today)}`;
            return (
              <li key={e.id} aria-label={label}>
                <Avatar name={e.user.name} size={16} />
                <span className="time-entry-main">
                  <span className="time-entry-line">
                    <strong>{formatHours(e.hours)}</strong>
                    <span className="time-entry-who">{e.user.id === me ? "You" : e.user.name}</span>
                  </span>
                  <span className="time-entry-sub muted">
                    {dayLabel(e.spent_on, today)} · {e.activity.name}
                  </span>
                  {e.comments && <span className="time-entry-comment">{e.comments}</span>}
                </span>
                {editable && (
                  <span className="time-entry-actions">
                    <button
                      type="button"
                      className="icon-button small"
                      onClick={() => openTimeDialog(issue.id, e)}
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
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
