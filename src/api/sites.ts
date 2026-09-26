import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client';
import { bearerToken } from '../auth/session';
import { isNotAvailable } from './orgAccess';
import type {
  ApplyProgress, ApplyRequest, ApplyResult, BlastRadius, Check, DriftItem, DualRun, HostCheck, LoginReadiness,
  MatchResult, MigrationStatus, ParityReport, Preview, RenderResult, Site, SiteDetail, SiteDiff, SiteDraft,
  SiteEvent, SiteK8sStatus, SiteSummary, SiteVersion, Zone, MigrationGroup, HttpMethod,
} from '../lib/sites/types';
import { SANDBOX_ENABLED, type HandlerCatalog } from '../lib/sites/presets';

/**
 * /api/admin/sites (site-ux.md §14.2). The endpoints jinbe serves today (list, detail, drafts,
 * preview, diff, save, apply, versions, rollback, pause, resume, delete, blast radius, zones,
 * check-host, match, render) and the ones being built beside this screen (status + events, drift,
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
const PLANNED_STATIC = /^Site not found: (platform|migration|requests|deleted)$/;
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

export interface SiteError extends Error { status?: number; code?: string; details?: { checks?: Check[]; issues?: unknown } }

/** The checks an error carries (422 invalid_site, 409 checks_failed). */
export function checksOf(err: unknown): Check[] {
  return ((err as SiteError | null)?.details?.checks ?? []) as Check[];
}

export const sitesApi = {
  list: (opts: { system?: boolean } = {}) => request<SiteSummary[]>(`${BASE}${opts.system ? '?system=true' : ''}`),
  get: (name: string) => request<SiteDetail>(`${BASE}/${enc(name)}`),
  zones: () => request<Zone[]>(`${BASE}/zones`),
  checkHost: (body: { host: string; pathPrefix?: string; site?: string }) =>
    request<HostCheck>(`${BASE}/check-host`, { method: 'POST', body: json(body) }),
  probe: (url: string) => request<{ reachable: boolean; status?: number; latencyMs?: number; contentType?: string; kind?: string; openapi?: { url: string; operations: number; tags: number }; denied?: string }>(
    `${BASE}/probe`, { method: 'POST', body: json({ url }) }),

  getDraft: (name: string) => request<SiteDraft>(`${BASE}/${enc(name)}/draft`),
  putDraft: (name: string, site: Partial<Site>, baseVersion?: number) =>
    request<SiteDraft>(`${BASE}/${enc(name)}/draft`, { method: 'PUT', body: json({ site, ...(baseVersion != null ? { baseVersion } : {}) }) }),
  deleteDraft: (name: string) => request<void>(`${BASE}/${enc(name)}/draft`, { method: 'DELETE' }),

  preview: (site: Site) => request<Preview>(`${BASE}/preview`, { method: 'POST', body: json({ site }) }),
  diff: (name: string, site?: Site) => request<SiteDiff>(`${BASE}/${enc(name)}/diff`, { method: 'POST', body: json(site ? { site } : {}) }),
  save: (name: string, site: Site, opts: { note?: string; etag?: string } = {}) =>
    withHeaders<{ name: string; version: number; etag: string; savedAt: string }>(`${BASE}/${enc(name)}`, {
      method: 'PUT',
      body: json({ site, ...(opts.note ? { note: opts.note } : {}) }),
    }, opts.etag ? { 'If-Match': `"${opts.etag}"` } : {}),
  apply: (name: string, version: number) => request<ApplyResult>(`${BASE}/${enc(name)}/apply`, { method: 'POST', body: json({ version }) }),
  applyProgress: (name: string, applyId: string) => request<ApplyProgress>(`${BASE}/${enc(name)}/applies/${enc(applyId)}`),

  versions: (name: string) => request<SiteVersion[]>(`${BASE}/${enc(name)}/versions`),
  version: (name: string, v: number) => request<SiteVersion & { site: Site }>(`${BASE}/${enc(name)}/versions/${v}`),
  rollback: (name: string, toVersion: number, note?: string) =>
    request<ApplyResult>(`${BASE}/${enc(name)}/rollback`, { method: 'POST', body: json({ toVersion, ...(note ? { note } : {}) }) }),
  pause: (name: string) => request<{ name: string; state: string }>(`${BASE}/${enc(name)}/pause`, { method: 'POST' }),
  resume: (name: string) => request<{ name: string; state: string }>(`${BASE}/${enc(name)}/resume`, { method: 'POST' }),
  blastRadius: (name: string) => request<BlastRadius>(`${BASE}/${enc(name)}/blast-radius`),
  remove: (name: string) => request<{ name: string; deleted: boolean }>(`${BASE}/${enc(name)}`, { method: 'DELETE' }),
  clone: (name: string, body: { name: string; host: string }) => request<SiteDraft>(`${BASE}/${enc(name)}/clone`, { method: 'POST', body: json(body) }),

  match: (body: { method: HttpMethod; url: string; against: 'draft' | 'live'; site?: Site }) =>
    request<MatchResult>(`${BASE}/match`, { method: 'POST', body: json(body) }),
  render: (body: { template: string; kind: 'header' | 'cookie' | 'payload' | 'claims'; name?: string; sample: { email?: string; anonymous?: boolean; aal?: 'aal1' | 'aal2'; method: HttpMethod; url: string; pattern?: string } }) =>
    request<RenderResult>(`${BASE}/render`, { method: 'POST', body: json(body) }),

  // §14.2 NEW — built in parallel; screens show "not available yet" on the router's 404.
  status: (name: string) => request<SiteK8sStatus>(`${BASE}/${enc(name)}/status`),
  events: (name: string) => request<SiteEvent[]>(`${BASE}/${enc(name)}/events`),
  drift: (name: string) => request<{ items: DriftItem[] }>(`${BASE}/${enc(name)}/drift`),
  acceptDrift: (name: string) => request<SiteDraft>(`${BASE}/${enc(name)}/drift/accept`, { method: 'POST' }),
  requestApply: (name: string, body: { version: number; note?: string }) =>
    request<ApplyRequest>(`${BASE}/${enc(name)}/requests`, { method: 'POST', body: json(body) }),
  requests: (q: { state?: string; site?: string } = {}) => request<ApplyRequest[]>(`${BASE}/requests${Object.keys(q).length ? `?${new URLSearchParams(q as Record<string, string>)}` : ''}`),
  approveRequest: (id: string) => request<ApplyRequest>(`${BASE}/requests/${enc(id)}/approve`, { method: 'POST' }),
  rejectRequest: (id: string, reason?: string) => request<ApplyRequest>(`${BASE}/requests/${enc(id)}/reject`, { method: 'POST', body: json(reason ? { reason } : {}) }),
  loginReadiness: (name: string) => request<LoginReadiness>(`${BASE}/${enc(name)}/login/readiness`),
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
        const p = await request<{ env?: string; production?: boolean; fourEyes?: SitesPlatform['fourEyes']; rulesLoadExpectedSec?: number; handlers?: { enabled?: Partial<HandlerCatalog> } }>(`${BASE}/platform`);
        const e = p.handlers?.enabled;
        return { env: p.env, production: !!p.production, fourEyes: p.fourEyes, rulesLoadExpectedSec: p.rulesLoadExpectedSec, enabled: { ...SANDBOX_ENABLED, ...e }, source: 'platform' };
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
