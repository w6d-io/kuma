// The two layers of access, as jinbe answers them: site access comes from a person's groups and
// holds everywhere; org access is handed out by an org's admin and only counts on that org's routes.
// One module for the calls behind the Access view, the access checker and the My org page, so the
// shapes they read are written down once. Same `request` as client.ts — same errors.
import { request } from './client';
import { statusOf } from '../lib/apiError';

const enc = encodeURIComponent;

/** email → the groups granted to that person in one organisation. */
export type OrgGrants = Record<string, string[]>;

export interface AssignableGroup {
  name: string;
  /** What the group grants, per site: site → roles. */
  services: Record<string, string[]>;
}

export interface OrgAccessEntry {
  orgId: string;
  name: string;
  /** Administers this organisation (on its admin roster). */
  admin: boolean;
  /** Groups granted in this organisation only. */
  grants: string[];
}

export interface UserAccess {
  site: { groups: string[]; byService: Record<string, string[]> };
  orgs: OrgAccessEntry[];
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
  superAdmin: boolean;
}

export interface RefusedGroup {
  group: string;
  reason: string;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function normaliseAccess(raw: Partial<{ site: Partial<UserAccess['site']>; orgs: Partial<OrgAccessEntry>[] }>): UserAccess {
  return {
    site: { groups: strings(raw.site?.groups), byService: raw.site?.byService ?? {} },
    orgs: (raw.orgs ?? []).filter((o) => typeof o?.orgId === 'string').map((o) => ({
      orgId: o.orgId as string,
      name: o.name || (o.orgId as string),
      admin: o.admin === true,
      grants: strings(o.grants),
    })),
  };
}

export const orgAccessApi = {
  grants: (orgId: string) =>
    request<{ grants?: OrgGrants }>(`/organizations/${enc(orgId)}/grants`).then((r) => r.grants ?? {}),

  /** Replaces what this person is granted in this org. A 403 carries `refused` — read it with `refusedOf`. */
  setGrants: (orgId: string, userId: string, groups: string[]) =>
    request<{ email: string; groups: string[] }>(`/organizations/${enc(orgId)}/users/${enc(userId)}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ groups }),
    }),

  // An older server answers a list of names; read either, so the page works across the rollout.
  assignable: (orgId: string) =>
    request<{ groups?: (string | AssignableGroup)[] }>(`/organizations/${enc(orgId)}/assignable-groups`).then((r) =>
      (r.groups ?? []).map((g): AssignableGroup =>
        typeof g === 'string' ? { name: g, services: {} } : { name: g.name, services: g.services ?? {} },
      ),
    ),

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
    request<void>(`/organizations/${enc(orgId)}/users/${enc(userId)}`, { method: 'DELETE' }),

  /** Adds somebody who already has an account; their other memberships stay. */
  addMember: (orgId: string, userId: string) =>
    request<unknown>(`/organizations/${enc(orgId)}/users/${enc(userId)}/membership`, { method: 'PUT' }),
};

/** The groups a 403 on the grants write refused, each with why. Empty when there is no such list. */
export function refusedOf(err: unknown): RefusedGroup[] {
  const list = (err as { details?: { refused?: unknown } } | null)?.details?.refused;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (r): r is RefusedGroup => !!r && typeof r === 'object' && typeof (r as RefusedGroup).group === 'string',
  ).map((r) => ({ group: r.group, reason: typeof r.reason === 'string' ? r.reason : '' }));
}

/**
 * The router's own 404 — this server does not have the endpoint yet — as opposed to jinbe saying the
 * person or organisation is not there. Fastify words its unmatched route as `Route GET:/… not found`.
 */
export function isNotAvailable(err: unknown): boolean {
  const message = (err as { message?: unknown } | null)?.message;
  return statusOf(err) === 404 && typeof message === 'string' && /^Route \S+ not found/.test(message);
}
