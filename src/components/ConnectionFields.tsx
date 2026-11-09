import { useId } from "react";
import type { ConnectionOptions, Header, RequestLimits } from "../lib/connection";
import {
  DEFAULT_LIMITS,
  MAX_AT_ONCE,
  MAX_HEADERS,
  MAX_PER_MINUTE,
  MIN_PER_MINUTE,
  USERNAME_HEADER,
  limitsOf,
} from "../lib/connection";

/**
 * The Username field and the custom headers list, for a server behind a
 * proxy or gateway, and the request rate, for a server that limits how fast
 * apps may ask. Used by the sign-in form and by Settings.
 */
export function ConnectionFields({
  value,
  onChange,
  disabled,
}: {
  value: ConnectionOptions;
  onChange: (next: ConnectionOptions) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const setHeader = (index: number, patch: Partial<Header>) =>
    onChange({ ...value, headers: value.headers.map((h, i) => (i === index ? { ...h, ...patch } : h)) });
  const removeHeader = (index: number) => onChange({ ...value, headers: value.headers.filter((_, i) => i !== index) });
  const addHeader = () => onChange({ ...value, headers: [...value.headers, { name: "", value: "" }] });
  const limits = limitsOf(value);
  const setLimit = (patch: Partial<RequestLimits>) => onChange({ ...value, limits: { ...limits, ...patch } });
  const number = (raw: string) => (raw.trim() === "" ? Number.NaN : Number(raw));

  return (
    <div className="connection-fields">
      <div className="connection-field">
        <label htmlFor={`${id}-username`}>Username</label>
        <input
          id={`${id}-username`}
          type="text"
          placeholder="Only if your server asks for one"
          value={value.username ?? ""}
          onChange={(e) => onChange({ ...value, username: e.target.value })}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-describedby={`${id}-username-help`}
        />
        <small id={`${id}-username-help`} className="field-help">
          Sent as {USERNAME_HEADER} with every request.
        </small>
      </div>

      <div className="connection-headers" role="group" aria-labelledby={`${id}-headers`}>
        <span id={`${id}-headers`} className="connection-headers-title">
          Custom headers
        </span>
        {value.headers.length > 0 && (
          <ul>
            {value.headers.map((header, i) => (
              <li key={i} className="connection-header-row">
                <input
                  type="text"
                  aria-label={`Header ${i + 1} name`}
                  placeholder="Name"
                  value={header.name}
                  onChange={(e) => setHeader(i, { name: e.target.value })}
                  disabled={disabled}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                />
                <input
                  type="password"
                  aria-label={`Header ${i + 1} value`}
                  placeholder="Value"
                  value={header.value}
                  onChange={(e) => setHeader(i, { value: e.target.value })}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove header ${header.name.trim() || i + 1}`}
                  onClick={() => removeHeader(i)}
                  disabled={disabled}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="button-secondary small" onClick={addHeader} disabled={disabled || value.headers.length >= MAX_HEADERS}>
          Add header
        </button>
        <small className="field-help">Sent with every request to this server and kept in the system keychain.</small>
      </div>

      <div className="connection-rate" role="group" aria-labelledby={`${id}-rate`} aria-describedby={`${id}-rate-help`}>
        <span id={`${id}-rate`} className="connection-headers-title">
          Request rate
        </span>
        <div className="connection-rate-row">
          <label htmlFor={`${id}-at-once`}>Requests at a time</label>
          <input
            id={`${id}-at-once`}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_AT_ONCE}
            step={1}
            value={Number.isNaN(limits.at_once) ? "" : limits.at_once}
            onChange={(e) => setLimit({ at_once: number(e.target.value) })}
            disabled={disabled}
          />
        </div>
        <div className="connection-rate-row">
          <label htmlFor={`${id}-per-minute`}>Requests per minute</label>
          <input
            id={`${id}-per-minute`}
            type="number"
            inputMode="numeric"
            min={MIN_PER_MINUTE}
            max={MAX_PER_MINUTE}
            step={10}
            value={Number.isNaN(limits.per_minute) ? "" : limits.per_minute}
            onChange={(e) => setLimit({ per_minute: number(e.target.value) })}
            disabled={disabled}
          />
        </div>
        <small id={`${id}-rate-help`} className="field-help">
          Lower these if your server limits how fast apps may ask it for data. Redline also slows down by itself
          whenever the server asks it to.
          {(limits.at_once !== DEFAULT_LIMITS.at_once || limits.per_minute !== DEFAULT_LIMITS.per_minute) && (
            <>
              {" "}
              <button
                type="button"
                className="link-button"
                onClick={() => onChange({ ...value, limits: null })}
                disabled={disabled}
              >
                Use defaults
              </button>
            </>
          )}
        </small>
      </div>
    </div>
  );
}
