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
