import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client';
import { bearerToken } from '../auth/session';
import { isNotAvailable } from './orgAccess';
import type {
  ApplyProgress, ApplyRequest, ApplyResult, BlastRadius, Check, DeletionRequest, DriftItem, EphemeralLimits, EphemeralView, Finding, DualRun, HostCheck,
  MatchResult, MigrationStatus, ParityReport, Preview, RenderResult, Site, SiteDetail, SiteDiff, SiteDraft, DraftConflict,
  SiteK8sStatus, SiteSummary, SiteVersion, Zone, MigrationGroup, HttpMethod,
  GatewayInfo, ZoneDetail, ZoneGatewayRef, ZoneIngress,
} from '../lib/sites/types';
import { SANDBOX_ENABLED, type HandlerCatalog } from '../lib/sites/presets';
import type { VerifyReport } from '../lib/sites/verify';

/**
 * /api/admin/sites (site-ux.md §14.2). The endpoints jinbe serves today (list, detail, drafts,
 * preview, diff, save, apply, versions, rollback, pause, resume, delete, blast radius, zones,
 * check-host, match, render) and the ones being built beside this screen (status, drift,
 * requests, login publish, migration). A route jinbe does not have answers with the router's own
 * 404 ("Route GET … not found"), which `notAvailable` recognises so a screen can say "not
 * available yet" instead of failing.
 */

const BASE = '/admin/sites';
const enc = encodeURIComponent;
const json = (body: unknown) => JSON.stringify(body);

/**
 * A route jinbe does not have yet. Two shapes: the router's own 404 ("Route GET … not found"), and —
 * for the planned static paths under /sites (`/platform`, `/migration`, `/requests`, `/deleted`) —
 * the `/:name` route answering that no site has that name.
 */
const PLANNED_STATIC = /^Site not found: (platform|migration|requests|deleted|deletion-requests)$/;
export function notAvailable(err: unknown): boolean {
  if (isNotAvailable(err)) return true;
  const e = err as { status?: number; message?: unknown } | null;
  return e?.status === 404 && typeof e.message === 'string' && PLANNED_STATIC.test(e.message);
}

/**
 * `request` replaces its whole header set when a caller passes headers, dropping its own JSON
 * content type and bearer token — so a call that needs one more header (If-Match, an image type)
 * states all of them here.
 */
export async function withHeaders<T>(path: string, init: RequestInit, extra: Record<string, string>, contentType = 'application/json'): Promise<T> {
  const token = await bearerToken();
  return request<T>(path, { ...init, headers: { 'Content-Type': contentType, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra } });
}

export interface SiteError extends Error { status?: number; code?: string; details?: { checks?: Check[]; issues?: unknown; findings?: Finding[] } }

/** The findings a refused publish carries (422 unconfirmed_findings: only the unresolved ones). */
export function findingsOf(err: unknown): Finding[] | null {
  const e = err as SiteError | null;
  return e?.code === 'unconfirmed_findings' ? e.details?.findings ?? [] : null;
}

/** The draft somebody else saved, when an autosave was refused for it (412 stale_draft); null otherwise. */
export function draftConflictOf(err: unknown): DraftConflict | null {
  const e = err as (SiteError & { details?: { current?: Partial<DraftConflict> } }) | null;
  if (e?.status !== 412 || e.code !== 'stale_draft') return null;
  const c = e.details?.current ?? {};
  return { etag: c.etag ?? '', updatedBy: c.updatedBy || 'Someone', updatedAt: c.updatedAt ?? null, baseVersion: c.baseVersion };
}

/** The checks an error carries (422 invalid_site, 409 checks_failed). */
export function checksOf(err: unknown): Check[] {
  return ((err as SiteError | null)?.details?.checks ?? []) as Check[];
}

export const sitesApi = {
  list: (opts: { system?: boolean } = {}) => request<SiteSummary[]>(`${BASE}${opts.system ? '?system=true' : ''}`),
  get: (name: string) => request<SiteDetail>(`${BASE}/${enc(name)}`),
  zones: () => request<Zone[]>(`${BASE}/zones`),
  zone: (name: string) => request<ZoneDetail>(`${BASE}/zones/${enc(name)}`),
  /** No gateway and no ingress: jinbe picks the WAF-protected Gateway. `acknowledgeNoWaf`: nginx on purpose. */
  createZone: (body: { domain: string; ingress?: ZoneIngress; tls?: ZoneDetail['tls']; gateway?: ZoneGatewayRef; acknowledgeNoWaf?: boolean }) =>
    request<ZoneDetail>(`${BASE}/zones`, { method: 'POST', body: json(body) }),
  /** The exposure only (never the domain); `confirm` drops the Ingress despite the DNS check. */
  updateZone: (name: string, body: { ingress?: ZoneIngress; gateway?: ZoneGatewayRef | null; tls?: ZoneDetail['tls']; confirm?: boolean; acknowledgeNoWaf?: boolean }) =>
    request<ZoneDetail>(`${BASE}/zones/${enc(name)}`, { method: 'PATCH', body: json(body) }),
  /** The Gateways a zone may be attached to, with their WAF / IP reputation state. */
  gateways: () => request<{ gateways: GatewayInfo[] }>(`${BASE}/gateways`),
  checkHost: (body: { host: string; pathPrefix?: string; site?: string }) =>
    request<HostCheck>(`${BASE}/check-host`, { method: 'POST', body: json(body) }),

  getDraft: (name: string) => request<SiteDraft>(`${BASE}/${enc(name)}/draft`),
  /**
   * `etag`: the draft this edit started from, sent as If-Match — someone else's autosave since is
   * 412 stale_draft (draftConflictOf). Without one there was no draft: If-None-Match * asks that
   * none appeared meanwhile, so neither side overwrites the other silently.
   */
  putDraft: (name: string, site: Partial<Site>, baseVersion?: number, etag?: string) =>
    withHeaders<SiteDraft>(`${BASE}/${enc(name)}/draft`, { method: 'PUT', body: json({ site, ...(baseVersion != null ? { baseVersion } : {}) }) },
      etag ? { 'If-Match': `"${etag}"` } : { 'If-None-Match': '*' }),
  deleteDraft: (name: string) => request<void>(`${BASE}/${enc(name)}/draft`, { method: 'DELETE' }),

  preview: (site: Site) => request<Preview>(`${BASE}/preview`, { method: 'POST', body: json({ site }) }),
  diff: (name: string, site?: Site) => request<SiteDiff>(`${BASE}/${enc(name)}/diff`, { method: 'POST', body: json(site ? { site } : {}) }),
  /** `ephemeral`: paused automatically `ttl` seconds after this save; left out, the lifetime is unchanged. */
  save: (name: string, site: Site, opts: { note?: string; etag?: string; ephemeral?: { ttl?: number } } = {}) =>
    withHeaders<{ name: string; version: number; etag: string; savedAt: string; ephemeral?: EphemeralView | null }>(`${BASE}/${enc(name)}`, {
      method: 'PUT',
      body: json({ site, ...(opts.note ? { note: opts.note } : {}), ...(opts.ephemeral ? { ephemeral: opts.ephemeral } : {}) }),
    }, opts.etag ? { 'If-Match': `"${opts.etag}"` } : {}),
  /** `acknowledge`: the confirm finding codes a person accepted (422 unconfirmed_findings without them). */
  apply: (name: string, version: number, acknowledge?: string[]) =>
    request<ApplyResult>(`${BASE}/${enc(name)}/apply`, { method: 'POST', body: json({ version, ...(acknowledge?.length ? { acknowledge } : {}) }) }),
  applyProgress: (name: string, applyId: string) => request<ApplyProgress>(`${BASE}/${enc(name)}/applies/${enc(applyId)}`),

  versions: (name: string) => request<SiteVersion[]>(`${BASE}/${enc(name)}/versions`),
  version: (name: string, v: number) => request<SiteVersion & { site: Site }>(`${BASE}/${enc(name)}/versions/${v}`),
  rollback: (name: string, toVersion: number, note?: string) =>
    request<ApplyResult>(`${BASE}/${enc(name)}/rollback`, { method: 'POST', body: json({ toVersion, ...(note ? { note } : {}) }) }),
  pause: (name: string) => request<{ name: string; state: string }>(`${BASE}/${enc(name)}/pause`, { method: 'POST' }),
  resume: (name: string) => request<{ name: string; state: string }>(`${BASE}/${enc(name)}/resume`, { method: 'POST' }),
  signUpMembers: (name: string, limit = 200) => request<SignUpMembers>(`${BASE}/${enc(name)}/sign-up/members?limit=${limit}`),
  removeSignUpMember: (name: string, id: string) => request<{ removed: boolean }>(`${BASE}/${enc(name)}/sign-up/members/${enc(id)}`, { method: 'DELETE' }),
  removeAllSignUpMembers: (name: string) => request<{ removed: number }>(`${BASE}/${enc(name)}/sign-up/members`, { method: 'DELETE' }),
  blastRadius: (name: string) => request<BlastRadius>(`${BASE}/${enc(name)}/blast-radius`),
  remove: (name: string) => request<{ name: string; deleted: boolean }>(`${BASE}/${enc(name)}`, { method: 'DELETE' }),

  match: (body: { method: HttpMethod; url: string; against: 'draft' | 'live'; site?: Site }) =>
    request<MatchResult>(`${BASE}/match`, { method: 'POST', body: json(body) }),
  render: (body: { template: string; kind: 'header' | 'cookie' | 'payload' | 'claims'; name?: string; sample: { email?: string; anonymous?: boolean; aal?: 'aal1' | 'aal2'; method: HttpMethod; url: string; pattern?: string } }) =>
    request<RenderResult>(`${BASE}/render`, { method: 'POST', body: json(body) }),

  // §14.2 NEW — built in parallel; screens show "not available yet" on the router's 404.
  status: (name: string) => request<SiteK8sStatus>(`${BASE}/${enc(name)}/status`),
  drift: (name: string) => request<{ items: DriftItem[] }>(`${BASE}/${enc(name)}/drift`),
  acceptDrift: (name: string) => request<SiteDraft>(`${BASE}/${enc(name)}/drift/accept`, { method: 'POST' }),
  requestApply: (name: string, body: { version: number; note?: string; acknowledge?: string[] }) =>
    request<ApplyRequest>(`${BASE}/${enc(name)}/requests`, { method: 'POST', body: json(body) }),
  requests: (q: { state?: string; site?: string } = {}) => request<ApplyRequest[]>(`${BASE}/requests${Object.keys(q).length ? `?${new URLSearchParams(q as Record<string, string>)}` : ''}`),
  approveRequest: (id: string, acknowledge?: string[]) =>
    request<ApplyRequest>(`${BASE}/requests/${enc(id)}/approve`, { method: 'POST', ...(acknowledge?.length ? { body: json({ acknowledge }) } : {}) }),
  rejectRequest: (id: string, reason?: string) => request<ApplyRequest>(`${BASE}/requests/${enc(id)}/reject`, { method: 'POST', body: json(reason ? { reason } : {}) }),
  /** Rollout, anonymous probes, access matrix and curl lines for what is live. One run per site per 30 s. */
  verify: (name: string, opts: { waf?: boolean } = {}) =>
    request<VerifyReport>(`${BASE}/${enc(name)}/verify`, { method: 'POST', body: json(opts.waf ? { waf: true } : {}) }),
  // Lifecycle (wave 19): extending an ephemeral site, and deletion requests decided by somebody else.
  /** Expiry becomes now + `ttl` seconds (its own TTL when left out). An expired site stays paused. */
  extend: (name: string, ttl?: number) =>
    request<{ name: string; state?: string; ephemeral: EphemeralView; hint?: string }>(`${BASE}/${enc(name)}/ttl`, { method: 'POST', body: json(ttl ? { ttl } : {}) }),
  requestDeletion: (name: string, reason?: string) =>
    request<DeletionRequest>(`${BASE}/${enc(name)}/deletion-requests`, { method: 'POST', body: json(reason ? { reason } : {}) }),
  deletionRequests: (q: { state?: DeletionRequest['state']; site?: string } = {}) =>
    request<DeletionRequest[]>(`${BASE}/deletion-requests${Object.keys(q).length ? `?${new URLSearchParams(q as Record<string, string>)}` : ''}`),
  /** The inbox: pending, oldest first, each with `requestedByYou`. */
  pendingDeletions: () => request<DeletionRequest[]>(`${BASE}/deletion-requests/pending`),
  approveDeletion: (id: string) =>
    request<{ request: DeletionRequest; name?: string; deleted?: boolean }>(`${BASE}/deletion-requests/${enc(id)}/approve`, { method: 'POST' }),
  rejectDeletion: (id: string, reason?: string) =>
    request<DeletionRequest>(`${BASE}/deletion-requests/${enc(id)}/reject`, { method: 'POST', body: json(reason ? { reason } : {}) }),
  deleteLogo: (name: string) => request<void>(`${BASE}/${enc(name)}/logo`, { method: 'DELETE' }),
  uploadLogo: (name: string, file: Blob) =>
    withHeaders<{ logo: string }>(`${BASE}/${enc(name)}/logo`, { method: 'PUT', body: file }, {}, file.type),

  migration: () => request<MigrationStatus>(`${BASE}/migration`),
  migrationPreview: (body: { fixes?: Record<string, string[]>; decisions?: Record<string, 'drop'> } = {}) =>
    request<{ groups: MigrationGroup[] }>(`${BASE}/migration/preview`, { method: 'POST', body: json(body) }),
  migrationParity: () => request<ParityReport>(`${BASE}/migration/parity`, { method: 'POST' }),
  migrationDualRun: (action: 'start' | 'stop') => request<DualRun>(`${BASE}/migration/dualrun`, { method: 'POST', body: json({ action }) }),
  migrationDualRunStatus: () => request<DualRun>(`${BASE}/migration/dualrun`),
  migrationCutover: (note?: string) => request<{ state: string; cutover?: unknown }>(`${BASE}/migration/cutover`, { method: 'POST', body: json(note ? { note } : {}) }),
  migrationRollback: () => request<{ ok: boolean }>(`${BASE}/migration/rollback`, { method: 'POST' }),
};

// ── query hooks ───────────────────────────────────────────────

export const siteKeys = {
  all: ['sites'] as const,
  list: () => ['sites', 'list'] as const,
  detail: (name: string) => ['sites', 'detail', name] as const,
  draft: (name: string) => ['sites', 'draft', name] as const,
  versions: (name: string) => ['sites', 'versions', name] as const,
  status: (name: string) => ['sites', 'status', name] as const,
  zones: () => ['sites', 'zones'] as const,
  gateways: () => ['sites', 'gateways'] as const,
  deletions: () => ['sites', 'deletions'] as const,
};

/** 404s are answers here (no draft, not built yet), not failures to retry. */
const noRetry404 = (count: number, err: unknown) => (err as SiteError)?.status !== 404 && count < 2;

export function useSites() {
  return useQuery({ queryKey: siteKeys.list(), queryFn: () => sitesApi.list(), retry: noRetry404 });
}

export function useSite(name: string | null) {
  return useQuery({ queryKey: siteKeys.detail(name ?? ''), queryFn: () => sitesApi.get(name!), enabled: !!name, retry: noRetry404 });
}

/** The server draft, or null when there is none (404 no draft). */
export function useSiteDraft(name: string | null) {
  return useQuery({
    queryKey: siteKeys.draft(name ?? ''),
    queryFn: async () => {
      try {
        return await sitesApi.getDraft(name!);
      } catch (err) {
        if ((err as SiteError).status === 404 && !notAvailable(err)) return null;
        throw err;
      }
    },
    enabled: !!name,
    retry: noRetry404,
  });
}

export function useGateways() {
  return useQuery({ queryKey: siteKeys.gateways(), queryFn: () => sitesApi.gateways(), staleTime: 60_000, retry: noRetry404 });
}

export function useZones() {
  return useQuery({ queryKey: siteKeys.zones(), queryFn: () => sitesApi.zones(), staleTime: 5 * 60_000, retry: noRetry404 });
}

export function useVersions(name: string) {
  return useQuery({ queryKey: siteKeys.versions(name), queryFn: () => sitesApi.versions(name), retry: noRetry404 });
}

/** Site CR status; polls while `live` (Apply, Status tab). */
export function useSiteStatus(name: string, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: siteKeys.status(name),
    queryFn: () => sitesApi.status(name),
    retry: noRetry404,
    refetchInterval: (q) => (opts.poll && !notAvailable(q.state.error) ? 2000 : false),
  });
}

export function useInvalidateSite() {
  const qc = useQueryClient();
  return (name?: string) => {
    void qc.invalidateQueries({ queryKey: siteKeys.list() });
    if (name) {
      void qc.invalidateQueries({ queryKey: siteKeys.detail(name) });
      void qc.invalidateQueries({ queryKey: siteKeys.draft(name) });
      void qc.invalidateQueries({ queryKey: siteKeys.versions(name) });
      void qc.invalidateQueries({ queryKey: siteKeys.status(name) });
    }
  };
}

export function useSaveDraft(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { site: Partial<Site>; baseVersion?: number }) => sitesApi.putDraft(name, v.site, v.baseVersion),
    onSuccess: (draft) => {
      qc.setQueryData(siteKeys.draft(name), draft);
      void qc.invalidateQueries({ queryKey: siteKeys.list() });
    },
  });
}

export interface SitesPlatform {
  env?: string;
  production: boolean;
  fourEyes?: 'off' | 'high-risk' | 'all';
  rulesLoadExpectedSec?: number;
  /** The TTLs an ephemeral site may have; absent on a jinbe without ephemeral sites. */
  ephemeral?: EphemeralLimits;
  enabled: HandlerCatalog;
  /** Where the answer came from: the planned `/sites/platform`, the gateway's handler catalog, or the sandbox defaults. */
  source: 'platform' | 'catalog' | 'default';
}

/**
 * What the gateway runs (site-ux.md §14.2 `GET /sites/platform`). Until that endpoint exists the
 * enabled handlers come from the existing catalog (`/admin/rbac/oathkeeper/handlers`, enabled only),
 * and failing that from the sandbox's known set — never from a guess that unlocks more.
 */
export function useSitesPlatform() {
  return useQuery({
    queryKey: ['sites', 'platform'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<SitesPlatform> => {
      try {
        const p = await request<{ env?: string; production?: boolean; fourEyes?: SitesPlatform['fourEyes']; rulesLoadExpectedSec?: number; ephemeral?: EphemeralLimits; handlers?: { enabled?: Partial<HandlerCatalog> } }>(`${BASE}/platform`);
        const e = p.handlers?.enabled;
        return { env: p.env, production: !!p.production, fourEyes: p.fourEyes, rulesLoadExpectedSec: p.rulesLoadExpectedSec, ephemeral: p.ephemeral, enabled: { ...SANDBOX_ENABLED, ...e }, source: 'platform' };
      } catch { /* not built yet */ }
      try {
        const c = await request<{ authenticators: Array<{ handler: string }>; authorizers: Array<{ handler: string }>; mutators: Array<{ handler: string }>; errorHandlers: Array<{ handler: string }> }>('/admin/rbac/oathkeeper/handlers');
        const names = (xs: Array<{ handler: string }>) => xs.map((x) => x.handler);
        return { production: false, enabled: { authenticators: names(c.authenticators), authorizers: names(c.authorizers), mutators: names(c.mutators), errors: names(c.errorHandlers) }, source: 'catalog' };
      } catch {
        return { production: false, enabled: SANDBOX_ENABLED, source: 'default' };
      }
    },
  });
}

/** GET /sites/:name/sign-up/members: who joined the site's sign-up group. */
export interface SignUpMembers {
  site: string;
  group: string;
  total: number;
  members: Array<{ id: string; email: string | null; name: string | null; createdAt: string | null; organizations: Array<{ id: string; name: string | null }> }>;
}
