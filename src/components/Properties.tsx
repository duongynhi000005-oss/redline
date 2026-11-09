import { useState } from "react";
import { shortcutLabel } from "../lib/platform";
import { formatHours, parseHours } from "../lib/time";

/** One row of the properties panel; a button when the value can be changed. */
export function Property({
  label,
  children,
  onEdit,
  shortcut,
}: {
  label: string;
  children: React.ReactNode;
  onEdit?: () => void;
  shortcut?: string;
}) {
  return (
    <div className="property">
      <dt>{label}</dt>
      <dd>
        {onEdit ? (
          <button
            type="button"
            className="property-button"
            onClick={onEdit}
            aria-label={`${label}: change`}
            title={shortcut ? `Change ${label.toLowerCase()} (${shortcutLabel(shortcut)})` : undefined}
          >
            {children}
          </button>
        ) : (
          children
        )}
      </dd>
    </div>
  );
}

/**
 * A date that's changed in place. Typing into a date box passes through
 * half-finished dates, so the change is sent on Enter or when the box loses
 * focus, not on every keystroke.
 */
export function DateProperty({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string | null | undefined;
  onChange?: (day: string | null) => void;
  min?: string | null;
  max?: string | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? "";
  if (!onChange) {
    return (
      <Property label={label}>
        <span className={value ? undefined : "muted"}>{value ? longDay(value) : "None"}</span>
      </Property>
    );
  }
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const next = draft || null;
    if (next !== (value ?? null)) onChange(next);
  };
  return (
    <div className="property">
      <dt>{label}</dt>
      <dd className="property-date">
        <input
          type="date"
          aria-label={label}
          value={shown}
          min={min ?? undefined}
          max={max ?? "9999-12-31"}
          className={shown ? undefined : "empty"}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape" && draft !== null) {
              e.preventDefault();
              e.stopPropagation();
              setDraft(null);
            }
          }}
        />
        {/* An empty date box shows a made-up date (WebKit shows today's); say None instead. */}
        {!shown && (
          <span className="property-date-none muted" aria-hidden="true">
            None
          </span>
        )}
        {value && (
          <button
            type="button"
            className="property-clear"
            aria-label={`Clear ${label.toLowerCase()}`}
            title={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              setDraft(null);
              onChange(null);
            }}
          >
            ×
          </button>
        )}
      </dd>
    </div>
  );
}

/** Hours typed as 1.5, 1:30 or 1h 30m; empty clears the estimate. */
export function HoursProperty({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  onChange?: (hours: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value ? formatHours(value) : "None";
  if (!onChange) {
    return (
      <Property label={label}>
        <span className={value ? undefined : "muted"}>{shown}</span>
      </Property>
    );
  }
  if (draft === null) {
    return (
      <Property label={label} onEdit={() => setDraft(value ? formatHours(value) : "")}>
        <span className={value ? undefined : "muted"}>{shown}</span>
      </Property>
    );
  }
  const parsed = parseHours(draft);
  const invalid = draft.trim() !== "" && parsed === null;
  const commit = () => {
    if (invalid) return;
    setDraft(null);
    const next = draft.trim() ? parsed : null;
    if (next !== (value ?? null)) onChange(next);
  };
  return (
    <div className="property">
      <dt>{label}</dt>
      <dd>
        <input
          className="property-input"
          aria-label={label}
          aria-invalid={invalid || undefined}
          title={invalid ? "Use hours like 1.5, 1:30 or 1h 30m" : undefined}
          placeholder="1h 30m"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => (invalid ? setDraft(null) : commit())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraft(null);
            }
          }}
        />
      </dd>
    </div>
  );
}

function longDay(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
