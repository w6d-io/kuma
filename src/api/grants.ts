import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client';
import type { Grant, GrantDraft, HeldGrant } from '../lib/grants';

/**
 * Individual access (per-person direct grants), as jinbe serves it:
 *
 *   GET    /admin/users/:id/grants                  users.grants:read    every scope
 *   PUT    /admin/users/:id/grants   { grants }     users.grants:write   REPLACES the whole set, every scope
 *   DELETE /admin/users/:id/grants/:grantId         users.grants:write
 *   GET/PUT/DELETE /organizations/:org/users/:id/grants…  org.members:read/write — that org's grants only
 *   GET    /admin/grants                            users.grants:read    everyone holding one: { people }
 *
 * A grant is { scope: 'platform' | orgId, app, kind, name, reason?, expiresAt? }; the console's own
 * shape names the app `service` and leaves `org` out on the platform. PUT replaces, so adding sends the
 * current set plus the new grants, keyed by scope, app, kind and name. A refusal (403) lists each
 * refused grant with its reasons, what is missing and who could grant it (`refusedGrantsOf`).
 */

const enc = encodeURIComponent;
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);
const PLATFORM = 'platform';

function normalise(raw: Record<string, unknown>): Grant | null {
  const id = str(raw.id);
  const service = str(raw.app) ?? str(raw.service) ?? 'jinbe';
  const kind = raw.kind === 'role' ? 'role' : raw.kind === 'permission' ? 'permission' : null;
  const name = str(raw.name);
  if (!id || !kind || !name) return null;
  const scope = str(raw.scope) ?? str(raw.org);
  return {
    id, service, kind, name,
    ...(scope && scope !== PLATFORM ? { org: scope } : {}),
    ...(str(raw.reason) ? { reason: str(raw.reason) } : {}),
    expiresAt: str(raw.expiresAt) ?? null,
    ...(str(raw.grantedBy) ? { grantedBy: str(raw.grantedBy) } : {}),
    ...(str(raw.grantedAt) ? { grantedAt: str(raw.grantedAt) } : {}),
    ...(raw.active === false ? { active: false } : {}),
  };
}

const list = (grants: unknown): Grant[] =>
  (Array.isArray(grants) ? grants : []).flatMap((g) => (g && typeof g === 'object' ? [normalise(g as Record<string, unknown>)].filter((x): x is Grant => !!x) : []));

/** What jinbe takes: the scope spelt out, `expiresAt` left out for "never". */
export function requestOf(g: GrantDraft & { org?: string }, org?: string) {
  return {
    scope: org ?? g.org ?? PLATFORM,
    app: g.service,
    kind: g.kind,
    name: g.name,
    ...(g.reason ? { reason: g.reason } : {}),
    ...(g.expiresAt ? { expiresAt: g.expiresAt } : {}),
  };
}

const keyOfGrant = (r: ReturnType<typeof requestOf>) => [r.scope, r.app, r.kind, r.name].join('|');

/** The current set with the new grants on top: a new one with the same key replaces the old one's reason and expiry. */
export function mergedRequests(current: readonly Grant[], drafts: readonly GrantDraft[], org?: string): ReturnType<typeof requestOf>[] {
  const out = new Map<string, ReturnType<typeof requestOf>>();
  for (const g of current) { const r = requestOf(g); out.set(keyOfGrant(r), r); }
  for (const d of drafts) { const r = requestOf(d, org); out.set(keyOfGrant(r), r); }
  return [...out.values()];
}

const base = (userId: string, org?: string) => (org ? `/organizations/${enc(org)}/users/${enc(userId)}/grants` : `/admin/users/${enc(userId)}/grants`);

export const grantsApi = {
  of: (userId: string, org?: string) => request<{ grants?: unknown }>(base(userId, org)).then((r) => list(r.grants)),
  /** Adds: reads the set this route replaces, then sends it back with the new grants. */
  add: async (userId: string, drafts: GrantDraft[], org?: string) => {
    const current = await grantsApi.of(userId, org);
    return request<{ grants?: unknown }>(base(userId, org), { method: 'PUT', body: JSON.stringify({ grants: mergedRequests(current, drafts, org) }) })
      .then((r) => list(r.grants));
  },
  remove: (userId: string, grantId: string, org?: string) =>
    request<unknown>(`${base(userId, org)}/${enc(grantId)}`, { method: 'DELETE' }),
  all: () =>
    request<{ people?: unknown }>('/admin/grants').then((r) =>
      (Array.isArray(r.people) ? r.people : []).flatMap((raw): HeldGrant[] => {
        if (!raw || typeof raw !== 'object') return [];
        const p = raw as Record<string, unknown>;
        const subjectId = str(p.id);
        if (!subjectId) return [];
        const subject = { id: subjectId, email: str(p.email), name: str(p.name) };
        return list(p.grants).map((g) => ({ ...g, subject }));
      }),
    ),
};

/** One refused grant: which, why, and what the caller would need to hold. */
export interface RefusedGrant {
  service: string;
  kind: string;
  name: string;
  /** The first of `reasons`, for the sentence. */
  reason: string;
  reasons: string[];
  missing: string[];
  grantedBy: string[];
  org?: string;
}

export function refusedGrantsOf(err: unknown): RefusedGrant[] {
  const raw = (err as { details?: { refused?: unknown } } | null)?.details?.refused;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    // An org-role refusal ({role, …}) in the same list is refusedOf's, not this one's.
    const g = (o.grant && typeof o.grant === 'object' ? o.grant : o) as Record<string, unknown>;
    const name = str(g.name);
    if (!name) return [];
    const reasons = strings(o.reasons).length ? strings(o.reasons) : strings(o.reason);
    const scope = str(g.scope);
    return [{
      service: str(g.app) ?? str(g.service) ?? 'jinbe', kind: str(g.kind) ?? 'permission', name,
      reason: reasons[0] ?? '', reasons, missing: strings(o.missing), grantedBy: strings(o.grantedBy),
      ...(scope && scope !== PLATFORM ? { org: scope } : {}),
    }];
  });
}

const keyOf = (userId: string, org?: string) => ['grants', userId, org ?? ''] as const;

export function useUserGrants(userId: string | undefined, org?: string) {
  return useQuery({ queryKey: keyOf(userId ?? '', org), queryFn: () => grantsApi.of(userId!, org), enabled: !!userId, retry: false });
}

export function useAllGrants(enabled = true) {
  return useQuery({ queryKey: ['grants', 'all'], queryFn: () => grantsApi.all(), enabled, retry: false });
}

export function useAddGrants(userId: string, org?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grants: GrantDraft[]) => grantsApi.add(userId, grants, org),
    onSettled: () => qc.invalidateQueries({ queryKey: ['grants'] }),
  });
}

export function useRemoveGrant(userId: string, org?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => grantsApi.remove(userId, grantId, org),
    onSettled: () => qc.invalidateQueries({ queryKey: ['grants'] }),
  });
}
