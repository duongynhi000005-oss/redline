// Types mirroring Redline's Rust core (crates/redline-core/src/models.rs).
// Redmine's field names are kept as they are.

export interface Named {
  id: number;
  name: string;
}

export interface User {
  id: number;
  login: string;
  firstname: string;
  lastname: string;
  mail?: string | null;
  admin: boolean;
}

export interface IssueStatus {
  id: number;
  name: string;
  is_closed: boolean;
}

export interface IssueStatusRef {
  id: number;
  name: string;
  is_closed?: boolean | null;
}

export interface Tracker {
  id: number;
  name: string;
  default_status?: Named | null;
}

export interface IssuePriority {
  id: number;
  name: string;
  is_default: boolean;
  active: boolean;
}

export interface Project {
  id: number;
  name: string;
  identifier: string;
  description?: string | null;
  parent?: Named | null;
  status?: number | null;
  trackers: Named[];
  issue_categories: Named[];
  enabled_modules: Named[];
  issue_custom_fields: Named[];
}

export interface Membership {
  id: number;
  project: Named;
  user?: Named | null;
  group?: Named | null;
  roles: Named[];
}

export interface Version {
  id: number;
  project: Named;
  name: string;
  description?: string | null;
  status: "open" | "locked" | "closed" | string;
  due_date?: string | null;
  sharing?: string | null;
}

export interface CustomFieldValue {
  id: number;
  name: string;
  multiple?: boolean;
  value: string | string[] | null;
}

export interface JournalDetail {
  property: string;
  name: string;
  old_value?: string | null;
  new_value?: string | null;
}

export interface Journal {
  id: number;
  user?: Named | null;
  notes?: string | null;
  created_on: string;
  updated_on?: string | null;
  private_notes: boolean;
  details: JournalDetail[];
}

/** A relation between two issues, as Redmine stores it (from issue_id to issue_to_id). */
export interface Relation {
  id: number;
  issue_id: number;
  issue_to_id: number;
  relation_type: RelationType;
  delay?: number | null;
}

export type RelationType =
  | "relates"
  | "duplicates"
  | "duplicated"
  | "blocks"
  | "blocked"
  | "precedes"
  | "follows"
  | "copied_to"
  | "copied_from";

/** A relation to add from an issue. Redmine stores inverse types (`blocked`) the other way round. */
export interface NewRelation {
  issue_to_id: number;
  relation_type: RelationType;
  delay?: number | null;
}

export interface Issue {
  id: number;
  project: Named;
  tracker: Named;
  status: IssueStatusRef;
  priority: Named;
  author?: Named | null;
  assigned_to?: Named | null;
  category?: Named | null;
  fixed_version?: Named | null;
  parent?: { id: number } | null;
  subject: string;
  description?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  done_ratio?: number | null;
  is_private: boolean;
  estimated_hours?: number | null;
  custom_fields: CustomFieldValue[];
  created_on: string;
  updated_on: string;
  closed_on?: string | null;
  /** Synced with every issue; can lag behind others' changes by a few hours. */
  relations?: Relation[] | null;
}

export interface Metadata {
  user: User | null;
  projects: Project[];
  statuses: IssueStatus[];
  trackers: Tracker[];
  priorities: IssuePriority[];
  versions: Version[];
  memberships: Membership[];
}

export interface IssueDetails {
  issue: Issue;
  journals: Journal[];
  allowedStatuses: IssueStatusRef[] | null;
}

/** Fields to change. `null` clears a field; leaving a key out leaves it alone. */
export interface IssueChanges {
  project_id?: number;
  tracker_id?: number;
  status_id?: number;
  priority_id?: number;
  subject?: string;
  description?: string;
  assigned_to_id?: number | null;
  fixed_version_id?: number | null;
  parent_issue_id?: number | null;
  due_date?: string | null;
  start_date?: string | null;
  custom_fields?: { id: number; value: string | string[] }[];
  notes?: string;
  private_notes?: boolean;
}

export interface Account {
  serverUrl: string;
  userId: number;
  login: string;
  name: string;
}

export type SyncPhase = "syncing" | "idle" | "offline" | "error";

export interface SyncState {
  state: SyncPhase;
  lastSyncedAt: number | null;
  message: string | null;
}

export interface IssuesChanged {
  changed: number[];
  removed: number[];
}

export interface AppInfo {
  version: string;
  platform: string;
  /** The native window backdrop: Liquid Glass, vibrancy, Mica, or none (solid). */
  material?: "glass" | "vibrancy" | "mica" | "none";
}

/** An error from the backend, worded for people. */
export interface BackendError {
  code: string;
  message: string;
}

export function isBackendError(e: unknown): e is BackendError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

export function errorMessage(e: unknown): string {
  if (isBackendError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
