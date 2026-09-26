import { MAX_RANGE_DAYS, type AuditQuery, type AuditScope } from '../../api/audit';

/**
 * The Audit tab's filters: what the facets, the range picker and the search box hold, how they
 * become the query jinbe accepts, and how they round-trip through the address so a view can be
 * pasted into a ticket or saved.
 *
 * The time window is mandatory and at most 30 days (Loki's max_query_length is 30d1h). Anything
 * the address carries is validated here, because the address is typed by people.
 */

export type RangePreset = '1h' | '24h' | '7d' | '30d' | 'custom';
export type FacetKey = 'event' | 'category' | 'result';

export interface AuditFilters {
  range: RangePreset;
  /** Only for `custom`: ISO instants. */
  from?: string;
  to?: string;
  org?: string;
  actor?: string;
  target?: string;
  site?: string;
  event: string[];
  category: string[];
  result: string[];
  severity?: string;
  trace_id?: string;
  q?: string;
}

export const EMPTY_FILTERS: AuditFilters = { range: '7d', event: [], category: [], result: [] };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const PRESET_MS: Record<Exclude<RangePreset, 'custom'>, number> = { '1h': HOUR, '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };
export const PRESET_LABEL: Record<RangePreset, string> = {
  '1h': 'Last hour', '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', custom: 'Custom range',
};

/** The instants a filter set covers, relative to `now` for the presets. */
export function resolveRange(f: AuditFilters, now: number = Date.now()): { from: string; to: string } {
  if (f.range === 'custom' && f.from && f.to) return { from: f.from, to: f.to };
  const span = PRESET_MS[f.range === 'custom' ? '7d' : f.range];
  return { from: new Date(now - span).toISOString(), to: new Date(now).toISOString() };
}

/** What is wrong with a range in words (audit-tab.md §5.2), or null. */
export function rangeProblem(from: string, to: string): string | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 'Pick a start and an end date.';
  if (b <= a) return 'The end must be after the start.';
  if (b - a > MAX_RANGE_DAYS * DAY + HOUR) return 'Pick 30 days or fewer per view. Use Export for longer periods.';
  return null;
}

/**
 * The query for jinbe. An org admin never sends `org`: jinbe forces their scope, and a stale org
 * from a pasted link would only earn a 403.
 */
export function toQuery(f: AuditFilters, scope?: AuditScope | null, now: number = Date.now()): AuditQuery {
  const q: AuditQuery = { ...resolveRange(f, now) };
  if (f.org && scope?.platform !== false) q.org = f.org;
  if (f.actor) q.actor = f.actor;
  if (f.target) q.target = f.target;
  if (f.site) q.site = f.site;
  if (f.event.length) q.event = f.event.slice(0, MAX_EVENTS);
  if (f.category.length) q.category = f.category[0];
  if (f.result.length) q.result = f.result[0];
  if (f.severity) q.severity = f.severity;
  if (f.trace_id) q.trace_id = f.trace_id;
  if (f.q?.trim()) q.q = f.q.trim().slice(0, 64);
  return q;
}

/** jinbe takes up to 10 event keys, but one category and one result. */
export const MAX_EVENTS = 10;
export const SINGLE_FACETS: ReadonlySet<FacetKey> = new Set(['category', 'result']);

export function toggleFacet(f: AuditFilters, key: FacetKey, value: string): AuditFilters {
  const cur = f[key];
  if (cur.includes(value)) return { ...f, [key]: cur.filter((v) => v !== value) };
  if (SINGLE_FACETS.has(key)) return { ...f, [key]: [value] };
  return { ...f, [key]: [...cur, value].slice(-MAX_EVENTS) };
}

/** How many narrowing filters are on, not counting the range. */
export function activeCount(f: AuditFilters): number {
  return f.event.length + f.category.length + f.result.length
    + [f.org, f.actor, f.target, f.site, f.severity, f.trace_id, f.q?.trim()].filter(Boolean).length;
}

export function clearFilters(f: AuditFilters): AuditFilters {
  return { ...EMPTY_FILTERS, range: f.range, from: f.from, to: f.to };
}

/** Zoom the range to one histogram bucket. */
export function zoomTo(f: AuditFilters, bucketStart: string, bucketMs: number): AuditFilters {
  const a = Date.parse(bucketStart);
  if (Number.isNaN(a) || bucketMs <= 0) return f;
  return { ...f, range: 'custom', from: new Date(a).toISOString(), to: new Date(a + bucketMs).toISOString() };
}

// ── Address round-trip ────────────────────────────────────────────────────────

const EVENT_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*(\.\*)?$/;
const WORD_RE = /^[\w.:@-]{1,128}$/;
const PRESETS: RangePreset[] = ['1h', '24h', '7d', '30d', 'custom'];

const list = (v: string | undefined, ok: (x: string) => boolean) =>
  (v ?? '').split(',').map((x) => x.trim()).filter((x) => x && ok(x));
const word = (v: string | undefined) => (v && WORD_RE.test(v) ? v : undefined);
const iso = (v: string | undefined) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);

/** The filters as flat strings for `#/audit?…` and for a saved view. Empty values are left out. */
export function filtersToParams(f: AuditFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.range !== EMPTY_FILTERS.range) out.range = f.range;
  if (f.range === 'custom') {
    if (f.from) out.from = f.from;
    if (f.to) out.to = f.to;
  }
  for (const k of ['org', 'actor', 'target', 'site', 'severity', 'trace_id', 'q'] as const) {
    const v = f[k];
    if (v) out[k] = v;
  }
  for (const k of ['event', 'category', 'result'] as const) if (f[k].length) out[k] = f[k].join(',');
  return out;
}

export function filtersFromParams(p: Record<string, string> | undefined): AuditFilters {
  if (!p) return { ...EMPTY_FILTERS };
  const range = PRESETS.includes(p.range as RangePreset) ? (p.range as RangePreset) : EMPTY_FILTERS.range;
  const f: AuditFilters = {
    range,
    event: list(p.event, (x) => EVENT_RE.test(x)).slice(0, MAX_EVENTS),
    category: list(p.category, (x) => /^[a-z_]+$/.test(x)).slice(0, 1),
    result: list(p.result, (x) => ['success', 'denied', 'failure', 'error'].includes(x)).slice(0, 1),
  };
  if (range === 'custom') {
    const from = iso(p.from);
    const to = iso(p.to);
    if (from && to && !rangeProblem(from, to)) Object.assign(f, { from, to });
    else f.range = EMPTY_FILTERS.range;
  }
  const org = word(p.org); if (org) f.org = org;
  const actor = word(p.actor); if (actor) f.actor = actor;
  const target = word(p.target); if (target) f.target = target;
  const site = word(p.site); if (site) f.site = site;
  if (p.severity && ['info', 'warn', 'high'].includes(p.severity)) f.severity = p.severity;
  if (p.trace_id && /^[0-9a-f]{32}$/.test(p.trace_id)) f.trace_id = p.trace_id;
  if (p.q) f.q = p.q.slice(0, 64);
  return f;
}

// ── Saved queries on the server ──────────────────────────────────────────────

/** jinbe's saved-query `filters`: the facets only (no range), typed as its query accepts them. */
export type ServerFilters = Omit<AuditQuery, 'from' | 'to'>;

export function toServerFilters(params: Record<string, string>): ServerFilters {
  const q = toQuery(filtersFromParams(params), null, 0);
  const out: Partial<AuditQuery> = { ...q };
  delete out.from;
  delete out.to;
  return out as ServerFilters;
}

export function fromServerFilters(filters: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters ?? {})) {
    if (Array.isArray(v)) { if (v.length) out[k] = v.map(String).join(','); } else if (v != null && v !== '') out[k] = String(v);
  }
  return filtersToParams(filtersFromParams(out));
}
