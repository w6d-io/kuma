import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { Chip, Method, ConfirmDialog, StageRow, AdvancedDisclosure, Switch } from '../components/ui/Primitives';
import { I } from '../components/ui/Icons';
import { useApplyChange } from '../hooks/useApplyChange';
import { useSession, useUpdateAccessRule, useOathkeeperHandlers } from '../api/hooks';
import { rulesAreEditable, NOT_ENFORCED_HERE } from '../policy/source';
import {
  HandlerStageEditor, PRESETS, classify, rulePosture, serviceGatewayPosture,
  toDraftHandler, newDraftHandler, draftHandlerToConfig, draftHandlersValid, isRealAuthn,
} from '../components/HandlerStageEditor';
import type { DraftHandler, HandlerStage, PresetDef } from '../components/HandlerStageEditor';
import type { JinbeAccessRule, HandlerDescriptor, OathkeeperHandlerCatalog, FieldDescriptor } from '../api/client';
import type { AccessRule, RouteEntry } from '../api/types';

const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// The six request-flow stages, in order. Match & Send are plain (non-handler)
// stages; the rest are backed by Oathkeeper handlers.
type Stage = 'match' | 'authn' | 'authz' | 'mutate' | 'errors' | 'upstream';

// Plain fallback labels for a handful of well-known handler names, used only
// when the catalog hasn't supplied a label (e.g. still loading).
const HANDLER_FALLBACK: Record<string, string> = {
  cookie_session: 'Session cookie', bearer_token: 'Bearer token', jwt: 'Signed token (JWT)', noop: 'None',
  remote_json: 'Policy check', allow: 'Allow all', deny: 'Deny all',
  header: 'Identity headers', id_token: 'Signed token', redirect: 'Redirect to login', json: 'JSON error',
};

// Identity-header plain-surface mapping. The template context is Oathkeeper's
// AuthenticationSession (`.Subject`, `.Extra…`), matching the production config.
const HDR_USER_ID = 'X-User-Id';
const HDR_EMAIL = 'X-User-Email';
const TPL_USER_ID = '{{ print .Subject }}';
const TPL_EMAIL = '{{ print .Extra.identity.traits.email }}';

const isNoAuth = (a: string[]) => a.length === 0 || a.every(x => x === 'noop');

// Under an `allow` authorizer, a real authenticator sitting next to a noop is an
// anonymous bypass (anonymous → noop → allow → through). Drop the fake ones so
// the bypass shape can't be authored (P0-2). Pure-noop (Public) is left intact.
function sanitizeAuthnForAllow(authn: DraftHandler[]): DraftHandler[] {
  return authn.some(h => isRealAuthn(h.handler)) ? authn.filter(h => isRealAuthn(h.handler)) : authn;
}

// ── Structural deep-equality (for the unsaved-changes guard, P1-6) ──
// `openStage` seeds a draft with no changes, so dirtiness must be a real content
// diff (draft vs a fresh seed of the rule), not merely `draft !== null`.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  const arrA = Array.isArray(a), arrB = Array.isArray(b);
  if (arrA !== arrB) return false;
  if (arrA) {
    const la = a as unknown[], lb = b as unknown[];
    return la.length === lb.length && la.every((v, i) => deepEqual(v, lb[i]));
  }
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// ── Ory `<…>` match pattern → JS RegExp, for the CLIENT-SIDE tester only (P2-7).
// Ory (RE2, matching_strategy: regexp) treats text OUTSIDE `<…>` as literal and
// the text INSIDE each `<…>` as a regex. `new RegExp(match.url)` would instead
// match the literal `<`/`>`, so translate first: literal-escape the outside,
// substitute each `<inner>` verbatim. Throws on an invalid inner regex (caller
// shows "can't preview" rather than crashing).
const escapeLiteral = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function oryPatternToRegExp(pattern: string): RegExp {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const open = pattern.indexOf('<', i);
    if (open === -1) { out += escapeLiteral(pattern.slice(i)); break; }
    out += escapeLiteral(pattern.slice(i, open));
    const close = pattern.indexOf('>', open + 1);
    if (close === -1) { out += escapeLiteral(pattern.slice(open)); break; } // unbalanced → literal
    out += `(?:${pattern.slice(open + 1, close)})`;
    i = close + 1;
  }
  return new RegExp(`^${out}$`);
}

// ── Plain match builder (parse ↔ build) ──
// Emits regexp INSIDE `<…>` (the confirmed Ory convention) — `(.*)` for
// "everything", `([^/]+)` for an id segment, escaped literals otherwise. Only
// the app's own `<https?://host/…>` shape is parsed to a plain mode; anything
// else (regexp host, custom convention) is flagged `raw` and edited untouched
// under Advanced — never silently rewritten.
type MatchMode = 'everything' | 'folder' | 'exact' | 'id';
interface ParsedMatch { host: string; mode: MatchMode; path: string; raw: boolean; }
const REGEX_META = /[.*+?^${}()|[\]\\]/;
const escPath = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unescape = (s: string) => s.replace(/\\(.)/g, '$1');

// A host that carries regex metachars (beyond the literal dots real hostnames
// use) is a regexp host — not something the plain builder can round-trip, so it
// opens in Advanced untouched.
const HOST_REGEX_META = /[()[\]{}|*+?^$\\]/;
function parseMatch(url: string): ParsedMatch {
  const raw: ParsedMatch = { host: '', mode: 'everything', path: '', raw: true };
  const m = url.match(/^<https\?:\/\/([^/<>]+)\/(.*)>$/);
  if (!m) return raw;
  const host = m[1];
  if (HOST_REGEX_META.test(host)) return raw;
  const rest = m[2];
  if (rest === '.*' || rest === '(.*)') return { host, mode: 'everything', path: '', raw: false };
  if (rest.includes('([^/]+)')) {
    const parts = rest.split('([^/]+)');
    if (parts.every(p => !REGEX_META.test(unescape(p)))) {
      const path = parts.map(unescape).join('{id}').replace(/\/$/, '');
      return { host, mode: 'id', path, raw: false };
    }
    return raw;
  }
  const fm = rest.match(/^(.*?)(\(\.\*\)|\.\*)$/);
  if (fm) {
    const prefix = unescape(fm[1]);
    if (!REGEX_META.test(prefix)) {
      const path = prefix.replace(/\/$/, '');
      return path ? { host, mode: 'folder', path, raw: false } : { host, mode: 'everything', path: '', raw: false };
    }
    return raw;
  }
  const lit = unescape(rest);
  if (!REGEX_META.test(lit)) return { host, mode: 'exact', path: lit.replace(/\/$/, ''), raw: false };
  return raw;
}

function buildMatch(host: string, mode: MatchMode, path: string): string {
  const p = path.replace(/^\/+|\/+$/g, '');
  switch (mode) {
    case 'everything': return `<https?://${host}/(.*)>`;
    case 'folder':     return `<https?://${host}/${escPath(p)}${p ? '/' : ''}(.*)>`;
    case 'exact':      return `<https?://${host}/${escPath(p)}>`;
    case 'id':         return `<https?://${host}/${p.split('/').map(seg => seg === '{id}' ? '([^/]+)' : escPath(seg)).join('/')}>`;
  }
}

function describeMatch(url: string): string {
  const p = parseMatch(url);
  if (p.raw) return 'a custom set of URLs';
  const on = p.host ? ` on ${p.host}` : '';
  switch (p.mode) {
    case 'everything': return `every path${on}`;
    case 'folder':     return `everything under /${p.path}${on}`;
    case 'exact':      return `exactly /${p.path}${on}`;
    case 'id':         return `/${p.path}${on}`;
  }
}

function hostFromUrl(u: string): string {
  try { return new URL(u).host; } catch { return ''; }
}

// Longest common path-prefix of a service's routes → suggested strip prefix.
function suggestStripPrefix(paths: string[]): string {
  if (paths.length === 0) return '';
  const lists = paths.map(p => p.replace(/^\/+/, '').split('/'));
  const first = lists[0];
  const common: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const seg = first[i];
    if (!seg || seg.includes('{') || seg.includes(':')) break;
    if (lists.every(l => l[i] === seg)) common.push(seg); else break;
  }
  return common.length ? '/' + common.join('/') : '';
}

// ── Identity-header helpers (Information-sent stage) ──
function readHeaderMap(h?: DraftHandler): Record<string, string> {
  if (!h) return {};
  const out: Record<string, string> = {};
  if (h.rawText.trim()) {
    try { const p = JSON.parse(h.rawText); if (p && typeof p.headers === 'object' && p.headers) Object.assign(out, p.headers); } catch { /* ignore */ }
  }
  const cfgH = h.cfg.headers;
  if (cfgH && typeof cfgH === 'object' && !Array.isArray(cfgH)) Object.assign(out, cfgH as Record<string, string>);
  return out;
}
const sendsUserId = (h: Record<string, string>) => Object.values(h).some(v => typeof v === 'string' && v.includes('.Subject'));
const sendsEmail = (h: Record<string, string>) => Object.values(h).some(v => typeof v === 'string' && /traits\.email/.test(v));
function stripHeadersKey(raw: string): string {
  if (!raw.trim()) return raw;
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object') { delete (p as Record<string, unknown>).headers; return Object.keys(p).length ? JSON.stringify(p, null, 2) : ''; }
  } catch { /* leave as-is */ }
  return raw;
}
// Case-insensitive duplicate header names (hygiene guardrail) → block save.
function headerHasCaseDup(h?: DraftHandler): boolean {
  const keys = Object.keys(readHeaderMap(h));
  const lower = keys.map(k => k.toLowerCase());
  return new Set(lower).size !== lower.length;
}

// A service's HTTP surface is split across several gateway rules; turn the raw
// id suffix ("example-api-preflight") into a human role.
function ruleLabel(id: string, svc?: string): string {
  const suffix = !svc || id === svc ? '' : id.replace(new RegExp(`^${svc}[-_]?`), '');
  const map: Record<string, string> = {
    '': 'Base', api: 'API', 'api-preflight': 'Preflight (CORS)', preflight: 'Preflight (CORS)',
    app: 'App', ui: 'UI', settings: 'Settings', public: 'Public', root: 'Root',
    dsn: 'Database', studio: 'Studio', engine: 'Engine',
  };
  return map[suffix] ?? (suffix ? suffix.charAt(0).toUpperCase() + suffix.slice(1).replace(/[-_]/g, ' ') : 'Base');
}

// Small chip toggle used by the Match method quick-picks.
function Toggle({ on, tone, onClick, children }: { on: boolean; tone?: string; onClick: () => void; children: React.ReactNode }) {
  const c = tone === 'warn' ? 'var(--warn)' : tone === 'err' ? 'var(--err)' : 'var(--accent)';
  return (
    <button type="button" onClick={onClick} className="chip" aria-pressed={on} style={{
      cursor: 'pointer', fontWeight: 500, fontSize: 11.5, fontFamily: 'var(--font-mono)',
      background: on ? c : 'var(--panel-2)', color: on ? '#fff' : 'var(--ink-2)', borderColor: on ? c : 'var(--line)',
    }}>{children}</button>
  );
}

// A single plain outcome (segmented radio card) for Sign-in / Permission.
function Outcome({ on, disabled, label, desc, onClick, disabledHint }: {
  on: boolean; disabled?: boolean; label: string; desc: string; onClick: () => void; disabledHint?: string;
}) {
  return (
    <button type="button" className={`outcome${on ? ' on' : ''}`} aria-pressed={on} disabled={disabled}
      title={disabled ? disabledHint : undefined} onClick={onClick}>
      <span className="outcome-radio" aria-hidden="true" />
      <span className="outcome-txt">
        <span className="outcome-lbl">{label}</span>
        <span className="outcome-desc">{desc}</span>
      </span>
    </button>
  );
}

interface Draft {
  methods: string[];
  url: string;
  upstream: string;
  stripPath: string;
  authn: DraftHandler[];
  authz: DraftHandler[]; // 0..1 (single authorizer)
  mutators: DraftHandler[];
  errors: DraftHandler[];
}

// Shared context handed to each stage editor. `epoch` remounts a stage's local
// editor state after a preset replaces the draft (P2-8).
interface EdCtx {
  draft: Draft;
  rule: AccessRule;
  catalog: OathkeeperHandlerCatalog;
  routes: RouteEntry[];
  patch: (p: Partial<Draft>) => void;
  setStage: (s: HandlerStage, next: DraftHandler[]) => void;
  setSignIn: (signedIn: boolean) => void;
  setPermission: (handler: string) => void;
  setInfoSent: (opts: { master: boolean; userId: boolean; email: boolean }) => void;
  setErrorAudience: (which: 'browsers' | 'apps', on: boolean) => void;
  handlerLabel: (stage: HandlerStage, name: string) => string;
  goRoles: () => void;
  goRoutes: () => void;
  validUpstream: boolean;
}

export function RulesPage({ svc, unassigned = false }: { svc?: string; unassigned?: boolean } = {}) {
  const { state, registerUnsavedGuard, setPage } = useApp();
  const applyChange = useApplyChange();
  const updateRule = useUpdateAccessRule();
  const { data: catalog, isError: catalogError } = useOathkeeperHandlers();
  const registered = new Set(state.services.map(s => s.name));
  const rules = unassigned
    ? state.accessRules.filter(r => !registered.has(r.service))
    : svc ? state.accessRules.filter(r => r.service === svc) : state.accessRules;
  const [selectedId, setSelectedId] = useState(rules[0]?.id);
  const rule = rules.find(r => r.id === selectedId) || rules[0];

  const svcObj = state.services.find(s => s.name === (svc ?? rule?.service));
  // Per-rule editing targets ONE rule by id (safe on multi-rule services). Only
  // regular, registered, non-system services are editable; infra/system are
  // read-only. Each field is overlaid on the raw rule so nothing is dropped.
  // A deployment whose engines read their rules from Git is one more reason this rule cannot be
  // edited here, and it is not a lesser one: a write would report success into a store nothing
  // reads. Folded into the existing gate so every control already keyed on it is covered.
  const { data: session } = useSession();
  const enforcedFromGit = !rulesAreEditable(session);
  const canEdit = !!svc && svc !== 'global' && !svcObj?.system && !unassigned && !enforcedFromGit;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [activeStage, setActiveStage] = useState<Stage | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  // Bumped only when a preset REPLACES the draft, so expanded stage editors with
  // local state re-seed from the new draft (P2-8) without losing focus on typing.
  const [draftEpoch, setDraftEpoch] = useState(0);
  const editing = draft !== null;
  useEffect(() => { setDraft(null); setActiveStage(null); setConfirmOpen(false); setPendingSelectId(null); }, [selectedId, svc]);

  const descFor = (stage: HandlerStage, handler: string): HandlerDescriptor | undefined => {
    if (!catalog) return undefined;
    const list = stage === 'authn' ? catalog.authenticators
      : stage === 'authz' ? catalog.authorizers
      : stage === 'mutate' ? catalog.mutators : catalog.errorHandlers;
    return list.find(d => d.handler === handler);
  };
  const handlerLabel = (stage: HandlerStage, name: string) => descFor(stage, name)?.label || HANDLER_FALLBACK[name] || name;

  const seed = (r: AccessRule): Draft => {
    const raw = r.raw as JinbeAccessRule;
    return {
      methods: [...r.match.methods],
      url: r.match.url,
      upstream: r.upstream || '',
      stripPath: r.stripPath || '',
      authn: (raw.authenticators || []).map(a => toDraftHandler(a, descFor('authn', a.handler))),
      authz: raw.authorizer ? [toDraftHandler(raw.authorizer, descFor('authz', raw.authorizer.handler))] : [],
      mutators: (raw.mutators || []).map(m => toDraftHandler(m, descFor('mutate', m.handler))),
      errors: (raw.errors || []).map(e => toDraftHandler(e, descFor('errors', e.handler))),
    };
  };

  const cancelEdit = () => { setDraft(null); setActiveStage(null); };
  const toggleStage = (k: Stage) => {
    if (!canEdit || !rule || !catalog) return;  // fail-closed: no editing until the catalog loads (P1-4)
    setDraft(d => d ?? seed(rule));
    setActiveStage(s => (s === k ? null : k));  // collapsing keeps the draft (edits live in it)
  };

  const patch = (p: Partial<Draft>) => setDraft(d => (d ? { ...d, ...p } : d));

  // Preset selector — rewrite the underlying handlers, preserving the CURRENT
  // authorizer instance (so a standing `remote_json` per-service payload rides
  // through untouched) when the preset keeps the same authorizer, and the
  // current authenticators when Blocking. The per-service `remote_json` config
  // is never authored here — jinbe backfills it; buildMerged re-emits any
  // existing one verbatim.
  const applyPreset = (p: PresetDef) => {
    if (!rule) return;
    const base = draft ?? seed(rule);
    const prevAuthz = base.authz[0];
    const makeAuthz = (handler: string): DraftHandler =>
      prevAuthz && prevAuthz.handler === handler ? prevAuthz : newDraftHandler(handler);
    if (p.id === 'blocked') {
      setDraft({ ...base, authz: [makeAuthz('deny')] });
    } else {
      // Presets rebuild authn from their own handler list only, so a "Signed-in
      // only"/"Public" preset can never leave a real authenticator sitting next
      // to a noop under `allow` (the anonymous-bypass shape, P0-2).
      const authn = p.authenticators.map(h => base.authn.find(x => x.handler === h) ?? newDraftHandler(h));
      setDraft({ ...base, authn, authz: [makeAuthz(p.authorizer)] });
    }
    setDraftEpoch(e => e + 1);  // draft replaced → re-seed expanded editors (P2-8)
  };

  const setStage = (s: HandlerStage, next: DraftHandler[]) => setDraft(d => {
    if (!d) return d;
    if (s === 'authn') return { ...d, authn: next };
    if (s === 'authz') {
      // Changing the authorizer to `allow` strips any noop from authn so a
      // cookie_session+noop+allow anonymous bypass can't be created (P0-2).
      const authn = next[0]?.handler === 'allow' ? sanitizeAuthnForAllow(d.authn) : d.authn;
      return { ...d, authz: next, authn };
    }
    if (s === 'mutate') return { ...d, mutators: next };
    return { ...d, errors: next };
  });

  // Sign-in, authorizer-aware: preserve existing real authenticators; add noop
  // only under `remote_json` (harmless — policy still runs); never under `allow`
  // (would be an anonymous bypass); Anyone → noop only.
  const setSignIn = (signedIn: boolean) => setDraft(d => {
    if (!d) return d;
    const authz = d.authz[0]?.handler ?? '';
    const noop = d.authn.find(h => h.handler === 'noop') ?? newDraftHandler('noop');
    if (!signedIn) return { ...d, authn: [noop] };
    const reals = d.authn.filter(h => isRealAuthn(h.handler));
    const realList = reals.length ? reals : [newDraftHandler('cookie_session')];
    return { ...d, authn: authz === 'remote_json' ? [...realList, noop] : realList };
  });

  const setPermission = (handler: string) => setDraft(d => {
    if (!d) return d;
    const prev = d.authz[0];
    const authz = [prev && prev.handler === handler ? prev : newDraftHandler(handler)];
    const authn = handler === 'allow' ? sanitizeAuthnForAllow(d.authn) : d.authn;
    return { ...d, authz, authn };
  });

  const setInfoSent = (opts: { master: boolean; userId: boolean; email: boolean }) => setDraft(d => {
    if (!d) return d;
    const others = d.mutators.filter(m => m.handler !== 'header' && m.handler !== 'noop');
    if (!opts.master) return { ...d, mutators: others };
    const headers: Record<string, string> = {};
    if (opts.userId) headers[HDR_USER_ID] = TPL_USER_ID;
    if (opts.email) headers[HDR_EMAIL] = TPL_EMAIL;
    if (Object.keys(headers).length === 0) {
      // Master on but nothing selected → collapse to an explicit no-op mutator.
      const noop = d.mutators.find(m => m.handler === 'noop') ?? newDraftHandler('noop');
      return { ...d, mutators: [...others, noop] };
    }
    const existing = d.mutators.find(m => m.handler === 'header');
    const hd: DraftHandler = existing
      ? { ...existing, cfg: { ...existing.cfg, headers }, rawText: stripHeadersKey(existing.rawText) }
      : { ...newDraftHandler('header'), cfg: { headers } };
    return { ...d, mutators: [...others, hd] };
  });

  const setErrorAudience = (which: 'browsers' | 'apps', on: boolean) => setDraft(d => {
    if (!d) return d;
    const inherit = d.errors.length === 0;
    let b = inherit || d.errors.some(e => e.handler === 'redirect');
    let a = inherit || d.errors.some(e => e.handler === 'json');
    if (which === 'browsers') b = on; else a = on;
    if (!b && !a) return d;                 // ≥1 audience must stay on
    if (b && a && inherit) return d;        // both on from inherit → keep inheriting (no errors[])
    const redirect = d.errors.find(e => e.handler === 'redirect') ?? newDraftHandler('redirect');
    const json = d.errors.find(e => e.handler === 'json') ?? newDraftHandler('json');
    const next: DraftHandler[] = [];        // redirect before json (audience split IS redirect's `when`)
    if (b) next.push(redirect);
    if (a) next.push(json);
    return { ...d, errors: next };
  });

  // ── validation / guardrails ──
  const validUpstream = /^https?:\/\//.test(draft?.upstream ?? '');
  const handlersValid = !draft || draftHandlersValid([...draft.authn, ...draft.authz, ...draft.mutators, ...draft.errors]);
  const headerDup = !!draft && headerHasCaseDup(draft.mutators.find(m => m.handler === 'header'));
  const notEnabled: string[] = [];
  if (draft && catalog) {
    const check = (list: DraftHandler[], enabled: HandlerDescriptor[]) => {
      const names = new Set(enabled.map(d => d.handler));
      for (const h of list) if (!names.has(h.handler)) notEnabled.push(h.handler);
    };
    check(draft.authn, catalog.authenticators);
    check(draft.authz, catalog.authorizers);
    check(draft.mutators, catalog.mutators);
    check(draft.errors, catalog.errorHandlers);
  }
  // Fail-closed: no edit can be saved unless the enabled-handler catalog loaded
  // (P1-4 — otherwise notEnabled can't be trusted) and exactly one authorizer is
  // set (P0-3 — makes the empty-authorizer fail-open fallback unreachable).
  const canSave = !!draft && !!catalog && draft.authz.length === 1
    && draft.methods.length > 0 && validUpstream && handlersValid && !headerDup && notEnabled.length === 0;
  // Surface WHY Save is disabled. A disabled <button> fires no onClick — no request,
  // no confirm dialog — and the old title only covered 3 of the gates, so a gate like
  // an empty/invalid upstream left the operator with a silent, unexplained dead button.
  const saveDisabledReason =
    !draft ? ''
    : !catalog ? 'Gateway configuration is still loading — retry shortly.'
    : draft.methods.length === 0 ? 'Select at least one HTTP method (step "Which requests").'
    : !validUpstream ? 'Set a valid upstream URL starting with http:// or https:// (step "Where requests go").'
    : draft.authz.length !== 1 ? 'Pick exactly one permission outcome (step "Permission").'
    : notEnabled.length ? `These handlers aren't enabled on the gateway: ${notEnabled.join(', ')}.`
    : headerDup ? 'Two headers share a name (case-insensitive) — fix under Information sent → Advanced.'
    : !handlersValid ? 'Fix invalid JSON in a handler config first.'
    : '';

  const draftAuthz = draft?.authz[0]?.handler ?? '';
  const draftNoAuthn = isNoAuth(draft?.authn.map(h => h.handler) ?? []);
  // Self-lockout: this rule protects the admin console (kuma) or its API (jinbe);
  // weakening it can lock the operator out of the gateway. Derived from the OLD rule.
  const selfProtecting = !!rule && [rule.service, rule.upstream, (rule.raw as JinbeAccessRule | undefined)?.upstream?.url]
    .some(s => !!s && /\b(kuma|jinbe)\b/i.test(s));
  const destOrMatchChanged = !!draft && !!rule && (draft.upstream !== (rule.upstream || '') || draft.url !== rule.match.url);
  const dangerous = !!draft && !!rule && (
    (draftAuthz === 'allow' && rule.authorizer !== 'allow') ||
    (draftAuthz === 'deny' && rule.authorizer !== 'deny') ||
    (draftNoAuthn && !isNoAuth(rule.authenticators)) ||
    // Changing where a self-protecting rule sends traffic, or which requests it
    // matches, can strand the console just as surely as weakening auth (P1-5).
    (selfProtecting && destOrMatchChanged)
  );
  const routeCount = rule ? (state.routeMaps[rule.service]?.length ?? 0) : 0;

  const buildMerged = (): JinbeAccessRule => {
    const raw = rule!.raw as JinbeAccessRule;
    const d = draft!;
    const toInst = (h: DraftHandler) => {
      const cfg = draftHandlerToConfig(h);
      return cfg === undefined ? { handler: h.handler } : { handler: h.handler, config: cfg };
    };
    // Authorizer, fail-closed + per-service config preserved:
    //  - No authorizer in the draft → `deny` (P0-3; canSave keeps this
    //    unreachable, but the fallback must never fail OPEN).
    //  - `remote_json` is a PER-SERVICE contract: its `config.payload` embeds
    //    the service name and `config.remote` points at OPA. jinbe stores it
    //    verbatim (no backfill when present), so the UI must re-emit an existing
    //    payload BYTE-FOR-BYTE and never drop it (P0-1/P2-9). When there is no
    //    prior config (e.g. a Public/Blocked→Protected transition) emit a bare
    //    `{handler:'remote_json'}` and let jinbe backfill the platform config.
    const buildAuthorizer = (): JinbeAccessRule['authorizer'] => {
      const d0 = d.authz[0];
      if (!d0) return { handler: 'deny' };
      if (d0.handler === 'remote_json') {
        return raw.authorizer?.handler === 'remote_json' && raw.authorizer.config !== undefined
          ? { handler: 'remote_json', config: raw.authorizer.config }
          : { handler: 'remote_json' };
      }
      return toInst(d0);
    };
    const upstream: JinbeAccessRule['upstream'] = { ...(raw.upstream || {}), url: d.upstream };
    if (d.stripPath) upstream.strip_path = d.stripPath; else delete upstream.strip_path;
    const merged: JinbeAccessRule = {
      ...raw,
      match: { ...raw.match, url: d.url, methods: d.methods },
      authenticators: d.authn.map(toInst),
      authorizer: buildAuthorizer(),
      mutators: d.mutators.map(toInst),
      upstream,
    };
    // Only write `errors` when there is (or was) something there — keeps rules
    // that never used error handlers byte-for-byte identical.
    if (d.errors.length || raw.errors) merged.errors = d.errors.map(toInst);
    return merged;
  };

  const doSave = () => {
    if (!rule || !canSave || enforcedFromGit) return;
    applyChange('update', `gateway: ${rule.id}`, () => updateRule.mutateAsync({ id: rule.id, rule: buildMerged() }).then(() => undefined));
    cancelEdit();
    setConfirmOpen(false);
  };
  const onSaveClick = () => { if (dangerous) setConfirmOpen(true); else doSave(); };

  // ── unsaved-changes guard (P1-6) ──
  // Dirty = a real content diff (draft vs fresh seed), not merely draft !== null.
  const dirty = !!draft && !!rule && !deepEqual(draft, seed(rule));
  useEffect(() => {
    registerUnsavedGuard(() => dirty);
    return () => registerUnsavedGuard(null);
  }, [dirty, registerUnsavedGuard]);
  // Rule-select switch also discards silently today — intercept it locally.
  const requestSelect = (id: string) => {
    if (id === selectedId) return;
    if (dirty) setPendingSelectId(id);
    else setSelectedId(id);
  };

  // Current handler names (draft when editing, else the live rule) → posture.
  const curAuthn = draft ? draft.authn.map(h => h.handler) : rule?.authenticators ?? [];
  const curAuthz = draft ? draftAuthz : rule?.authorizer ?? '';
  const activePreset = classify(curAuthn, curAuthz);
  const posture = rulePosture(curAuthn, curAuthz);

  // A preset is only offered when all its handlers are enabled on the gateway
  // (fail-closed with the backend). While the catalog is unavailable, none.
  const catAuthn = new Set((catalog?.authenticators ?? []).map(d => d.handler));
  const catAuthz = new Set((catalog?.authorizers ?? []).map(d => d.handler));
  const presetAvailable = (p: PresetDef) =>
    !!catalog && catAuthz.has(p.authorizer) && p.authenticators.every(h => catAuthn.has(h));

  // ── per-service posture header (Layer 1) ──
  const svcPosture = !unassigned && svc ? serviceGatewayPosture(rules.map(r => ({ authenticators: r.authenticators, authorizer: r.authorizer }))) : null;

  const routes = rule ? (state.routeMaps[rule.service] ?? []) : [];

  // Deep-links to the sibling Roles / Routes tabs — routed via setPage so they
  // inherit the unsaved-changes guard.
  const goRoles = () => setPage('roles');
  const goRoutes = () => setPage('routes');

  const ed: EdCtx | null = draft && rule && catalog ? {
    draft, rule, catalog, routes, patch, setStage, setSignIn, setPermission, setInfoSent, setErrorAudience,
    handlerLabel, goRoles, goRoutes, validUpstream,
  } : null;

  // ── collapsed-summary text + tone per stage (draft-aware) ──
  const sMethods = draft?.methods ?? rule?.match.methods ?? [];
  const sUrl = draft?.url ?? rule?.match.url ?? '';
  const sUpstream = draft?.upstream ?? rule?.upstream ?? '';
  const signInReq = curAuthn.filter(isRealAuthn).length > 0;
  const headerMut = (draft?.mutators ?? []).find(m => m.handler === 'header')
    ?? ((rule?.raw as JinbeAccessRule | undefined)?.mutators || []).map(m => toDraftHandler(m, descFor('mutate', m.handler))).find(m => m.handler === 'header');
  const liveHeaders = readHeaderMap(headerMut);
  const infoBits = [sendsUserId(liveHeaders) && 'User ID', sendsEmail(liveHeaders) && 'Email'].filter(Boolean) as string[];
  const curErrors = draft ? draft.errors.map(e => e.handler) : rule?.errors ?? [];
  const errInherit = curErrors.length === 0;
  const errBrowsers = errInherit || curErrors.includes('redirect');
  const errApps = errInherit || curErrors.includes('json');
  const permTone = curAuthz === 'deny' ? 'err' : curAuthz === 'allow' ? 'warn' : 'ok';
  const permWord = curAuthz === 'deny' ? 'Blocked for everyone'
    : curAuthz === 'allow' ? 'Allowed for everyone — no permission check'
    : 'Checked against the permission policy';

  const stageMeta: { k: Stage; icon: React.ReactNode; title: string; question: string; summary: React.ReactNode; tone: string }[] = [
    {
      k: 'match', icon: I.route, title: 'Which requests', question: 'match this rule',
      tone: '', summary: <><span className="mono">{sMethods.join(', ') || 'no methods'}</span> · {describeMatch(sUrl)}</>,
    },
    {
      k: 'authn', icon: signInReq ? I.lock : I.globe, title: 'Sign-in', question: 'must the caller be signed in?',
      tone: signInReq ? 'ok' : 'warn', summary: signInReq ? 'Signed-in users only' : 'Anyone — no sign-in required',
    },
    {
      k: 'authz', icon: curAuthz === 'deny' ? I.close : curAuthz === 'allow' ? I.alert : I.shield,
      title: 'Permission', question: 'who is allowed through?', tone: permTone, summary: permWord,
    },
    {
      k: 'mutate', icon: I.edit, title: 'Information sent', question: 'what the service learns',
      tone: '', summary: infoBits.length ? `Sends ${infoBits.join(' + ')}` : 'Nothing extra (request forwarded as-is)',
    },
    {
      k: 'errors', icon: I.alert, title: 'If a request is refused', question: 'what users see',
      tone: '', summary: errInherit ? 'Gateway default (browsers → sign-in, apps → error)'
        : `${errBrowsers ? 'Browsers → sign-in' : ''}${errBrowsers && errApps ? ', ' : ''}${errApps ? 'apps → error message' : ''}` || 'Custom',
    },
    {
      k: 'upstream', icon: I.box, title: 'Where requests go', question: 'the destination',
      tone: 'ok', summary: <span className="mono">{sUpstream ? hostFromUrl(sUpstream) || sUpstream : '—'}</span>,
    },
  ];

  const renderStageBody = (k: Stage) => {
    if (!ed) return null;
    switch (k) {
      case 'match':    return <MatchEditor ed={ed} />;
      case 'authn':    return <SignInEditor ed={ed} />;
      case 'authz':    return <PermissionEditor ed={ed} />;
      case 'mutate':   return <InfoSentEditor ed={ed} />;
      case 'errors':   return <ErrorsEditor ed={ed} />;
      case 'upstream': return <UpstreamEditor ed={ed} />;
    }
  };

  return (
    <>
      <div className="panel mb-12" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ width: 15, height: 15, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', flexShrink: 0 }}>{I.info}</span>
        <span className="small muted">
          {unassigned
            ? <>These gateway rules aren't tied to a registered service (infrastructure or legacy rules) — read-only.</>
            : enforcedFromGit
              /* Before every other reason: with editing off for this one, the branches below would
                 explain the wrong cause — "system service" reads as a permission problem. */
              ? <>{NOT_ENFORCED_HERE}</>
            : canEdit
              ? (catalog
                  ? <>Pick a protection preset, or open a step below to fine-tune it. Changes apply to the selected rule only.</>
                  : catalogError
                    ? <span style={{ color: 'var(--err)' }}>The gateway configuration couldn't be loaded, so editing is disabled (changes can't be validated as fail-closed). Retry shortly.</span>
                    : <>Loading the gateway configuration…</>)
              : svcObj?.system
                ? <>System service — its gateway rules are managed by the platform (read-only).</>
                : <>Generated from your services and version-controlled — read-only.</>}
        </span>
      </div>

      {/* Layer 1 — per-service posture header */}
      {svcPosture && rules.length > 0 && (
        <div className="panel mb-12" style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip tone={svcPosture.tone} mono={false}>{svcPosture.label}</Chip>
          <span className="small" style={{ color: 'var(--ink-2)' }}>
            {svcPosture.label === 'Protected'
              ? <>Requests to this service are checked against the permission policy before they reach it.</>
              : svcPosture.label === 'Public'
                ? <>Every rule on this service is reachable without signing in.</>
                : svcPosture.label === 'Blocked'
                  ? <>All traffic to this service is rejected at the gateway.</>
                  : <>Some rules on this service let requests through without a permission check.</>}
            {rules.length > 1 && <span className="muted"> {' '}Its surface is split across {rules.length} rules (e.g. the protected API, CORS preflight, health).</span>}
          </span>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
          <div className="muted small">No gateway rules{svc ? <> for <span className="mono">{svc}</span></> : ''}.</div>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "300px 1fr", gap: 14, alignItems: 'start' }}>
          <div className="panel" style={{ padding: 0 }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)" }}>{svc ? `${rules.length} rule${rules.length !== 1 ? 's' : ''}` : 'Rules'}</div>
            {rules.map(r => {
              const p = rulePosture(r.authenticators, r.authorizer);
              return (
                <button key={r.id} onClick={() => requestSelect(r.id)} style={{ width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: "1px solid var(--line)", background: r.id === rule?.id ? "var(--panel-2)" : "transparent", color: "var(--ink)", cursor: "pointer" }}>
                  <div className={unassigned ? "mono" : undefined} style={{ fontSize: 12.5, fontWeight: r.id === rule?.id ? 600 : 500 }}>{unassigned ? r.id : ruleLabel(r.id, svc)}</div>
                  <div className="small mt-4"><Chip tone={p.tone} mono={false} title={p.sentence}>{p.label}</Chip></div>
                </button>
              );
            })}
          </div>
          {rule && (
            <div className="panel">
              <div className="panel-head">
                <div style={{ minWidth: 0, flex: 1 }}><h3>{unassigned ? <span className="mono">{rule.id}</span> : ruleLabel(rule.id, svc)}</h3><div className="sub">{posture.sentence}</div></div>
                <div className="row" style={{ gap: 8 }}>
                  <Chip tone={posture.tone} mono={false} title={posture.sentence}>{posture.label}</Chip>
                  {canEdit && editing && (
                    <>
                      <button className="btn sm" onClick={cancelEdit}>Cancel</button>
                      <button className="btn primary sm" onClick={onSaveClick} disabled={!canSave}
                        title={saveDisabledReason}>Save</button>
                    </>
                  )}
                </div>
              </div>
              {canEdit && editing && !canSave && saveDisabledReason && (
                <div className="input-hint" style={{ padding: "6px 16px 0", color: "var(--err)" }}>
                  Can't save yet — {saveDisabledReason}
                </div>
              )}

              {/* Layer 1 — protection presets */}
              {canEdit && catalog && (
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                  <label className="input-label">Protection</label>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {PRESETS.map(p => {
                      const on = activePreset === p.id;
                      const avail = presetAvailable(p);
                      const c = p.tone === 'ok' ? 'var(--ok)' : p.tone === 'warn' ? 'var(--warn)' : p.tone === 'err' ? 'var(--err)' : 'var(--info)';
                      return (
                        <button key={p.id} type="button" className="chip" aria-pressed={on} disabled={!avail}
                          title={avail ? p.blurb : `Unavailable — the "${p.authorizer}" handler isn't enabled on the gateway.`}
                          onClick={() => avail && applyPreset(p)}
                          style={{ cursor: avail ? 'pointer' : 'not-allowed', opacity: avail ? 1 : 0.45, fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 12, padding: '3px 10px', background: on ? c : 'var(--panel-2)', color: on ? '#fff' : 'var(--ink-2)', borderColor: on ? c : 'var(--line)' }}>
                          {p.label}
                        </button>
                      );
                    })}
                    {activePreset === 'custom' && <Chip tone="info" mono={false} title="This rule's handlers don't match a standard preset.">Custom</Chip>}
                  </div>
                  <div className="input-hint">{PRESETS.find(p => p.id === activePreset)?.blurb ?? 'A custom mix of sign-in and permission handlers. Open the steps below to fine-tune.'}</div>
                </div>
              )}

              <div className="panel-body col" style={{ gap: 0 }}>
                {curAuthz === "allow" && (
                  <div className="small mb-12" style={{ color: "var(--warn)", display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.alert}</span>
                    Every request matching this rule is authorized with no permission check.
                  </div>
                )}

                {/* Layer 2/3 — vertical pipeline (numbered accordion, expand in place) */}
                <div>
                  {stageMeta.map((st, i) => (
                    <StageRow key={st.k} index={i + 1} icon={st.icon} title={st.title} question={st.question}
                      summary={st.summary} tone={st.tone} last={i === stageMeta.length - 1}
                      readOnly={!canEdit || !catalog}
                      open={activeStage === st.k} onToggle={() => toggleStage(st.k)}>
                      <div key={draftEpoch}>{renderStageBody(st.k)}</div>
                    </StageRow>
                  ))}
                </div>

                {/* Read-only route map */}
                {state.routeMaps[rule.service] && (
                  <div style={{ marginTop: 8 }}>
                    <label className="input-label">Routes · {state.routeMaps[rule.service].length}</label>
                    <div className="panel" style={{ padding: 0, maxHeight: 180, overflowY: "auto" }}>
                      {state.routeMaps[rule.service].map((r, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, padding: "8px 12px", alignItems: "center", borderBottom: i < state.routeMaps[rule.service].length - 1 ? "1px solid var(--line)" : "none" }}>
                          <Method m={r.method} />
                          <span className="mono small" style={{ flex: 1 }}>{r.path}</span>
                          {r.permission ? <Chip>{r.permission}</Chip> : <Chip tone="info" title="Reachable with no permission — public">public</Chip>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Reduce protection on this rule?"
        danger
        confirmLabel="Apply anyway"
        requireText={selfProtecting ? rule?.id : undefined}
        blastRadius={rule ? <>Applies to every <b>{(draft?.methods ?? rule.match.methods).join(', ') || 'method'}</b> request matching <span className="mono">{draft?.url ?? rule.match.url}</span>{routeCount ? <> — about <b>{routeCount}</b> route{routeCount !== 1 ? 's' : ''} on this service.</> : '.'}</> : undefined}
        body={<>
          {draftAuthz === 'allow' && rule?.authorizer !== 'allow' && <div>Setting <b>Open / Public</b> means every matching request is allowed with <b>no permission check</b>.</div>}
          {draftAuthz === 'deny' && rule?.authorizer !== 'deny' && <div>Setting <b>Blocked</b> rejects every matching request at the gateway.</div>}
          {draftNoAuthn && rule && !isNoAuth(rule.authenticators) && <div style={{ marginTop: 6 }}>Removing sign-in means requests won't need to be authenticated.</div>}
          {selfProtecting && destOrMatchChanged && <div style={{ marginTop: 6 }}>Changing <b>where requests go</b> or <b>which requests match</b> on this rule can make the admin console or its API unreachable.</div>}
          {selfProtecting && <div style={{ marginTop: 8, color: 'var(--err)' }}><b>Self-lockout risk:</b> this rule protects the admin console or its API. A bad change here can lock you out of the gateway. Type the rule id to confirm.</div>}
        </>}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={doSave}
      />

      {/* Rule-switch discard guard (P1-6) */}
      <ConfirmDialog
        open={pendingSelectId !== null}
        title="Discard unsaved changes?"
        danger
        confirmLabel="Discard changes"
        body="You have unsaved changes to this rule. Switching to another rule will discard them."
        onCancel={() => setPendingSelectId(null)}
        onConfirm={() => { if (pendingSelectId) setSelectedId(pendingSelectId); setPendingSelectId(null); }}
      />
    </>
  );
}

// ─── Per-stage plain editors (jargon only under Advanced) ────────────────────

function MatchEditor({ ed }: { ed: EdCtx }) {
  const { draft } = ed;
  // Seed the plain builder once; the body remounts on a preset via the epoch key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parsed0 = useMemo(() => parseMatch(draft.url), []);
  const host = parsed0.host || hostFromUrl(draft.upstream);
  const [rawMode, setRawMode] = useState(parsed0.raw);
  const [mode, setMode] = useState<MatchMode>(parsed0.raw ? 'everything' : parsed0.mode);
  const [path, setPath] = useState(parsed0.path);
  const [sample, setSample] = useState('');

  const build = (m: MatchMode, p: string) => { setMode(m); setPath(p); if (host) ed.patch({ url: buildMatch(host, m, p) }); };

  const toggleMethod = (m: string) =>
    ed.patch({ methods: draft.methods.includes(m) ? draft.methods.filter(x => x !== m) : [...draft.methods, m] });
  const setMethods = (list: string[]) => ed.patch({ methods: list });
  const isSet = (list: string[]) => list.every(m => draft.methods.includes(m)) && draft.methods.length === list.length;

  const testResult = useMemo(() => {
    if (!sample.trim()) return null;
    try { return oryPatternToRegExp(draft.url.slice(0, 4000)).test(sample.slice(0, 2000)); }
    catch { return 'error' as const; }
  }, [sample, draft.url]);

  const modes: { id: MatchMode; label: string; needsPath: boolean; ph?: string }[] = [
    { id: 'everything', label: 'Everything on this service', needsPath: false },
    { id: 'folder', label: 'Everything under a folder', needsPath: true, ph: 'api/v1' },
    { id: 'exact', label: 'One exact address', needsPath: true, ph: 'health' },
    { id: 'id', label: 'A path with an {id} part', needsPath: true, ph: 'users/{id}' },
  ];

  return (
    <div className="col" style={{ gap: 14 }}>
      <div>
        <label className="input-label">Methods</label>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Toggle on={isSet(READ_METHODS)} onClick={() => setMethods(READ_METHODS)}>Reads</Toggle>
          <Toggle on={isSet(WRITE_METHODS)} onClick={() => setMethods(WRITE_METHODS)}>Writes</Toggle>
          <Toggle on={draft.methods.length === ALL_METHODS.length} onClick={() => setMethods([...ALL_METHODS])}>All</Toggle>
          <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 2px' }} />
          {ALL_METHODS.map(m => <Toggle key={m} on={draft.methods.includes(m)} onClick={() => toggleMethod(m)}>{m}</Toggle>)}
        </div>
        {draft.methods.length === 0 && <div className="input-hint" style={{ color: 'var(--err)' }}>Pick at least one method.</div>}
      </div>

      {rawMode ? (
        <div className="small muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--warn)', width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.alert}</span>
          This rule uses a custom match pattern — edit it under Advanced below.{host && <button type="button" className="btn ghost sm" onClick={() => { setRawMode(false); build('everything', ''); }}>Use the simple builder</button>}
        </div>
      ) : (
        <div>
          <label className="input-label">Which addresses</label>
          <div className="outcome-grid">
            {modes.map(mo => (
              <div key={mo.id}>
                <Outcome on={mode === mo.id} label={mo.label} desc={mo.id === 'everything' ? `Matches every path on ${host || 'this service'}.` : mo.id === 'id' ? 'A variable segment such as a user or record id.' : mo.id === 'exact' ? 'Matches this one address only.' : 'Matches this folder and everything beneath it.'}
                  onClick={() => build(mo.id, mo.needsPath ? path : '')} />
                {mode === mo.id && mo.needsPath && (
                  <div className="row" style={{ gap: 6, marginTop: 6, marginLeft: 26 }}>
                    <span className="mono small muted">/</span>
                    <input className="input mono sm" style={{ flex: 1 }} value={path} placeholder={mo.ph}
                      onChange={e => build(mo.id, e.target.value)} aria-label="Path" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live tester — translates the Ory <…> pattern to a JS regex (P2-7). */}
      <div>
        <label className="input-label">Try a sample URL</label>
        <input className="input mono" value={sample} placeholder="https://api.example.com/users/42"
          onChange={e => setSample(e.target.value)} style={{ width: '100%' }} />
        <div className="input-hint" aria-live="polite">
          {testResult === null ? 'Type a full URL to check whether this rule would match it.'
            : testResult === 'error' ? <span style={{ color: 'var(--warn)' }}>Can't preview — the match pattern isn't a valid expression.</span>
            : testResult ? <span style={{ color: 'var(--ok)' }}>✓ This rule matches that URL.</span>
            : <span style={{ color: 'var(--err)' }}>✗ This rule does not match that URL.</span>}
        </div>
      </div>

      <AdvancedDisclosure note="raw match pattern" defaultOpen={rawMode}>
        <label className="input-label">Match pattern <span className="muted">(Ory pattern — regex inside &lt;…&gt;)</span></label>
        <input className="input mono" value={draft.url} onChange={e => { ed.patch({ url: e.target.value }); setRawMode(true); }}
          style={{ width: '100%' }} placeholder="<https?://host/path/(.*)>" />
        <div className="input-hint">Text outside &lt;…&gt; is literal; regex goes inside. Editing here switches off the simple builder for this rule.</div>
        <div style={{ marginTop: 8 }}>
          <label className="input-label">Host</label>
          <div className="mono small" style={{ color: 'var(--ink-2)' }}>{host || '— (custom pattern)'}</div>
        </div>
      </AdvancedDisclosure>
    </div>
  );
}

function SignInEditor({ ed }: { ed: EdCtx }) {
  const { draft } = ed;
  const signedIn = draft.authn.filter(h => isRealAuthn(h.handler)).length > 0;
  const checked = draft.authz[0]?.handler === 'remote_json';
  return (
    <div className="col" style={{ gap: 14 }}>
      <div>
        <label className="input-label">Must the caller be signed in?</label>
        <div className="outcome-grid">
          <Outcome on={signedIn} label="Signed-in users only" desc="Requests without a valid session are rejected before they reach the service."
            onClick={() => ed.setSignIn(true)} />
          <Outcome on={!signedIn} label="Anyone" desc="Requests are allowed through without signing in."
            onClick={() => ed.setSignIn(false)} />
        </div>
        <div className="input-hint" aria-live="polite">
          {signedIn
            ? (checked ? 'Callers must sign in; the permission step then decides who gets through.' : 'Callers must sign in, but no permission is checked afterward — any signed-in user gets through.')
            : 'This rule is reachable by anyone, without signing in.'}
        </div>
      </div>
      <AdvancedDisclosure note="session-check settings">
        <div className="small muted mb-12">Fine-tune the sign-in handlers and their session checks. Leave fields empty to inherit the gateway defaults.</div>
        <HandlerStageEditor stage="authn" catalog={ed.catalog} value={stageValueOf(ed.draft, 'authn')} onChange={next => ed.setStage('authn', next)} />
      </AdvancedDisclosure>
    </div>
  );
}

function PermissionEditor({ ed }: { ed: EdCtx }) {
  const { draft, catalog, routes } = ed;
  const cur = draft.authz[0]?.handler ?? '';
  const enabled = new Set(catalog.authorizers.map(a => a.handler));
  const outcomes = [
    { h: 'remote_json', label: 'Check permissions', desc: 'Only callers who hold the required permission for the route get through.' },
    { h: 'allow', label: 'Allow everyone', desc: 'Every request is let through with no permission check.' },
    { h: 'deny', label: 'Block everyone', desc: 'Every request is rejected at the gateway.' },
  ];
  // The current authorizer's config, from two sources that must BOTH be honored:
  //  - `inlineCfg`: config actually present on the saved rule payload. Live rules
  //    send a bare `{ handler }` with NO inline config, so this is usually
  //    undefined — gating the whole section on it (the old `showPlatform`) is
  //    exactly why "platform policy config" rendered empty.
  //  - `authzDesc.fields`: the parameters this handler declares in the Oathkeeper
  //    catalog. These exist regardless of whether the rule carries inline values,
  //    so rendering them makes the extended params visible even for a bare rule.
  const rawAuthz = (ed.rule.raw as JinbeAccessRule | undefined)?.authorizer;
  const inlineCfg = rawAuthz?.handler === cur && rawAuthz.config && typeof rawAuthz.config === 'object' && !Array.isArray(rawAuthz.config)
    ? rawAuthz.config as Record<string, unknown>
    : undefined;
  const authzDesc = catalog.authorizers.find(a => a.handler === cur);
  const catalogFields = authzDesc?.fields ?? [];
  const hasParams = catalogFields.length > 0 || inlineCfg !== undefined;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div>
        <label className="input-label">Who is allowed through?</label>
        <div className="outcome-grid">
          {outcomes.map(o => (
            <Outcome key={o.h} on={cur === o.h} label={o.label} desc={o.desc}
              disabled={!enabled.has(o.h)} disabledHint={`The "${o.h}" handler isn't enabled on the gateway.`}
              onClick={() => ed.setPermission(o.h)} />
          ))}
        </div>
      </div>

      {/* "What this means" — the service's route → permission map. */}
      {cur === 'remote_json' && (
        <div className="panel" style={{ padding: 10 }}>
          <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>What this means for this service</div>
          {routes.length === 0
            ? <div className="small muted">No routes are mapped yet — add them under the Routes tab.</div>
            : (
              <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                {routes.slice(0, 30).map((r, i) => (
                  <div key={i} className="row" style={{ gap: 8, padding: '3px 0' }}>
                    <Method m={r.method} />
                    <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.path}</span>
                    {r.permission ? <Chip>{r.permission}</Chip> : <Chip tone="info">public</Chip>}
                  </div>
                ))}
              </div>
            )}
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button type="button" className="btn ghost sm" onClick={ed.goRoles}>Manage roles</button>
            <button type="button" className="btn ghost sm" onClick={ed.goRoutes}>See routes</button>
          </div>
        </div>
      )}

      <AdvancedDisclosure note="platform policy config" defaultOpen={hasParams}>
        {hasParams ? (
          <>
            <div className="small muted mb-12">
              {cur === 'remote_json'
                ? 'These values are a platform contract, set automatically per service and shown here read-only.'
                : 'Configuration this permission handler accepts, shown here read-only.'}
            </div>
            {/* Inline values present on the saved rule (well-known platform keys). */}
            {inlineCfg && <PlatformConfigView config={inlineCfg} />}
            {/* Catalog-declared parameters — rendered even when the rule payload
                carries no inline config, so the extended params are always
                visible. Deduped against the inline keys PlatformConfigView
                already showed. */}
            <CatalogParams fields={catalogFields} config={inlineCfg} skip={inlineCfg ? PLATFORM_INLINE_KEYS : []} />
          </>
        ) : (
          <div className="small muted">
            {cur === 'allow'
              ? 'This choice has no configurable parameters — every matching request is allowed with no permission check.'
              : cur === 'deny'
                ? 'This choice has no configurable parameters — every matching request is blocked at the gateway.'
                : cur === 'remote_json'
                  ? 'The policy connection is supplied automatically by the platform when this rule is saved.'
                  : 'Choose "Check permissions" to run the service against the permission policy.'}
          </div>
        )}
      </AdvancedDisclosure>
    </div>
  );
}

// Keys PlatformConfigView renders explicitly; CatalogParams skips these so a
// handler whose catalog descriptor also declares them isn't shown twice.
const PLATFORM_INLINE_KEYS = ['remote', 'forward_response_headers_to_upstream', 'payload'];

// Read-only render of an authorizer's catalog field descriptors. Each field is
// shown with its value from the saved rule when present, otherwise the field's
// own help/placeholder as the "supplied by the platform" hint — so the operator
// can see WHAT parameters exist even for a rule that carries a bare
// `{ handler }` (the live shape). Read-only: the policy connection is a platform
// contract the console never authors.
function CatalogParams({ fields, config, skip = [] }: { fields: FieldDescriptor[]; config?: Record<string, unknown>; skip?: string[] }) {
  const shown = fields.filter(f => !skip.includes(f.key));
  if (shown.length === 0) return null;
  return (
    <div className="col" style={{ gap: 10, marginTop: config ? 10 : 0 }}>
      {shown.map(f => {
        const v = config?.[f.key];
        const has = v !== undefined && v !== null && v !== '';
        return (
          <div key={f.key}>
            <label className="input-label">{f.label} <Chip tone="info" mono={false}>platform</Chip></label>
            {has
              ? <pre className="input mono" style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</pre>
              : <div className="small muted">{f.help || f.placeholder || 'Supplied automatically by the platform when this rule is saved.'}</div>}
          </div>
        );
      })}
    </div>
  );
}

function PlatformConfigView({ config }: { config: unknown }) {
  const cfg = (config && typeof config === 'object' && !Array.isArray(config)) ? config as Record<string, unknown> : {};
  const remote = typeof cfg.remote === 'string' ? cfg.remote : undefined;
  const forward = cfg.forward_response_headers_to_upstream;
  const payload = cfg.payload;
  return (
    <div className="col" style={{ gap: 10 }}>
      {remote !== undefined && (
        <div>
          <label className="input-label">Policy endpoint <Chip tone="info" mono={false}>platform</Chip></label>
          <div className="mono small" style={{ color: 'var(--ink-2)', wordBreak: 'break-all' }}>{remote}</div>
        </div>
      )}
      {forward !== undefined && (
        <div>
          <label className="input-label">Headers forwarded from the policy <Chip tone="info" mono={false}>platform</Chip></label>
          <div className="mono small" style={{ color: 'var(--ink-2)' }}>{Array.isArray(forward) ? (forward as unknown[]).join(', ') || '—' : String(forward)}</div>
        </div>
      )}
      {payload !== undefined && (
        <div>
          <label className="input-label">Policy input <Chip tone="info" mono={false}>platform · per-service</Chip></label>
          <pre className="input mono" style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function InfoSentEditor({ ed }: { ed: EdCtx }) {
  const { draft } = ed;
  const headerMut = draft.mutators.find(m => m.handler === 'header');
  const hdrs = readHeaderMap(headerMut);
  const master = !!headerMut && Object.keys(hdrs).length > 0;
  const userId = sendsUserId(hdrs);
  const email = sendsEmail(hdrs);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>Tell the service who the user is</div>
          <div className="small muted">Adds identity details to each forwarded request.</div>
        </div>
        <Switch on={master} onChange={on => ed.setInfoSent({ master: on, userId: on, email: on })} />
      </div>
      {master && (
        <div className="col" style={{ gap: 8, paddingLeft: 4 }}>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={userId} onChange={e => ed.setInfoSent({ master: true, userId: e.target.checked, email })} />
            <span className="small">User ID <span className="muted mono">({HDR_USER_ID})</span></span>
          </label>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={email} onChange={e => ed.setInfoSent({ master: true, userId, email: e.target.checked })} />
            <span className="small">Email <span className="muted mono">({HDR_EMAIL})</span></span>
          </label>
        </div>
      )}
      <div className="small muted" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1 }}>{I.info}</span>
        The user's groups and permissions are sent automatically by the permission step — you don't set them here.
      </div>
      <AdvancedDisclosure note="raw headers & custom mutators">
        <div className="small muted mb-12">Edit the exact header name → value map, or add custom request transformations.</div>
        <HandlerStageEditor stage="mutate" catalog={ed.catalog} value={stageValueOf(ed.draft, 'mutate')} onChange={next => ed.setStage('mutate', next)} />
      </AdvancedDisclosure>
    </div>
  );
}

function ErrorsEditor({ ed }: { ed: EdCtx }) {
  const { draft } = ed;
  const inherit = draft.errors.length === 0;
  const browsers = inherit || draft.errors.some(e => e.handler === 'redirect');
  const apps = inherit || draft.errors.some(e => e.handler === 'json');
  const enabled = new Set(ed.catalog.errorHandlers.map(h => h.handler));
  return (
    <div className="col" style={{ gap: 14 }}>
      {inherit && <div className="small muted">Using the gateway default — browsers are sent to the sign-in page, apps &amp; tools get an error message.</div>}
      <div className="col" style={{ gap: 8 }}>
        <div className="outcome" style={{ cursor: 'default' }}>
          <span style={{ marginTop: 1 }}><Switch on={browsers} onChange={on => ed.setErrorAudience('browsers', on)} /></span>
          <span className="outcome-txt">
            <span className="outcome-lbl">Browsers → sign-in page</span>
            <span className="outcome-desc">A person in a web browser is redirected to sign in.{!enabled.has('redirect') && ' (redirect handler not enabled on the gateway)'}</span>
          </span>
        </div>
        <div className="outcome" style={{ cursor: 'default' }}>
          <span style={{ marginTop: 1 }}><Switch on={apps} onChange={on => ed.setErrorAudience('apps', on)} /></span>
          <span className="outcome-txt">
            <span className="outcome-lbl">Apps &amp; tools → error message</span>
            <span className="outcome-desc">Programmatic callers get a machine-readable error response.{!enabled.has('json') && ' (json handler not enabled on the gateway)'}</span>
          </span>
        </div>
      </div>
      <div className="input-hint">At least one audience must stay on. Leaving both on keeps the gateway default (nothing is written for this rule).</div>
      <AdvancedDisclosure note="raw error handlers">
        <div className="small muted mb-12">Set the sign-in URL, redirect conditions and verbosity directly.</div>
        <HandlerStageEditor stage="errors" catalog={ed.catalog} value={stageValueOf(ed.draft, 'errors')} onChange={next => ed.setStage('errors', next)} />
      </AdvancedDisclosure>
    </div>
  );
}

function UpstreamEditor({ ed }: { ed: EdCtx }) {
  const { draft } = ed;
  const stripOn = !!draft.stripPath;
  const suggested = useMemo(() => suggestStripPrefix(ed.routes.map(r => r.path)), [ed.routes]);
  const sample = ed.routes[0]?.path || '/api/v1/example';
  const after = draft.stripPath && sample.startsWith(draft.stripPath)
    ? (sample.slice(draft.stripPath.length) || '/') : sample;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div>
        <label className="input-label">Where requests go</label>
        <input className="input mono" value={draft.upstream} onChange={e => ed.patch({ upstream: e.target.value })}
          style={{ width: '100%' }} placeholder="http://service.namespace:8080" />
        {draft.upstream && !ed.validUpstream && <div className="input-hint" style={{ color: 'var(--err)' }}>Must start with http:// or https://</div>}
      </div>
      <div>
        <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 12.5 }}>Remove a path prefix</div>
            <div className="small muted">Strip a leading part of the path before forwarding.</div>
          </div>
          <Switch on={stripOn} onChange={on => ed.patch({ stripPath: on ? (draft.stripPath || suggested) : '' })} />
        </div>
        {stripOn && (
          <div style={{ marginTop: 8 }}>
            <input className="input mono" value={draft.stripPath} onChange={e => ed.patch({ stripPath: e.target.value })}
              style={{ width: '100%' }} placeholder="/api/v1" />
            {suggested && draft.stripPath !== suggested && (
              <button type="button" className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => ed.patch({ stripPath: suggested })}>
                Use suggested: <span className="mono">{suggested}</span>
              </button>
            )}
            <div className="opa-preview" style={{ marginTop: 8 }}>
              <div className="opa-col"><div className="small muted">Before</div><pre>{sample}</pre></div>
              <div className="opa-col"><div className="small muted">After</div><pre>{after}</pre></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Shared: the draft slice for a handler stage (used by the Advanced disclosures).
function stageValueOf(d: Draft, s: HandlerStage): DraftHandler[] {
  return s === 'authn' ? d.authn : s === 'authz' ? d.authz : s === 'mutate' ? d.mutators : d.errors;
}
