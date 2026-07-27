import { useState } from 'react';
import { Switch } from './ui/Primitives';
import { I } from './ui/Icons';
import type { FieldDescriptor, HandlerDescriptor, OathkeeperHandlerCatalog } from '../api/client';

// ─── Stage vocabulary ──────────────────────────────────────────────────────
// The four handler-based gateway stages. Match & Send (upstream) are edited
// separately (they aren't handler pickers) — see Rules.tsx.
export type HandlerStage = 'authn' | 'authz' | 'mutate' | 'errors';

// ─── Draft representation ──────────────────────────────────────────────────
// A handler instance being edited. `cfg` holds the GUIDED field values (native
// types, keyed by catalog field key); `rawText` is the Advanced escape hatch —
// free-form JSON for any config beyond the guided fields. `errs` collects
// validation messages ('__raw__' for the raw box, field key otherwise) so the
// parent can block Save while anything is invalid.
export interface DraftHandler {
  handler: string;
  cfg: Record<string, unknown>;
  rawText: string;
  errs: Record<string, string>;
}

/** Build a fresh handler instance for `handler` (no config yet). */
export function newDraftHandler(handler: string): DraftHandler {
  return { handler, cfg: {}, rawText: '', errs: {} };
}

/**
 * Seed a DraftHandler from an existing `{ handler, config }`, splitting its
 * config into GUIDED values (keys the descriptor knows about) and everything
 * else (kept verbatim in the raw-JSON box so nothing is silently dropped).
 */
export function toDraftHandler(
  inst: { handler: string; config?: unknown },
  desc?: HandlerDescriptor,
): DraftHandler {
  const config = inst.config && typeof inst.config === 'object' && !Array.isArray(inst.config)
    ? (inst.config as Record<string, unknown>)
    : {};
  const fieldKeys = new Set((desc?.fields ?? []).map(f => f.key));
  const cfg: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (fieldKeys.has(k)) cfg[k] = v;
    else extra[k] = v;
  }
  return {
    handler: inst.handler,
    cfg,
    rawText: Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '',
    errs: {},
  };
}

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/**
 * Rebuild a handler instance's `config` = guided ∪ parsed-raw (guided wins on
 * key conflicts). Returns `undefined` when there's nothing to write (so the
 * caller can emit a bare `{ handler }`). Assumes `rawText` already parses — the
 * parent blocks Save via `errs` otherwise; a defensive catch keeps it total.
 */
export function draftHandlerToConfig(d: DraftHandler): unknown {
  let extra: Record<string, unknown> = {};
  if (d.rawText.trim()) {
    try { extra = JSON.parse(d.rawText) as Record<string, unknown>; } catch { extra = {}; }
  }
  const guided: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d.cfg)) if (!isEmpty(v)) guided[k] = v;
  const merged = { ...extra, ...guided };
  return Object.keys(merged).length ? merged : undefined;
}

/** True when any handler in the list has an outstanding validation error. */
export function draftHandlersValid(list: DraftHandler[]): boolean {
  return list.every(h => Object.values(h.errs).every(m => !m));
}

// ─── Protection presets (plain-language ↔ handler combos) ───────────────────
export type PresetId = 'protected' | 'signedin' | 'public' | 'blocked';

export interface PresetDef {
  id: PresetId;
  label: string;
  tone: string;      // chip/button tone: ok | info | warn | err
  blurb: string;
  authenticators: string[];
  authorizer: string;
}

export const PRESETS: PresetDef[] = [
  { id: 'protected', label: 'Protected',       tone: 'ok',   blurb: 'Signed-in users who hold the right permission',  authenticators: ['cookie_session'], authorizer: 'remote_json' },
  { id: 'signedin',  label: 'Signed-in only',  tone: 'info', blurb: 'Any signed-in user — no permission check',       authenticators: ['cookie_session'], authorizer: 'allow' },
  { id: 'public',    label: 'Public',          tone: 'warn', blurb: 'Anyone, no sign-in required',                    authenticators: ['noop'],           authorizer: 'allow' },
  { id: 'blocked',   label: 'Blocked',         tone: 'err',  blurb: 'Every request rejected at the gateway',          authenticators: [],                 authorizer: 'deny' },
];

// A handler that provides no real authentication.
export const isRealAuthn = (h: string) => h !== 'noop' && h !== 'anonymous' && h !== 'unauthorized';

/**
 * Classify a rule's (authenticators, authorizer) into one of the four presets,
 * or 'custom' when it matches none.
 *
 * Noop-tolerance is scoped to the `remote_json` branch ONLY: there the policy
 * check runs regardless of who authenticated, so a trailing `noop` is harmless
 * (an anonymous caller still gets denied by the policy). Under `allow` there is
 * NO such backstop — a real authenticator sitting next to a `noop` means an
 * anonymous request authenticates as noop and `allow` waves it straight
 * through. That is an anonymous bypass, so it must read as `public` (bypass
 * tone), never `signedin`.
 */
export function classify(authenticators: string[], authorizer: string): PresetId | 'custom' {
  if (authorizer === 'deny') return 'blocked';
  const real = authenticators.filter(isRealAuthn);
  const hasFakeAuthn = authenticators.some(a => !isRealAuthn(a));
  if (authorizer === 'remote_json') {
    return real.length === 1 && real[0] === 'cookie_session' ? 'protected' : 'custom';
  }
  if (authorizer === 'allow') {
    if (real.length === 0) return 'public';
    // Real authenticator + noop under `allow` = anonymous bypass → public.
    if (hasFakeAuthn) return 'public';
    if (real.length === 1 && real[0] === 'cookie_session') return 'signedin';
    return 'custom';
  }
  return 'custom';
}

export interface Posture { key: PresetId | 'custom'; label: string; tone: string; sentence: string; }

/** Per-rule posture (chip + one plain sentence) derived from its handlers. */
export function rulePosture(authenticators: string[], authorizer: string): Posture {
  switch (classify(authenticators, authorizer)) {
    case 'protected': return { key: 'protected', label: 'Protected',      tone: 'ok',   sentence: 'Only signed-in users who hold the right permission can reach this.' };
    case 'signedin':  return { key: 'signedin',  label: 'Signed-in only', tone: 'info', sentence: 'Any signed-in user can reach this — no permission is checked.' };
    case 'public':    return { key: 'public',    label: 'Public',         tone: 'warn', sentence: 'Anyone can reach this without signing in.' };
    case 'blocked':   return { key: 'blocked',   label: 'Blocked',        tone: 'err',  sentence: 'Every request matching this rule is rejected at the gateway.' };
    default: {
      const signIn = authenticators.filter(isRealAuthn).length > 0;
      const checked = authorizer === 'remote_json';
      return {
        key: 'custom', label: 'Custom', tone: 'info',
        sentence: `Custom setup — sign-in ${signIn ? 'required' : 'not required'}, ${checked ? 'permission checked' : 'no permission check'}.`,
      };
    }
  }
}

/**
 * Service-level posture aggregated across all of a service's gateway rules
 * (Protected / Open / Public / Blocked). Used by the Services list to show
 * protection at a glance. Returns null when the service has no rules.
 */
export function serviceGatewayPosture(
  rules: { authenticators: string[]; authorizer: string }[],
): { label: string; tone: string } | null {
  if (rules.length === 0) return null;
  const allPublic = rules.every(r => r.authorizer === 'allow' && r.authenticators.filter(isRealAuthn).length === 0);
  if (allPublic) return { label: 'Public', tone: 'warn' };
  // A rule with a real authenticator AND a noop under `allow` is an anonymous
  // bypass masquerading as protected (noop→allow lets anyone through). Never let
  // it aggregate up to "Protected"; surface it as "Open" (warn) instead.
  const anyBypass = rules.some(r => r.authorizer === 'allow'
    && r.authenticators.some(isRealAuthn) && r.authenticators.some(a => !isRealAuthn(a)));
  if (!anyBypass && rules.some(r => r.authorizer === 'remote_json')) return { label: 'Protected', tone: 'ok' };
  if (rules.some(r => r.authorizer === 'allow')) return { label: 'Open', tone: 'warn' };
  return { label: 'Blocked', tone: 'err' };
}

// ─── Guided field controls ─────────────────────────────────────────────────

/** Small key/value editor for `kv`-typed fields (Record<string,string>). */
function KvField({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const entries = Object.entries(value ?? {});
  const setAt = (i: number, k: string, v: string) => {
    const next = entries.map((e, j) => (j === i ? [k, v] : e)) as [string, string][];
    onChange(Object.fromEntries(next.filter(([kk]) => kk !== '')));
  };
  const removeAt = (i: number) => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)));
  return (
    <div className="col" style={{ gap: 6 }}>
      {entries.map(([k, v], i) => (
        <div key={i} className="row" style={{ gap: 6 }}>
          <input className="input mono sm" style={{ flex: 1 }} value={k} placeholder="key" onChange={e => setAt(i, e.target.value, v)} />
          <input className="input mono sm" style={{ flex: 1 }} value={v} placeholder="value" onChange={e => setAt(i, k, e.target.value)} />
          <button type="button" className="btn ghost sm" onClick={() => removeAt(i)} aria-label="Remove pair">
            <span style={{ width: 12, height: 12, display: 'grid', placeItems: 'center' }}>{I.close}</span>
          </button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange({ ...value, '': '' })}>
        <span style={{ width: 12, height: 12, display: 'inline-grid', placeItems: 'center', marginRight: 4 }}>{I.plus}</span> Add pair
      </button>
    </div>
  );
}

/** Token editor for `list`-typed fields (string[]): chips + add-on-Enter. */
function ListField({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState('');
  const items = value ?? [];
  const add = () => { const t = text.trim(); if (t && !items.includes(t)) onChange([...items, t]); setText(''); };
  return (
    <div className="col" style={{ gap: 6 }}>
      {items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {items.map(it => (
            <span key={it} className="chip mono">
              {it}
              <button type="button" onClick={() => onChange(items.filter(x => x !== it))} aria-label={`Remove ${it}`}
                style={{ border: 'none', background: 'none', color: 'var(--ink-3)', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        <input className="input mono sm" style={{ flex: 1 }} value={text} placeholder={placeholder || 'add value…'}
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn sm" onClick={add} disabled={!text.trim()}>Add</button>
      </div>
    </div>
  );
}

/** JSON-object field: validated textarea; reports parse errors up via onError. */
function JsonField({ value, onChange, onError, placeholder }: {
  value: unknown; onChange: (v: unknown) => void; onError: (msg: string) => void; placeholder?: string;
}) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
  const [err, setErr] = useState('');
  const onText = (t: string) => {
    setText(t);
    if (!t.trim()) { setErr(''); onError(''); onChange(undefined); return; }
    try { const p = JSON.parse(t); setErr(''); onError(''); onChange(p); }
    catch (ex) { const m = (ex as Error).message; setErr(m); onError(m); }
  };
  return (
    <>
      <textarea className="input mono" rows={4} value={text} placeholder={placeholder} onChange={e => onText(e.target.value)} />
      {err && <div className="input-hint" style={{ color: 'var(--err)' }}>Invalid JSON — {err}</div>}
    </>
  );
}

function GuidedField({ field, value, onChange, onError }: {
  field: FieldDescriptor; value: unknown; onChange: (v: unknown) => void; onError: (msg: string) => void;
}) {
  const control = (() => {
    switch (field.type) {
      case 'bool':
        return <Switch on={value === true} onChange={onChange} />;
      case 'textarea':
        return <textarea className="input mono" rows={3} value={(value as string) ?? ''} placeholder={field.placeholder} onChange={e => onChange(e.target.value)} />;
      case 'kv':
        return <KvField value={(value as Record<string, string>) ?? {}} onChange={onChange} />;
      case 'list':
        return <ListField value={(value as string[]) ?? []} onChange={onChange} placeholder={field.placeholder} />;
      case 'json':
        return <JsonField value={value} onChange={onChange} onError={onError} placeholder={field.placeholder} />;
      case 'url':
      case 'string':
      default:
        return <input className={`input${field.type === 'url' ? ' mono' : ''}`} value={(value as string) ?? ''} placeholder={field.placeholder} onChange={e => onChange(e.target.value)} />;
    }
  })();
  return (
    <div>
      <label className="input-label">
        {field.label}{field.required && <span style={{ color: 'var(--err)' }}> *</span>}
      </label>
      {control}
      {field.help && <div className="input-hint">{field.help}</div>}
    </div>
  );
}

// ─── Per-handler config card ───────────────────────────────────────────────
function HandlerConfigCard({ handlerName, desc, draft, enabled, onChange }: {
  handlerName: string; desc?: HandlerDescriptor; draft: DraftHandler; enabled: boolean;
  onChange: (next: DraftHandler) => void;
}) {
  const [showRaw, setShowRaw] = useState(!!draft.rawText.trim());
  const setCfg = (key: string, v: unknown) => onChange({ ...draft, cfg: { ...draft.cfg, [key]: v } });
  const setErr = (key: string, msg: string) => onChange({ ...draft, errs: { ...draft.errs, [key]: msg } });
  const onRaw = (t: string) => {
    let msg = '';
    if (t.trim()) { try { JSON.parse(t); } catch (ex) { msg = (ex as Error).message; } }
    onChange({ ...draft, rawText: t, errs: { ...draft.errs, __raw__: msg } });
  };
  const fields = desc?.fields ?? [];
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: fields.length || !enabled ? 10 : 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>{desc?.label || handlerName}</div>
          <div className="small muted mono">{handlerName}{desc?.description ? <span style={{ fontFamily: 'var(--font-sans)' }}> — {desc.description}</span> : null}</div>
        </div>
        {!enabled && <span className="chip err" title="This handler is not enabled on the gateway — remove it or the ruleset will be rejected.">not enabled</span>}
      </div>

      {fields.map(f => (
        <div key={f.key} style={{ marginBottom: 10 }}>
          <GuidedField field={f} value={draft.cfg[f.key]} onChange={v => setCfg(f.key, v)} onError={m => setErr(f.key, m)} />
        </div>
      ))}

      {(desc?.hasFreeformConfig || draft.rawText.trim() || fields.length === 0) && (
        <>
          <button type="button" className="btn ghost sm" style={{ padding: 0 }} onClick={() => setShowRaw(v => !v)}>
            {showRaw ? '▾' : '▸'} Advanced · raw JSON config
          </button>
          {showRaw && (
            <div style={{ marginTop: 8 }}>
              <textarea className="input mono" rows={4} value={draft.rawText} placeholder='{ "key": "value" }'
                onChange={e => onRaw(e.target.value)} />
              {draft.errs.__raw__
                ? <div className="input-hint" style={{ color: 'var(--err)' }}>Invalid JSON — {draft.errs.__raw__}</div>
                : <div className="input-hint">Custom config merged with the fields above. Must be a valid JSON object.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Stage editor ──────────────────────────────────────────────────────────
const CHOOSER_LABEL: Record<HandlerStage, string> = {
  authn: 'Sign-in method',
  authz: 'Permission check',
  mutate: 'Information sent to the service',
  errors: 'What users see on error',
};
const EMPTY_HINT: Record<HandlerStage, string> = {
  authn: 'No sign-in method selected — requests reach the service unauthenticated.',
  authz: 'No permission check selected.',
  mutate: 'Nothing selected — the request is forwarded unchanged.',
  errors: 'Nothing selected — the gateway default error response is used.',
};

function descriptorsFor(stage: HandlerStage, catalog?: OathkeeperHandlerCatalog): HandlerDescriptor[] {
  if (!catalog) return [];
  return stage === 'authn' ? catalog.authenticators
    : stage === 'authz' ? catalog.authorizers
    : stage === 'mutate' ? catalog.mutators
    : catalog.errorHandlers;
}

/**
 * Layer 3 — the per-stage editor (where Ory jargon lives). Lists the ENABLED
 * handlers as choosers (single segmented for the authorizer, multi-select
 * otherwise) and renders guided fields + a raw-JSON escape hatch per selection.
 * Fully controlled: `value` is the parent's draft slice for this stage.
 */
export function HandlerStageEditor({ stage, catalog, value, onChange }: {
  stage: HandlerStage;
  catalog?: OathkeeperHandlerCatalog;
  value: DraftHandler[];
  onChange: (next: DraftHandler[]) => void;
}) {
  const descriptors = descriptorsFor(stage, catalog);
  const single = stage === 'authz';
  const enabledNames = new Set(descriptors.map(d => d.handler));
  const selected = new Set(value.map(v => v.handler));
  const descOf = (h: string) => descriptors.find(d => d.handler === h);

  const pick = (h: string) => {
    if (single) { onChange([newDraftHandler(h)]); return; }
    if (selected.has(h)) onChange(value.filter(v => v.handler !== h));
    else onChange([...value, newDraftHandler(h)]);
  };
  const updateHandler = (h: string, next: DraftHandler) => onChange(value.map(v => (v.handler === h ? next : v)));

  // Selected handlers that aren't in the enabled catalog (stale rule) — still
  // shown so they can be removed; the parent blocks Save while any remains.
  const orphanSelected = value.filter(v => !enabledNames.has(v.handler));

  return (
    <div className="col" style={{ gap: 14 }}>
      <div>
        <label className="input-label">{CHOOSER_LABEL[stage]}</label>
        {descriptors.length === 0 ? (
          <div className="small muted">No {stage === 'errors' ? 'error' : stage} handlers are enabled on the gateway.</div>
        ) : single ? (
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            {descriptors.map(d => (
              <button key={d.handler} type="button" className={selected.has(d.handler) ? 'on' : ''} title={d.description} onClick={() => pick(d.handler)}>
                {d.label}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {descriptors.map(d => {
              const on = selected.has(d.handler);
              return (
                <button key={d.handler} type="button" className="chip" aria-pressed={on} title={d.description} onClick={() => pick(d.handler)}
                  style={{ cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 500, background: on ? 'var(--accent)' : 'var(--panel-2)', color: on ? '#fff' : 'var(--ink-2)', borderColor: on ? 'var(--accent)' : 'var(--line)' }}>
                  {on && <span style={{ fontSize: 10 }}>✓</span>} {d.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {orphanSelected.map(v => (
        <HandlerConfigCard key={v.handler} handlerName={v.handler} desc={undefined} draft={v} enabled={false} onChange={n => updateHandler(v.handler, n)} />
      ))}
      {value.filter(v => enabledNames.has(v.handler)).map(v => (
        <HandlerConfigCard key={v.handler} handlerName={v.handler} desc={descOf(v.handler)} draft={v} enabled onChange={n => updateHandler(v.handler, n)} />
      ))}

      {value.length === 0 && descriptors.length > 0 && <div className="small muted">{EMPTY_HINT[stage]}</div>}
    </div>
  );
}
