// The two layers of access, as jinbe answers them: platform access comes from a person's groups; org
// access is the org roles assigned to them in ONE organization, and only counts on that org's routes.
// One module for the calls behind the Access view, the access checker, My org and the Organizations
// hub, so the shapes they read are written down once. Same `request` as client.ts — same errors.
import { request } from './client';
import type { UserSecondFactor } from '../lib/twoFactor';
import { statusOf } from '../lib/apiError';

const enc = encodeURIComponent;

/** The org role every organization has from code: every org permission, `org.members:write` included. */
export const OWNER_ROLE = 'jinbe:owner';

/** One org role an organization may hold (`svc:role`: jinbe's, or an entitled site's). */
export interface OrgRole {
  role: string;
  permissions: string[];
  /** Whether the caller may hand it out here: they hold org.members:write and every permission it carries. */
  assignable: boolean;
}

export interface OrgAccessEntry {
  orgId: string;
  name: string;
  /** Org roles assigned here (`svc:role`). */
  roles: string[];
  /** The org permissions held here, as the policy decides them (assigned roles and the every-org map). */
  permissions: string[];
}

export interface UserAccess {
  site: { groups: string[]; byService: Record<string, string[]> };
  orgs: OrgAccessEntry[];
  /** Their second-factor picture (session fields null); absent on an older jinbe. */
  secondFactor?: UserSecondFactor | null;
}

export type AccessReason = 'ok' | 'not_found' | 'forbidden' | 'forbidden_org';

export interface AccessCheckInput {
  email: string;
  method: string;
  path: string;
  app?: string;
}

export interface AccessCheckResult {
  allow: boolean;
  reason: AccessReason;
  app: string | null;
  owners: string[];
  matchingRules: { method: string; path: string; permission?: string }[];
  groups: string[];
  roles: string[];
  permissions: string[];
}

/** Why jinbe would not assign an org role (403 `refused[]` on a roles write). */
export type OrgRoleRefusalReason = 'unknown_role' | 'org_not_entitled' | 'grant_permission_missing' | 'grant_exceeds_own';

export interface RefusedRole {
  role: string;
  reason: OrgRoleRefusalReason | string;
  /** The permissions the caller would need to hold here to hand it out. */
  missing: string[];
  /** The policy's own codes behind the reason, when jinbe sends them. */
  reasons?: string[];
  /** The roles or groups that would carry what is missing, when jinbe says. */
  grantedBy?: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function normaliseAccess(raw: Partial<{ site: Partial<UserAccess['site']>; orgs: Partial<OrgAccessEntry>[]; secondFactor: UserSecondFactor | null }>): UserAccess {
  return {
    site: { groups: strings(raw.site?.groups), byService: raw.site?.byService ?? {} },
    orgs: (raw.orgs ?? []).filter((o) => typeof o?.orgId === 'string').map((o) => ({
      orgId: o.orgId as string,
      name: o.name || (o.orgId as string),
      roles: strings(o.roles),
      permissions: strings(o.permissions),
    })),
    ...(raw.secondFactor !== undefined ? { secondFactor: raw.secondFactor } : {}),
  };
}

const orgBase = (orgId: string) => `/organizations/${enc(orgId)}`;

export const orgAccessApi = {
  /** This org's roles (jinbe's and its entitled sites'), each marked with whether the caller may assign it. */
  roles: (orgId: string) =>
    request<{ roles?: Partial<OrgRole>[] }>(`${orgBase(orgId)}/roles`).then((r) =>
      (r.roles ?? []).filter((x) => typeof x?.role === 'string').map((x): OrgRole => ({
        role: x.role as string,
        permissions: strings(x.permissions),
        assignable: x.assignable === true,
      })),
    ),

  /** One member's org roles here. */
  memberRoles: (orgId: string, userId: string) =>
    request<{ roles?: unknown }>(`${orgBase(orgId)}/users/${enc(userId)}/roles`).then((r) => strings(r.roles)),

  /** Replaces one member's org roles here. A 403 carries `refused` — read it with `refusedOf`. */
  setMemberRoles: (orgId: string, userId: string, roles: string[]) =>
    request<{ id: string; roles?: unknown }>(`${orgBase(orgId)}/users/${enc(userId)}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ roles }),
    }).then((r) => strings(r.roles)),

  /** Names the org's owners by identity id (platform, orgs.owners:write, step-up): everyone else loses the role. */
  setOwners: (orgId: string, owners: string[]) =>
    request<{ owners?: unknown }>(`/admin/organizations/${enc(orgId)}/owners`, {
      method: 'PUT',
      body: JSON.stringify({ owners }),
    }).then((r) => strings(r.owners)),

  userAccess: (userId: string) =>
    request<Parameters<typeof normaliseAccess>[0]>(`/admin/users/${enc(userId)}/access`).then(normaliseAccess),

  accessCheck: (input: AccessCheckInput) =>
    request<AccessCheckResult>('/admin/rbac/access-check', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email.trim(),
        method: input.method.toUpperCase(),
        path: input.path.trim(),
        ...(input.app ? { app: input.app } : {}),
      }),
    }),

  /** This org only: the account and every other membership stay. */
  removeFromOrg: (orgId: string, userId: string) =>
    request<void>(`${orgBase(orgId)}/users/${enc(userId)}`, { method: 'DELETE' }),

  /** Adds somebody who already has an account; their other memberships stay. */
  addMember: (orgId: string, userId: string) =>
    request<unknown>(`${orgBase(orgId)}/users/${enc(userId)}/membership`, { method: 'PUT' }),
};

/** The roles a 403 on a roles write refused, each with why. Empty when there is no such list. */
export function refusedOf(err: unknown): RefusedRole[] {
  const list = (err as { details?: { refused?: unknown } } | null)?.details?.refused;
  if (!Array.isArray(list)) return [];
  return list
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as { role?: unknown }).role === 'string')
    .map((r) => ({
      role: r.role as string,
      reason: typeof r.reason === 'string' ? r.reason : '',
      missing: strings(r.missing),
      ...(Array.isArray(r.reasons) ? { reasons: strings(r.reasons) } : {}),
      ...(typeof r.grantedBy === 'string' ? { grantedBy: [r.grantedBy] } : Array.isArray(r.grantedBy) ? { grantedBy: strings(r.grantedBy) } : {}),
    }));
}

/** A refusal in words: what stands in the way, not the code. */
export function refusalWords(r: RefusedRole): string {
  const missing = r.missing.length ? ` (missing here: ${r.missing.join(', ')})` : '';
  switch (r.reason) {
    case 'unknown_role': return 'no such role';
    case 'org_not_entitled': return "this organization is not entitled to that site: the site's intent does not list it";
    case 'grant_permission_missing': return `you may not assign roles in this organization${missing}`;
    case 'grant_exceeds_own': return `it carries permissions you do not hold here${missing}`;
    default: return `${r.reason || 'refused'}${missing}`;
  }
}

/**
 * The router's own 404 — this server does not have the endpoint yet — as opposed to jinbe saying the
 * person or organisation is not there. Fastify words its unmatched route as `Route GET:/… not found`.
 */
export function isNotAvailable(err: unknown): boolean {
  const message = (err as { message?: unknown } | null)?.message;
  return statusOf(err) === 404 && typeof message === 'string' && /^Route \S+ not found/.test(message);
}
