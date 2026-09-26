import type { BadgeTone } from '../../components/ui';
import type { AuditActor, AuditEventV1, AuditResult } from '../../api/audit';
import { formatHash } from '../route';

/**
 * How one `audit/v1` event reads on screen: who, what, the result, the day it falls under, and the
 * links it offers. Pure functions, so the rules (a pseudonymous id until somebody asks, a trace link
 * only while Tempo still has the trace) are tested without a browser.
 */

/** Tempo keeps traces 7 days (obs-flow §9); a link after that opens nothing. */
export const TRACE_RETENTION_MS = 7 * 24 * 3_600_000;

/** A short, stable handle for an id nobody has looked up: `3f2a9c10`. */
export function shortId(id: string | null | undefined): string {
  return (id ?? '').replace(/-/g, '').slice(0, 8) || '—';
}

export interface ActorLabel {
  kind: 'user' | 'system' | 'anonymous' | 'service';
  primary: string;
  secondary?: string;
}

/**
 * The actor as a person would name it. `revealed` is what a user lookup answered for this id; until
 * then the actor is a pseudonymous handle, and a lookup that found nobody reads as a deleted user.
 */
export function actorLabel(actor: AuditActor, revealed?: { name?: string; email?: string } | null | 'missing'): ActorLabel {
  if (actor.type === 'system') return { kind: 'system', primary: 'system' };
  if (actor.type === 'anonymous' || !actor.id) return { kind: 'anonymous', primary: 'anonymous' };
  if (actor.type === 'service') return { kind: 'service', primary: `service · ${shortId(actor.id)}` };
  if (revealed === 'missing') return { kind: 'user', primary: `deleted user · ${shortId(actor.id)}` };
  if (revealed && (revealed.name || revealed.email)) {
    return { kind: 'user', primary: revealed.name || revealed.email!, secondary: revealed.name ? revealed.email : undefined };
  }
  return { kind: 'user', primary: `user · ${shortId(actor.id)}` };
}

const PHRASES: Record<string, string> = {
  'org.grants.changed': 'changed grants',
  'org.grants.refused': 'grant refused',
  'auth.login.succeeded': 'signed in',
  'auth.login.failed': 'sign-in failed',
  'auth.logout': 'signed out',
  'auth.session.revoked': 'revoked a session',
  'auth.session.revoked_all': 'revoked all sessions',
  'access.denied': 'denied',
  'access.decision': 'gateway decision',
  'access.checked': 'checked access',
  'audit.exported': 'exported the audit log',
  'audit.queried': 'queried the audit log',
};

/** The event key as words: `rbac.group.created` → "group created". */
export function eventPhrase(event: string): string {
  if (PHRASES[event]) return PHRASES[event];
  const parts = event.split('.');
  return (parts.length > 1 ? parts.slice(1) : parts).join(' ').replace(/_/g, ' ');
}

/** What the event did, in one line for the row. */
export function eventSummary(e: AuditEventV1): string {
  if (e.changes?.summary) return e.changes.summary;
  const route = routeOf(e);
  if (route) return `${route.method} ${route.path}`;
  const t = e.target;
  return t?.type ? `${t.type}${t.id ? ` · ${t.type === 'user' ? shortId(t.id) : t.id}` : ''}` : '';
}

export function resultTone(r: AuditResult | string): BadgeTone {
  if (r === 'success') return 'success';
  if (r === 'denied' || r === 'failure' || r === 'error') return 'danger';
  return 'neutral';
}

export function severityTone(s: string | undefined): BadgeTone | null {
  if (s === 'high') return 'danger';
  if (s === 'warn') return 'warning';
  return null;
}

/** The route of an access event, when the target names one (`PUT /organizations/x/grants`). */
export function routeOf(e: AuditEventV1): { method: string; path: string } | null {
  const id = e.target?.id ?? '';
  const m = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)$/.exec(id);
  return m ? { method: m[1], path: m[2] } : null;
}

// ── Day grouping ──────────────────────────────────────────────────────────────

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface DayGroup { key: string; label: string; events: AuditEventV1[] }

/** Newest-first events filed under their local day, "Today" and "Yesterday" named. */
export function groupByDay(events: AuditEventV1[], now: number = Date.now()): DayGroup[] {
  const today = dayKey(new Date(now));
  const yesterday = dayKey(new Date(now - 86_400_000));
  const out: DayGroup[] = [];
  for (const e of events) {
    const d = new Date(e.ts);
    const key = Number.isNaN(+d) ? 'unknown' : dayKey(d);
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      const label = key === today ? 'Today' : key === yesterday ? 'Yesterday'
        : key === 'unknown' ? 'Unknown date' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      g = { key, label, events: [] };
      out.push(g);
    }
    g.events.push(e);
  }
  return out;
}

export function timeOf(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(+d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Links ─────────────────────────────────────────────────────────────────────

export type TraceLink = { kind: 'none' } | { kind: 'expired' } | { kind: 'link'; url: string };

/**
 * Grafana Explore on Tempo for the event's trace. Only the trace id goes into the URL — never an
 * email, a name or a session id (OBS-4.2). None without a Grafana base or a trace id; "expired"
 * once Tempo has dropped it.
 */
export function traceLink(e: Pick<AuditEventV1, 'trace_id' | 'ts'>, grafanaBase: string | undefined, now: number = Date.now()): TraceLink {
  const base = (grafanaBase ?? '').replace(/\/$/, '');
  if (!e.trace_id || !/^[0-9a-f]{16,32}$/i.test(e.trace_id)) return { kind: 'none' };
  const at = Date.parse(e.ts);
  if (!Number.isNaN(at) && now - at > TRACE_RETENTION_MS) return { kind: 'expired' };
  if (!base || base.startsWith('${')) return { kind: 'none' };
  const panes = {
    a: {
      datasource: 'tempo',
      queries: [{ refId: 'A', datasource: { type: 'tempo' }, queryType: 'traceql', query: e.trace_id }],
      range: { from: 'now-7d', to: 'now' },
    },
  };
  return { kind: 'link', url: `${base}/explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify(panes))}` };
}

export function grafanaBase(): string | undefined {
  return (window as unknown as { __GRAFANA_URL__?: string }).__GRAFANA_URL__;
}

/**
 * The Access checker address for "why was this denied?": the same person, method, path and site,
 * asked of the policy as it stands now. The checker takes an email, so the caller must have
 * revealed the actor first.
 */
export function whyDeniedHash(e: AuditEventV1, email: string): string | null {
  const route = routeOf(e);
  if (!route || !email) return null;
  return `#${formatHash('accesscheck', null, { email, method: route.method, path: route.path, app: e.site ?? undefined })}`;
}

/** The address of one event: `#/audit/event/<id>?ts=…`. */
export function eventHash(e: Pick<AuditEventV1, 'event_id' | 'ts'>): string {
  return `#/audit/event/${encodeURIComponent(e.event_id)}?ts=${encodeURIComponent(e.ts)}`;
}

/** Reads `#/audit/event/<id>` (and the router's encoded `#/audit/event%2F<id>`). */
export function parseEventHash(hash: string): { id: string; ts?: string } | null {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  const m = /^audit\/event\/([^/]+)$/.exec(decoded);
  if (!m) return null;
  const ts = new URLSearchParams(qs).get('ts') ?? undefined;
  return { id: m[1], ts };
}
