/**
 * What the caller holds, as the console reads it to decide what to draw.
 *
 * One rule, the engine's: a permission is held when its exact catalogue name is in the list. No
 * wildcard, no ancestry, no alias, no super-admin shortcut — a super admin passes because their role
 * lists every permission, not because they are special. Only decides what to show: jinbe decides the
 * call, and a screen must still expect a 403.
 */
import { PLATFORM_PERMISSIONS, type OrgPermission, type Permission, type PlatformPermission } from './catalog';

/** The session fields a gate reads (`GET /whoami`). */
export type HeldSession = { permissions?: readonly string[]; effective_permissions?: readonly string[] } | undefined;

/** The catalogue names a session holds: `effective_permissions`, or the raw list on a jinbe that does not say. */
function heldBy(session: HeldSession): readonly string[] {
  return session?.effective_permissions ?? session?.permissions ?? [];
}

/**
 * Staff: somebody who holds at least one platform permission (a staff group, super_admins, a direct
 * grant). The console is for them; an account that holds only organization permissions (a customer
 * who owns their organization) is shown the way out instead (App StaffOnly).
 */
export function isStaff(session: HeldSession): boolean {
  const held = heldBy(session);
  return (PLATFORM_PERMISSIONS as readonly string[]).some((p) => held.includes(p));
}

/** Whether the session holds this platform permission. */
export function holds(session: HeldSession, permission: PlatformPermission): boolean {
  return heldBy(session).includes(permission);
}

/** Whether the session holds at least one of these. An empty list asks nothing and passes. */
export function holdsAny(session: HeldSession, permissions: readonly PlatformPermission[]): boolean {
  return permissions.length === 0 || permissions.some((p) => holds(session, p));
}

/** What the caller holds in each organization (`GET /me/permissions` → `orgPermissions`). */
export type OrgPermissions = Record<string, readonly string[]>;

/** Whether the caller holds an org permission IN this organization. Platform permissions never count here. */
export function holdsIn(orgPermissions: OrgPermissions | undefined, org: string, permission: OrgPermission): boolean {
  return !!org && (orgPermissions?.[org] ?? []).includes(permission);
}

/** The organizations where the caller holds this org permission. */
export function orgsWhere(orgPermissions: OrgPermissions | undefined, permission: OrgPermission): string[] {
  return Object.entries(orgPermissions ?? {})
    .filter(([, held]) => held.includes(permission))
    .map(([org]) => org)
    .sort();
}

/** Whether a held list carries this exact permission (a role's list, a group's reach). */
export function carries(held: readonly string[] | undefined, permission: Permission | string): boolean {
  return (held ?? []).includes(permission);
}

export type RoleCatalogue = Record<string, string[]>;

/**
 * What these roles carry, and which of them the catalogue does not define.
 *
 * A role naming nothing grants nothing, and a screen that renders it as an empty list says the same
 * thing as a role that genuinely carries no permission. Naming it is the difference between "this
 * grants nothing" and "this points at something that is missing".
 */
export function resolveRoles(
  roleNames: string[],
  catalogue: RoleCatalogue,
): { permissions: string[]; undefined: string[] } {
  const undefined_ = roleNames.filter(name => !catalogue[name]);
  const permissions = [...new Set(roleNames.flatMap(name => catalogue[name] ?? []))].sort();
  return { permissions, undefined: undefined_ };
}
