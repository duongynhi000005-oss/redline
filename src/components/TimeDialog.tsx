import { useCallback, useEffect, useRef, useState } from "react";
import { matchesShortcut, shortcutLabel } from "../lib/platform";
import { formatHours, isoDay, parseHours } from "../lib/time";
import type { TimeEntry, TimeEntryActivity, TimeEntryChanges } from "../lib/types";
import { useApp } from "../state/app";
import { useDialogFocus } from "./useDialogFocus";

const NO_ACTIVITIES: TimeEntryActivity[] = [];

/** Logging time on an issue, or changing time already logged. */
export function TimeDialog() {
  const dialog = useApp((s) => s.timeDialog);
  const closeTimeDialog = useApp((s) => s.closeTimeDialog);
  // Stable, so the dialog's Escape listener isn't swapped out mid-keypress.
  const close = useCallback(() => closeTimeDialog(), [closeTimeDialog]);
  if (!dialog) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <TimeForm
        key={`${dialog.issueId}:${dialog.entry?.id ?? "new"}`}
        issueId={dialog.issueId}
        entry={dialog.entry}
        onClose={close}
      />
    </div>
  );
}

function TimeForm({ issueId, entry, onClose }: { issueId: number; entry?: TimeEntry; onClose: () => void }) {
  const issue = useApp((s) => s.issues.get(issueId));
  const activities = useApp((s) => s.meta?.time_entry_activities) ?? NO_ACTIVITIES;
  const saveTime = useApp((s) => s.saveTime);
  const ref = useRef<HTMLFormElement>(null);
  useDialogFocus(ref);

  const [hoursText, setHoursText] = useState(() => (entry ? formatHours(entry.hours) : ""));
  const [day, setDay] = useState(() => entry?.spent_on ?? isoDay(new Date()));
  const [activityId, setActivityId] = useState<number | undefined>(
    () => entry?.activity.id ?? (activities.find((a) => a.is_default) ?? activities[0])?.id,
  );
  const [comments, setComments] = useState(entry?.comments ?? "");
  const [busy, setBusy] = useState(false);
  const hours = parseHours(hoursText);
  const showHoursError = hoursText.trim() !== "" && hours === null;

  async function submit() {
    if (hours === null || !day || busy) return;
    const changes: TimeEntryChanges = {};
    if (!entry || hours !== entry.hours) changes.hours = hours;
    if (!entry || day !== entry.spent_on) changes.spent_on = day;
    if (activityId !== undefined && activityId !== entry?.activity.id) changes.activity_id = activityId;
    if (!entry ? comments.trim() : comments !== (entry.comments ?? "")) changes.comments = comments.trim();
    if (entry && Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    if (await saveTime(issueId, changes, entry?.id)) onClose();
    else setBusy(false);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = entry ? "Change logged time" : "Log time";
  return (
    <form
      ref={ref}
      className="modal time-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="time-dialog-title"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (matchesShortcut(e, "mod+enter")) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <header className="time-dialog-header">
        <h1 id="time-dialog-title">{title}</h1>
        {issue && (
          <span className="muted time-dialog-issue">
            #{issue.id} {issue.subject}
          </span>
        )}
      </header>
      <div className="time-dialog-fields">
        <label className="time-field time-field-hours">
          <span>Time</span>
          <input
            aria-label="Time spent"
            aria-invalid={showHoursError || undefined}
            aria-describedby="time-hours-hint"
            placeholder="1h 30m"
            autoFocus
            value={hoursText}
            onChange={(e) => setHoursText(e.target.value)}
          />
        </label>
        <label className="time-field">
          <span>Date</span>
          <input type="date" aria-label="Date" value={day} max="9999-12-31" onChange={(e) => setDay(e.target.value)} required />
        </label>
        {activities.length > 0 && (
          <label className="time-field">
            <span>Activity</span>
            <select aria-label="Activity" value={activityId} onChange={(e) => setActivityId(Number(e.target.value))}>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p id="time-hours-hint" className={showHoursError ? "form-error" : "muted time-dialog-hint"}>
        {showHoursError
          ? "Use a number of hours like 1.5, or 1:30, 1h 30m or 90m."
          : hours !== null
            ? `${formatHours(hours)}, logged as ${hours} h in Redmine.`
            : "Hours like 1.5, or 1:30, 1h 30m or 90m."}
      </p>
      <input
        className="time-dialog-comment"
        aria-label="Comment"
        placeholder="What was it for? (optional)"
        maxLength={1024}
        value={comments}
        onChange={(e) => setComments(e.target.value)}
      />
      <footer className="new-issue-footer time-dialog-footer">
        <button type="button" className="button-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button-primary" disabled={hours === null || !day || busy}>
          {busy ? "Saving…" : entry ? "Save" : "Log time"}
          <kbd className="kbd-on-accent">{shortcutLabel("mod+enter")}</kbd>
        </button>
      </footer>
    </form>
  );
}
