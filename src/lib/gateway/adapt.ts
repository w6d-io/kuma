import { handlerInfo, type GlobalField, type HandlerInfo } from './catalog';
import { HANDLER_KINDS, type GatewayHandler, type GatewayPreview, type GatewayState, type HandlerChange, type HandlerKind, type RiskLevel, type Rollout } from './types';

/**
 * jinbe's /api/admin/gateway (GW-2) ↔ the page's model. jinbe speaks singular kinds, a flat handler
 * list, masked leaves as "***" (secrets are set by the platform, never from here), and takes the
 * WHOLE spec on preview and apply (a handler left out is disabled). The page speaks plural kinds,
 * `{masked: true}` leaves and per-handler changes; everything is converted here and only here.
 */

export type WireKind = 'authenticator' | 'authorizer' | 'mutator' | 'error';
const PLURAL: Record<WireKind, HandlerKind> = { authenticator: 'authenticators', authorizer: 'authorizers', mutator: 'mutators', error: 'errors' };

export interface WireField {
  key: string; label: string; type: string; required?: boolean; default?: unknown; options?: string[]; pattern?: string; secret?: boolean; restart?: boolean | string; help?: string;
}
export interface WireHandler {
  kind: WireKind; name: string; label?: string; description?: string; enabled: boolean; config: Record<string, unknown>;
  defaults?: Record<string, unknown>; inUse?: string[]; locked?: string; fields?: WireField[];
}
export interface WireRollout { phase: 'Pending' | 'Progressing' | 'Complete' | 'Failed' | 'RolledBack'; reason?: string; message?: string; since?: string; pods?: { updated: number; ready: number; total: number } | null; configHash?: string; failedHash?: string }
export interface WireState {
  managed: boolean; source?: string; namespace?: string; etag: string; errorFallback?: string[]; handlers: WireHandler[];
  status?: { generation?: number | null; observedGeneration?: number | null; conditions?: unknown[]; lastRollout?: WireRollout | null; liveEnabled?: Partial<Record<HandlerKind, string[]>> | null };
}
export interface WireRolloutStatus { managed: boolean; settled: boolean; generation?: number | null; observedGeneration?: number | null; rollout?: WireRollout | null; conditions?: unknown[] }
export interface WireIssue { severity: 'error' | 'warn' | 'info'; code: string; message: string; kind?: WireKind; handler?: string; path?: string }
export interface WirePreview { ok: boolean; issues: WireIssue[]; changes: Array<{ kind: WireKind; handler: string; change: 'enabled' | 'disabled' | 'config'; changedKeys?: string[]; sensitive?: boolean }>; managed: boolean; etag: string }

export const MASK = '***';

// ── secrets: wire strings ↔ page objects ──────────────────────

/** Keys the operator refuses in any case at any depth: secrets live in the chart, from a Secret. */
export const PLATFORM_SECRET_KEY = /^(client_secret|password|secret|token)$/i;

export const secretFromWire = (v: unknown) => (v === MASK ? { masked: true } : v);
export function secretToWire(v: unknown): unknown {
  return v && typeof v === 'object' && (v as { masked?: unknown }).masked === true ? MASK : v;
}

/** Every "***" leaf anywhere in a config becomes `{masked: true}` (credential-looking values are masked too). */
function unmaskTree(v: unknown): unknown {
  if (v === MASK) return { masked: true };
  if (Array.isArray(v)) return v.map(unmaskTree);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unmaskTree(x)]));
  return v;
}
function maskTree(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && (v as { masked?: unknown }).masked === true) return MASK;
  if (Array.isArray(v)) return v.map(maskTree);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskTree(x)]));
  return v;
}

// ── fields: server list + kuma's levels ───────────────────────

const TYPE: Record<string, GlobalField['type']> = { string: 'string', url: 'url', bool: 'bool', int: 'number', duration: 'duration', enum: 'enum', list: 'list', kv: 'kv', json: 'template', template: 'template' };

export function infoFromWire(kind: HandlerKind, h: WireHandler): HandlerInfo {
  const local = handlerInfo(kind, h.name);
  if (!h.fields?.length) return { ...local, label: h.label ?? local.label, summary: h.description ?? local.summary };
  const fields: GlobalField[] = h.fields.map((f) => {
    const l = local.fields.find((x) => x.key === f.key);
    return {
      key: f.key, label: f.label, required: f.required, help: f.help ?? l?.help, options: f.options,
      type: f.secret || PLATFORM_SECRET_KEY.test(f.key.split('.').pop() ?? '') ? 'secret' : TYPE[f.type] ?? 'string',
      level: l?.level ?? (f.required ? 'B' : 'A'),
      placeholder: f.default !== undefined ? (Array.isArray(f.default) ? f.default.join(', ') : String(f.default)) : l?.placeholder,
    };
  });
  return { name: h.name, label: h.label ?? local.label, summary: h.description ?? local.summary, caution: local.caution, fields };
}

export interface AdaptedHandler extends GatewayHandler { info: HandlerInfo }

export type AdaptedState = GatewayState & { adapted: Record<HandlerKind, AdaptedHandler[]> };

export function stateFromWire(w: WireState): AdaptedState {
  const adapted: Record<HandlerKind, AdaptedHandler[]> = { authenticators: [], authorizers: [], mutators: [], errors: [] };
  for (const h of w.handlers) {
    const kind = PLURAL[h.kind];
    if (!kind) continue;
    const info = infoFromWire(kind, h);
    const secrets = (h.fields ?? []).filter((f) => f.secret || PLATFORM_SECRET_KEY.test(f.key.split('.').pop() ?? '')).map((f) => f.key);
    const inUse = h.inUse ?? [];
    const rules = inUse.filter((s) => s.startsWith('rule/')).map((s) => s.slice(5));
    adapted[kind].push({
      name: h.name, enabled: h.enabled, info, secrets, defaults: h.defaults, locked: h.locked,
      config: unmaskTree(h.config ?? {}) as Record<string, unknown>,
      usedBy: inUse.filter((s) => s !== '(platform)' && !s.startsWith('rule/')).map((site) => ({ site, gates: [] })),
      platform: inUse.includes('(platform)') || rules.length > 0,
      platformRules: rules,
      restart: 'oathkeeper',
      live: w.status?.liveEnabled ? (w.status.liveEnabled[kind] ?? []).includes(h.name) : undefined,
    });
  }
  const lr = w.status?.lastRollout;
  return {
    version: w.status?.generation ?? 0,
    etag: w.etag,
    managed: w.managed,
    source: w.source,
    errorFallback: w.errorFallback ?? [],
    handlers: adapted,
    adapted,
    rollout: lr ? rolloutFromWire({ managed: w.managed, settled: lr.phase !== 'Progressing' && lr.phase !== 'Pending', generation: w.status?.generation, observedGeneration: w.status?.observedGeneration, rollout: lr }) : null,
  };
}

// ── request body: the whole spec ──────────────────────────────

export type SpecEntry = { enabled: boolean; config?: Record<string, unknown> };
export type GatewaySpec = Record<HandlerKind, Record<string, SpecEntry>> & { errorFallback: string[] };

/** The full spec jinbe wants: every handler that is on after the changes, with its config. */
export function specFor(state: { adapted: Record<HandlerKind, AdaptedHandler[]>; errorFallback?: string[] }, changes: HandlerChange[]): { spec: GatewaySpec } {
  const spec: Record<HandlerKind, Record<string, SpecEntry>> = { authenticators: {}, authorizers: {}, mutators: {}, errors: {} };
  for (const kind of HANDLER_KINDS) {
    const names = new Set([...state.adapted[kind].map((h) => h.name), ...changes.filter((c) => c.kind === kind).map((c) => c.name)]);
    for (const name of names) {
      const cur = state.adapted[kind].find((h) => h.name === name);
      const ch = changes.find((c) => c.kind === kind && c.name === name);
      const enabled = ch?.enabled ?? cur?.enabled ?? false;
      if (!enabled) continue;
      const config = ch?.config ?? cur?.config ?? {};
      spec[kind][name] = { enabled: true, ...(Object.keys(config).length ? { config: maskTree(config) as Record<string, unknown> } : {}) };
    }
  }
  return { spec: { ...spec, errorFallback: state.errorFallback ?? [] } };
}

// ── preview and rollout ───────────────────────────────────────

const RISK_HIGH = new Set(['risk_allow_all', 'risk_anonymous', 'risk_basic_secret']);

export function previewFromWire(p: WirePreview): GatewayPreview {
  // jinbe: risks are the warnings; blocking uses are handler_in_use; the restart notice is info.
  const risky = p.issues.filter((i) => i.severity === 'warn' && i.code !== 'handler_in_use');
  const level: RiskLevel = risky.some((i) => RISK_HIGH.has(i.code)) ? 'high' : risky.length ? 'medium' : 'low';
  const restartIssue = p.issues.find((i) => i.code === 'rolling_restart');
  return {
    changes: p.changes.map((c) => ({
      kind: PLURAL[c.kind], name: c.handler,
      fields: c.change === 'config'
        ? (c.changedKeys ?? []).map((k) => ({ path: k, before: c.sensitive ? '(secret)' : undefined, after: c.sensitive ? '(secret)' : 'changed' }))
        : [{ path: 'enabled', before: c.change === 'disabled', after: c.change === 'enabled' }],
    })),
    risk: { level, flags: risky.map((i) => ({ code: i.code, level: RISK_HIGH.has(i.code) ? 'high' : 'medium', message: i.message })) },
    checks: p.issues.filter((i) => !risky.includes(i) && i !== restartIssue && i.severity !== 'info' && i.code !== 'handler_in_use').map((i) => ({ level: i.severity === 'error' ? 'error' : 'warn', code: i.code, message: i.message })),
    blocked: p.issues.filter((i) => i.code === 'handler_in_use').map((i) => ({ kind: i.kind ? PLURAL[i.kind] : 'authenticators', name: i.handler ?? '', sites: [], message: i.message })),
    restart: { components: restartIssue ? ['oathkeeper'] : [], ...(restartIssue ? { message: restartIssue.message } : {}) },
  };
}

/**
 * The operator publishes no pod counts: a rollout is its phase (derived from the Gateway conditions)
 * and the message of the condition that set it, e.g. "1/2 pods updated" while Progressing.
 */
export function rolloutFromWire(r: WireRolloutStatus): Rollout | null {
  const ro = r.rollout;
  if (!ro && (r.generation === undefined || r.generation === null)) return null;
  const caughtUp = r.generation != null && r.observedGeneration === r.generation;
  const phase = !caughtUp ? 'Pending' : ro?.phase ?? (r.settled ? 'Complete' : 'Pending');
  const state: Rollout['state'] = phase === 'Failed' ? 'failed' : phase === 'RolledBack' ? 'rolled-back' : phase === 'Complete' ? 'succeeded' : 'running';
  const st = (done: boolean, now: boolean, failed = false): Rollout['stages'][number]['state'] => (failed ? 'failed' : done ? 'done' : now ? 'running' : 'pending');
  const validatedFailed = phase === 'Failed';
  const rolledBack = phase === 'RolledBack';
  const pods = ro?.pods ?? null;
  const past = (p: string) => ['Progressing', 'Complete', 'RolledBack'].includes(p);
  return {
    id: String(r.generation ?? ''),
    version: r.generation ?? 0,
    state,
    startedAt: ro?.since ?? '',
    message: ro?.message,
    stages: [
      { id: 'accepted', label: 'Operator picked up the change', state: st(caughtUp, !caughtUp), detail: `generation ${r.observedGeneration ?? '—'} / ${r.generation ?? '—'}` },
      { id: 'validated', label: 'Config validated', state: st(caughtUp && past(phase), false, validatedFailed), detail: validatedFailed ? `${ro?.reason === 'HandlerInUse' ? 'A handler is still in use' : 'Refused'}: ${ro?.message ?? ''}` : undefined },
      { id: 'rolled', label: 'Gateway pods restarted, one at a time', state: st(phase === 'Complete', phase === 'Progressing', rolledBack), detail: phase === 'Progressing' ? (pods ? `${pods.updated}/${pods.total} pods updated` : ro?.message) : rolledBack ? `The new config failed; the previous one was restored. ${ro?.message ?? ''}`.trim() : undefined },
      { id: 'ready', label: 'Live on every pod', state: st(phase === 'Complete', false), detail: pods ? `${pods.ready}/${pods.total} pods ready` : undefined },
    ],
  };
}
