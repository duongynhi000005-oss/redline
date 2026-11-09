import { describeDetail } from "./journal";
import type { Issue, IssueDetails, Metadata } from "./types";

/**
 * Redline's inbox lives on this computer: Redmine has no notifications API, so
 * Redline notes changes other people make to issues assigned to you or opened
 * by you, as sync finds them.
 */
export interface InboxItem {
  /** Unique per change: "j<journal id>" or "new<issue id>". */
  key: string;
  issueId: number;
  subject: string;
  at: string;
  actor: string;
  /** What happened, like "commented" or "changed status from New to In Progress". */
  summary: string;
  /** The comment, if there was one. */
  comment: string | null;
  read: boolean;
}

export interface Inbox {
  /** Changes before this moment aren't news. */
  since: string;
  items: InboxItem[];
}

const MAX_ITEMS = 300;

function key(serverUrl: string, userId: number) {
  return `redline.inbox:${serverUrl}#${userId}`;
}

export function loadInbox(serverUrl: string, userId: number, now = new Date()): Inbox {
  try {
    const raw = localStorage.getItem(key(serverUrl, userId));
    if (raw) {
      const parsed = JSON.parse(raw) as Inbox;
      if (typeof parsed.since === "string" && Array.isArray(parsed.items)) return parsed;
    }
  } catch {
    // Start fresh.
  }
  return { since: now.toISOString().replace(/\.\d{3}Z$/, "Z"), items: [] };
}

export function saveInbox(serverUrl: string, userId: number, inbox: Inbox) {
  try {
    localStorage.setItem(key(serverUrl, userId), JSON.stringify(inbox));
  } catch {
    // Not fatal.
  }
}

/** Whether changes to this issue belong in my inbox. */
export function isMine(issue: Issue, userId: number): boolean {
  return issue.assigned_to?.id === userId || issue.author?.id === userId;
}

/** New inbox items from an issue's activity: other people's changes since `since`. */
export function itemsFrom(details: IssueDetails, userId: number, since: string, meta: Metadata): InboxItem[] {
  const { issue, journals } = details;
  const after = (t: string) => Date.parse(t) > Date.parse(since);
  const out: InboxItem[] = [];
  if (after(issue.created_on) && issue.author && issue.author.id !== userId && issue.assigned_to?.id === userId) {
    out.push({
      key: `new${issue.id}`,
      issueId: issue.id,
      subject: issue.subject,
      at: issue.created_on,
      actor: issue.author.name,
      summary: "created an issue assigned to you",
      comment: null,
      read: false,
    });
  }
  for (const j of journals) {
    if (!after(j.created_on) || !j.user || j.user.id === userId) continue;
    const changes = j.details.map((d) => describeDetail(d, meta));
    const summary = changes.length ? changes.join(", ") : "commented";
    out.push({
      key: `j${j.id}`,
      issueId: issue.id,
      subject: issue.subject,
      at: j.created_on,
      actor: j.user.name,
      summary: j.notes && changes.length ? `${summary} and commented` : summary,
      comment: j.notes || null,
      read: false,
    });
  }
  return out;
}

/** Adds items it hasn't seen, newest first, keeping the inbox to a few hundred. */
export function mergeItems(inbox: Inbox, items: InboxItem[]): Inbox {
  const seen = new Set(inbox.items.map((i) => i.key));
  const fresh = items.filter((i) => !seen.has(i.key));
  if (!fresh.length) return inbox;
  const all = [...fresh, ...inbox.items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ITEMS);
  return { ...inbox, items: all };
}
