import { API_BASE, request } from './client';
import { bearerToken } from '../auth/session';
import { isNotAvailable } from './orgAccess';

/**
 * The audit API (`/api/audit/*`), typed from the contract in docs/research/audit-tab.md §4.4.
 *
 * jinbe builds the LogQL; the console only ever sends allow-listed facets, and every response says
 * what scope it was cut to and whether it is complete. Nothing here carries an email: actors and
 * targets are Kratos ids, and a name is shown only after an explicit lookup of that id.
 */

export type AuditResult = 'success' | 'denied' | 'failure' | 'error';
export type AuditSeverity = 'info' | 'warn' | 'high';
export type ChainStatus = 'verified' | 'unverified' | 'broken';

export interface AuditActor {
  type: 'user' | 'system' | 'service' | 'anonymous' | string;
  id?: string | null;
  session_id_hash?: string;
  ip_net?: string;
  ip_hmac?: string;
  ua_family?: string;
  auth?: { aal?: string; method?: string };
}

export interface AuditTarget {
  type: string;
  id?: string | null;
}

export interface AuditEventChanges {
  resource?: string;
  added?: string[];
  removed?: string[];
  summary?: string;
  changedKeys?: string[];
  fields?: Record<string, { from: unknown; to: unknown }>;
}

/** One `audit/v1` line, as the query API returns it. */
export interface AuditEventV1 {
  schema?: 'audit/v1' | string;
  event_id: string;
  ts: string;
  event: string;
  category: string;
  action: string;
  result: AuditResult;
  reason?: string | null;
  severity?: AuditSeverity;
  flags?: string[];
  actor: AuditActor;
  target?: AuditTarget | null;
  org_id?: string | null;
  site?: string | null;
  changes?: AuditEventChanges | null;
  source?: string;
  service_version?: string;
  request_id?: string | null;
  trace_id?: string | null;
  span_id?: string | null;
  /** The emitter's chain (one per process); `seq` counts within it. */
  chain_id?: string;
  seq?: number;
  prev_hash?: string;
  hash?: string;
  /** Backfilled from the legacy Redis trail: not integrity-protected. */
  integrity?: 'none' | string;
}

export interface AuditScope {
  orgs: string[];
  /** True for a platform reader (every org); false for an org admin cut to `orgs`. */
  platform: boolean;
}

export interface AuditEventsPage {
  events: AuditEventV1[];
  nextCursor: string | null;
  scope: AuditScope;
  range: { from: string; to: string };
  truncated: boolean;
  source?: string;
  queryMs?: number;
}

/** The facets the query accepts. Values are exact matches; `event` may end in `.*`. */
export interface AuditQuery {
  from: string;
  to: string;
  org?: string;
  actor?: string;
  target?: string;
  site?: string;
  /** Up to 10 catalog keys or prefixes (`org.*`). */
  event?: string[];
  category?: string;
  result?: string;
  severity?: string;
  trace_id?: string;
  q?: string;
}

export interface FacetCount { key: string; count: number }
export interface AuditFacets {
  event: FacetCount[];
  category: FacetCount[];
  result: FacetCount[];
  site: FacetCount[];
  actor: FacetCount[];
  org?: FacetCount[];
  severity?: FacetCount[];
  total?: number;
  /** Some facet had more than 20 keys: only the top 20 are listed. */
  truncated?: boolean;
}

export interface AuditWindowSummary {
  window: string;
  total: number;
  prev?: { total?: number; failed?: number; denied?: number };
  byCategory?: Record<string, number>;
  byResult?: Record<string, number>;
  series: { t: string; total: number; failed?: number }[];
  topDenied?: FacetCount[];
  topActors?: { actorId: string; count: number }[];
}

export interface AuditEventDetail {
  event: AuditEventV1;
  chain: ChainStatus;
}

export type ExportFormat = 'csv' | 'ndjson';
export type ExportStatus = 'queued' | 'running' | 'done' | 'failed';
export interface AuditExportJob {
  id: string;
  status: ExportStatus;
  /** jinbe's owner-only download route (`/api/audit/exports/:id/download`), live for 1 h. */
  url?: string | null;
  rows?: number;
  sha256?: string;
  truncated?: boolean;
  expiresAt?: string;
  error?: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  shared: boolean;
  orgId?: string | null;
  createdAt?: string;
  /** The caller owns it (only the owner may delete). */
  mine?: boolean;
}

export const MAX_RANGE_DAYS = 30;
export const PAGE_LIMIT = 50;
export const MAX_ENTRIES = 5000;

/** `from`, `to` and the facets as the query string jinbe expects (repeatable keys repeated). */
export function auditQueryString(q: Partial<AuditQuery> & { limit?: number; cursor?: string | null; ts?: string; window?: string }): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.filter(Boolean).forEach((x) => qs.append(k, String(x)));
    else qs.set(k, String(v));
  }
  return qs.toString();
}

const withQs = (path: string, qs: string) => (qs ? `${path}?${qs}` : path);

export const auditApi = {
  events: (q: AuditQuery, cursor?: string | null, limit = PAGE_LIMIT) =>
    request<AuditEventsPage>(withQs('/audit/events', auditQueryString({ ...q, limit, cursor }))),

  // Counts sit under `facets`, beside the page-level total/truncated.
  facets: (q: AuditQuery) =>
    request<{ facets?: AuditFacets; total?: number; truncated?: boolean } & Partial<AuditFacets>>(withQs('/audit/facets', auditQueryString(q)))
      .then((r): AuditFacets => ({ ...(r.facets ?? (r as AuditFacets)), total: r.total, truncated: r.truncated })),

  /** Totals and the series for the last `window` (`24h`, `7d`…) — jinbe takes only the window and org. */
  summary: (window: string, org?: string) =>
    request<AuditWindowSummary>(withQs('/audit/summary', auditQueryString({ window, org }))),

  event: (id: string, ts?: string) =>
    request<AuditEventDetail>(withQs(`/audit/events/${encodeURIComponent(id)}`, auditQueryString({ ts }))),

  userTimeline: (userId: string, range: { from: string; to: string }, cursor?: string | null) =>
    request<AuditEventsPage>(withQs(`/audit/users/${encodeURIComponent(userId)}/timeline`, auditQueryString({ ...range, cursor, limit: PAGE_LIMIT }))),

  startExport: (body: { from: string; to: string; filters: Omit<AuditQuery, 'from' | 'to'>; format: ExportFormat }) =>
    request<{ id: string }>('/audit/exports', { method: 'POST', body: JSON.stringify(body) }),

  exportJob: (id: string) => request<AuditExportJob>(`/audit/exports/${encodeURIComponent(id)}`),

  savedQueries: () => request<SavedQuery[] | { queries: SavedQuery[] }>('/audit/saved-queries')
    .then((r) => (Array.isArray(r) ? r : r.queries ?? [])),

  saveQuery: (body: { name: string; filters: Omit<AuditQuery, 'from' | 'to'>; shared: boolean; orgId?: string }) =>
    request<SavedQuery>('/audit/saved-queries', { method: 'POST', body: JSON.stringify(body) }),

  deleteQuery: (id: string) =>
    request<void>(`/audit/saved-queries/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /**
   * Fetch a finished export and hand it to the browser as a file. Through `fetch` rather than a link,
   * because the route is owner-only and a link cannot carry the bearer token.
   */
  download: async (url: string, filename: string) => {
    const path = url.replace(/^\/api(?=\/)/, '');
    const token = await bearerToken();
    const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw Object.assign(new Error(res.status === 410 ? 'This export has expired; run it again.' : `HTTP ${res.status}`), { status: res.status });
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(href);
  },

  /** The SSE address for the live tail. EventSource sends the cookie; it cannot send a bearer. */
  tailUrl: (q: Omit<AuditQuery, 'from' | 'to'>) => withQs(`${API_BASE}/audit/tail`, auditQueryString(q)),
};

export type AuditErrorKind = 'not-available' | 'store-down' | 'out-of-scope' | 'range' | 'busy' | 'failed';

/**
 * What a failed audit request means, in the words of audit-tab.md §5.2. A 503 is an outage and must
 * never read as an empty log; the router's own 404 means this jinbe has no audit API yet.
 */
export function auditErrorKind(err: unknown): AuditErrorKind {
  if (isNotAvailable(err)) return 'not-available';
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 503) return 'store-down';
  if (status === 403) return 'out-of-scope';
  if (status === 429) return 'busy';
  const code = (err as { code?: unknown } | null)?.code;
  if (status === 400 && (code === 'range_too_large' || code === 'invalid_range')) return 'range';
  return 'failed';
}

export const AUDIT_ERROR_COPY: Record<AuditErrorKind, { title: string; detail: string; retry: boolean }> = {
  'not-available': {
    title: 'Not available yet',
    detail: 'This server does not have the audit API yet. Events are still being recorded and will show here once it is deployed.',
    retry: false,
  },
  'store-down': {
    title: 'The audit store is unreachable',
    detail: 'This is an outage, not an empty log. Events are still being recorded and will appear once it recovers.',
    retry: true,
  },
  'out-of-scope': {
    title: 'Out of scope',
    detail: 'You can only see audit events for organisations you administer.',
    retry: false,
  },
  range: {
    title: 'Range too wide',
    detail: 'Pick 30 days or fewer per view. Use Export for longer periods.',
    retry: false,
  },
  busy: { title: 'Already running', detail: 'One at a time — wait for the running one to finish.', retry: true },
  failed: { title: 'Could not load the audit log', detail: 'The request failed.', retry: true },
};
