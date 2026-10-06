/**
 * The permission names the console may ask about: a snapshot of jinbe's catalogue
 * (jinbe `src/policy/catalog.ts`, `GET /api/catalog`).
 *
 * Typed, so a screen gating on a name the catalogue does not declare fails to compile rather than
 * greying a control for everybody. Leaves only, matched exactly: there is no wildcard, no alias and
 * no ancestry, at jinbe or here.
 *
 * Two scopes. A platform permission is held through groups and decided on routes without an
 * organization. An org permission is held through the roles assigned in ONE organization (or the
 * every-org map) and means nothing outside it: it is read from `orgPermissions[org]`, never from the
 * session's platform list.
 */

export const PLATFORM_PERMISSIONS = [
  'users:read', 'users:create', 'users:update', 'users:update_email', 'users.metadata:write', 'users:disable',
  'users:delete', 'users:recovery', 'users:verify', 'users:send_login_link', 'users:reset_second_factor',
  'sessions:read', 'sessions:revoke',
  'access:read', 'access:check', 'groups:read', 'groups:write', 'groups.members:write', 'groups.members:revoke',
  'groups.mfa:write', 'users.grants:read', 'users.grants:write',
  'orgs:read', 'orgs:write', 'orgs:delete', 'orgs.members:write', 'orgs.owners:write',
  'sites:read', 'sites:write', 'sites:apply', 'sites:delete', 'sites.requests:approve',
  'sites.signup:write', 'sites.signup:revoke', 'sites.members:write',
  'zones:read', 'zones:write', 'zones:delete', 'gateway:read', 'gateway:apply',
  'settings:read', 'settings.signin:write', 'settings.mcp:write', 'policy.bundle:read', 'policy.bundle:write',
  'audit:read', 'audit:export', 'recert:read', 'recert:manage', 'recert:delete', 'stats:read',
] as const;

export const ORG_PERMISSIONS = [
  'org.members:read', 'org.members:write', 'org.keys:read', 'org.keys:write', 'org.keys:revoke', 'org.audit:read',
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];
export type Permission = PlatformPermission | OrgPermission;

export const PERMISSIONS: readonly Permission[] = [...PLATFORM_PERMISSIONS, ...ORG_PERMISSIONS];

export function isCatalogPermission(name: string): name is Permission {
  return (PERMISSIONS as readonly string[]).includes(name);
}
