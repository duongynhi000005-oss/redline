import type { Metadata } from "./types";

// What the signed-in user may do in a project, from their roles there.
// Redmine's API doesn't say per issue, but any user may read their own
// memberships and every role's permissions, so Redline can offer only what
// Redmine will accept.

/**
 * Whether the user has a permission in a project: true or false when
 * Redline knows, null when it can't tell (an older cache, or a server that
 * hides roles), in which case the UI should offer the action and let
 * Redmine decide.
 */
export function allowed(meta: Metadata | null, projectId: number, permission: string): boolean | null {
  const user = meta?.user;
  if (!user) return null;
  if (user.admin) return true;
  if (!meta.roles?.length || !user.memberships) return null;
  const membership = user.memberships.find((m) => m.project.id === projectId);
  // Not a member: Redmine's Non member role applies, which Redline can't see.
  if (!membership) return null;
  let unknown = false;
  for (const ref of membership.roles) {
    const role = meta.roles.find((r) => r.id === ref.id);
    if (!role) unknown = true;
    else if (role.permissions.includes(permission)) return true;
  }
  return unknown ? null : false;
}

/**
 * Whether a Redmine module (time_tracking, wiki, news…) is on in a project:
 * null when Redline doesn't know the project's modules.
 */
export function moduleEnabled(meta: Metadata | null, projectId: number, module: string): boolean | null {
  const project = meta?.projects.find((p) => p.id === projectId);
  if (!project?.enabled_modules.length) return null;
  return project.enabled_modules.some((m) => m.name === module);
}

/** Whether the user can see and log time in a project, as far as Redline knows. */
export function timeAccess(meta: Metadata | null, projectId: number) {
  const tracking = moduleEnabled(meta, projectId, "time_tracking") !== false;
  return {
    view: tracking && allowed(meta, projectId, "view_time_entries") !== false,
    log: tracking && allowed(meta, projectId, "log_time") !== false,
  };
}

/** Whether the user can change or delete a logged entry. */
export function canEditTime(meta: Metadata | null, projectId: number, entryUserId: number, me: number | undefined): boolean {
  if (allowed(meta, projectId, "edit_time_entries") !== false) return true;
  return entryUserId === me && allowed(meta, projectId, "edit_own_time_entries") !== false;
}
