/**
 * A server's username and custom headers, for a proxy or gateway in front of
 * Redmine, and how hard Redline may use it. The Rust core (crates/redline-core/src/connection.rs) is the
 * source of truth and checks them again; these checks give instant feedback
 * in the form.
 */

/** The header the Username field is sent as. */
export const USERNAME_HEADER = "X-Redmine-Username";

export const MAX_HEADERS = 20;

export interface Header {
  name: string;
  value: string;
}

/** How hard Redline may use a server (crates/redline-core/src/pacer.rs). */
export interface RequestLimits {
  /** Requests in flight at the same time. */
  at_once: number;
  /** Requests started per minute. */
  per_minute: number;
}

export const DEFAULT_LIMITS: RequestLimits = { at_once: 2, per_minute: 120 };
export const MAX_AT_ONCE = 8;
export const MIN_PER_MINUTE = 10;
export const MAX_PER_MINUTE = 1200;

export interface ConnectionOptions {
  username: string | null;
  headers: Header[];
  /** Null uses the defaults. */
  limits?: RequestLimits | null;
}

export const NO_CONNECTION: ConnectionOptions = { username: null, headers: [], limits: null };

/** Headers Redline sets itself, or that only the HTTP library may set. */
const RESERVED = new Set([
  "x-redmine-api-key",
  "accept",
  "accept-encoding",
  "connection",
  "content-length",
  "content-type",
  "host",
  "te",
  "transfer-encoding",
  "upgrade",
  "user-agent",
]);

/** An HTTP token: what a header name may be made of. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Visible ASCII, spaces and tabs: what a header value may hold. */
const VALUE = /^[\t\x20-\x7e]*$/;

/** Trims, drops a blank username, fully blank rows and limits that match the defaults: what gets saved. */
export function normalizeConnection(options: ConnectionOptions): ConnectionOptions {
  const username = options.username?.trim() || null;
  const headers = options.headers
    .map((h) => ({ name: h.name.trim(), value: h.value.trim() }))
    .filter((h) => h.name !== "" || h.value !== "");
  const l = options.limits;
  const limits =
    l && (l.at_once !== DEFAULT_LIMITS.at_once || l.per_minute !== DEFAULT_LIMITS.per_minute)
      ? { at_once: l.at_once, per_minute: l.per_minute }
      : null;
  return { username, headers, limits };
}

export function isEmptyConnection(options: ConnectionOptions): boolean {
  const n = normalizeConnection(options);
  return n.username === null && n.headers.length === 0 && n.limits === null;
}

/** The limits in use: the saved ones or the defaults. */
export function limitsOf(options: ConnectionOptions): RequestLimits {
  return options.limits ?? DEFAULT_LIMITS;
}

export function sameConnection(a: ConnectionOptions, b: ConnectionOptions): boolean {
  return JSON.stringify(normalizeConnection(a)) === JSON.stringify(normalizeConnection(b));
}

/** What's wrong with the options, in words the form can show, or null. */
export function connectionProblem(options: ConnectionOptions): string | null {
  const { username, headers, limits } = normalizeConnection(options);
  if (limits) {
    const { at_once, per_minute } = limits;
    if (!Number.isInteger(at_once) || at_once < 1 || at_once > MAX_AT_ONCE)
      return `Requests at a time must be a whole number from 1 to ${MAX_AT_ONCE}.`;
    if (!Number.isInteger(per_minute) || per_minute < MIN_PER_MINUTE || per_minute > MAX_PER_MINUTE)
      return `Requests per minute must be a whole number from ${MIN_PER_MINUTE} to ${MAX_PER_MINUTE.toLocaleString("en-US")}.`;
  }
  if (headers.length > MAX_HEADERS) return `Redline can send at most ${MAX_HEADERS} custom headers.`;
  if (username !== null && !VALUE.test(username)) return "The username has characters that can't go in a header.";
  const seen = new Set(username !== null ? ["x-redmine-username"] : []);
  for (const { name, value } of headers) {
    if (name === "") return "A custom header needs a name.";
    if (!TOKEN.test(name)) return `"${name}" isn't a valid header name. Use letters, digits and dashes.`;
    const key = name.toLowerCase();
    if (key === "x-redmine-api-key") return "Redline sends your API key itself. Put it in the API key field.";
    if (RESERVED.has(key)) return `Redline sets ${name} itself, so it can't be a custom header.`;
    if (seen.has(key)) {
      return key === "x-redmine-username"
        ? `${USERNAME_HEADER} is already sent from the Username field. Remove one of them.`
        : `${name} is listed twice.`;
    }
    seen.add(key);
    if (value === "") return `Give ${name} a value.`;
    if (!VALUE.test(value)) return `The value of ${name} has characters that can't go in a header.`;
  }
  return null;
}

/**
 * Sign-in errors that a proxy in front of Redmine can cause, where adding a
 * username or headers may help.
 */
export function mightNeedHeaders(code: string | undefined): boolean {
  return code === "refused" || code === "not_redmine" || code === "http" || code === "unauthorized";
}
