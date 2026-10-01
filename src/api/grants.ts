import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client';
import type { Grant, GrantDraft, HeldGrant } from '../lib/grants';

/**
 * Individual access (per-person grants), as jinbe serves it:
 *
 *   GET    /admin/users/:id/grants                               platform + every org's, each with `org`
 *   PUT    /admin/users/:id/grants            { grants: [...] }  adds these
 *   DELETE /admin/users/:id/grants/:grantId
 *   GET/PUT/DELETE /organizations/:org/users/:id/grants…          the same inside one organization
 *   GET    /admin/grants                                          everyone holding one (the review)
 *
 * A refusal (403) names each grant with why and what is missing (`refused`), read by `refusedGrantsOf`.
 * Read defensively: a field jinbe leaves out is absent, never invented.
 */

const enc = encodeURIComponent;
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);

function normalise(raw: Record<string, unknown>): Grant | null {
  const id = str(raw.id);
  const service = str(raw.service) ?? 'jinbe';
  const kind = raw.kind === 'role' ? 'role' : raw.kind === 'permission' ? 'permission' : null;
  const name = str(raw.name);
  if (!id || !kind || !name) return null;
  return {
    id, service, kind, name,
    ...(str(raw.org) ? { org: str(raw.org) } : {}),
    ...(str(raw.reason) ? { reason: str(raw.reason) } : {}),
    expiresAt: str(raw.expiresAt) ?? null,
    ...(str(raw.grantedBy) ? { grantedBy: str(raw.grantedBy) } : {}),
    ...(str(raw.grantedAt) ? { grantedAt: str(raw.grantedAt) } : {}),
  };
}

const list = (r: { grants?: unknown }): Grant[] =>
  (Array.isArray(r.grants) ? r.grants : []).flatMap((g) => (g && typeof g === 'object' ? [normalise(g as Record<string, unknown>)].filter((x): x is Grant => !!x) : []));

const base = (userId: string, org?: string) => (org ? `/organizations/${enc(org)}/users/${enc(userId)}/grants` : `/admin/users/${enc(userId)}/grants`);

export const grantsApi = {
  of: (userId: string, org?: string) => request<{ grants?: unknown }>(base(userId, org)).then(list),
  add: (userId: string, grants: GrantDraft[], org?: string) =>
    request<{ grants?: unknown }>(base(userId, org), { method: 'PUT', body: JSON.stringify({ grants }) }).then(list),
  remove: (userId: string, grantId: string, org?: string) =>
    request<void>(`${base(userId, org)}/${enc(grantId)}`, { method: 'DELETE' }),
  all: () =>
    request<{ grants?: unknown }>('/admin/grants').then((r) =>
      (Array.isArray(r.grants) ? r.grants : []).flatMap((raw): HeldGrant[] => {
        if (!raw || typeof raw !== 'object') return [];
        const g = normalise(raw as Record<string, unknown>);
        const s = (raw as { subject?: Record<string, unknown> }).subject;
        const subjectId = str(s?.id);
        return g && subjectId ? [{ ...g, subject: { id: subjectId, email: str(s?.email), name: str(s?.name) } }] : [];
      }),
    ),
};

/** One refused grant: which, why, and what the caller would need to hold. */
export interface RefusedGrant {
  service: string;
  kind: string;
  name: string;
  reason: string;
  missing: string[];
  grantedBy: string[];
}

export function refusedGrantsOf(err: unknown): RefusedGrant[] {
  const raw = (err as { details?: { refused?: unknown } } | null)?.details?.refused;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    const name = str(o.name) ?? str(o.role) ?? str(o.permission);
    if (!name) return [];
    return [{ service: str(o.service) ?? 'jinbe', kind: str(o.kind) ?? 'permission', name, reason: str(o.reason) ?? '', missing: strings(o.missing), grantedBy: strings(o.grantedBy) }];
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
