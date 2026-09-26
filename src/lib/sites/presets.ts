import type { Gate, Handler } from './types';

/**
 * The gate's four questions (site-ux.md §7.1) and the handlers each answer renders to (OK§11.4–11.7).
 * `presetsOf` reads a gate back into answers, `custom` when the handlers are not exactly a preset —
 * that is the "Customized" badge, shown even in Basic, so a hand-built chain is never hidden.
 */

export type WhoPreset = 'signed-in' | 'signed-in-or-tokens' | 'tokens' | 'machines' | 'anyone' | 'optional';
export type PassPreset = 'policy' | 'everyone' | 'nobody';
export type GetsPreset = 'identity' | 'nothing' | 'enrich';
export type FailsPreset = 'website' | 'api' | 'platform';
export type Custom = 'custom';

const SESSION_TOKEN: Handler = {
  handler: 'bearer_token',
  config: { token_from: { header: 'X-Session-Token' }, forward_http_headers: ['X-Session-Token'] },
};

export const WHO: Record<WhoPreset, Handler[]> = {
  'signed-in': [{ handler: 'cookie_session' }],
  'signed-in-or-tokens': [{ handler: 'cookie_session' }, SESSION_TOKEN, { handler: 'oauth2_introspection' }],
  tokens: [{ handler: 'oauth2_introspection' }, SESSION_TOKEN],
  machines: [{ handler: 'oauth2_introspection' }],
  anyone: [{ handler: 'noop' }],
  optional: [{ handler: 'cookie_session' }, { handler: 'anonymous' }],
};

export const PASS: Record<PassPreset, Gate['authorizer']> = {
  policy: 'policy',
  everyone: { handler: 'allow' },
  nobody: { handler: 'deny' },
};

export const GETS: Record<GetsPreset, Handler[]> = {
  identity: [{ handler: 'header' }],
  nothing: [{ handler: 'noop' }],
  enrich: [{ handler: 'hydrator' }, { handler: 'header' }],
};

export const WHO_LABEL: Record<WhoPreset, string> = {
  'signed-in': 'Signed-in people (session cookie)',
  'signed-in-or-tokens': 'Signed-in people or API tokens',
  tokens: 'API tokens only (OAuth2 or session token)',
  machines: 'Machines only (OAuth2 tokens)',
  anyone: 'Anyone',
  optional: 'Optional sign-in',
};
export const PASS_LABEL: Record<PassPreset, string> = {
  policy: 'Check permissions per route (recommended)',
  everyone: 'Everyone who signed in',
  nobody: 'Nobody (block)',
};
export const GETS_LABEL: Record<GetsPreset, string> = {
  identity: 'Identity headers: X-User-Id, X-User-Email, X-User-Groups',
  nothing: 'Nothing (the service must not trust X-User-* headers)',
  enrich: 'Enrich from an API, then headers',
};
export const FAILS_LABEL: Record<FailsPreset, string> = {
  website: 'Website: send to sign-in, show errors as pages',
  api: 'API: JSON errors',
  platform: 'Platform default',
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function find<K extends string, V>(table: Record<K, V>, value: V): K | Custom {
  return (Object.keys(table) as K[]).find((k) => same(table[k], value)) ?? 'custom';
}

export interface GatePresets { who: WhoPreset | Custom; pass: PassPreset | Custom; gets: GetsPreset | Custom; fails: FailsPreset | Custom }

export function presetsOf(gate: Gate): GatePresets {
  return {
    who: find(WHO, gate.authenticators),
    pass: find(PASS, gate.authorizer),
    gets: find(GETS, gate.mutators),
    fails: typeof gate.errors === 'string' ? gate.errors : 'custom',
  };
}

export const isCustomized = (gate: Gate) => Object.values(presetsOf(gate)).includes('custom') || !!gate.expert?.matchUrl;

/** Whether the gate lets anonymous callers through (a Public route needs one). */
export const allowsAnonymous = (gate: Gate) => gate.authenticators.some((a) => a.handler === 'noop' || a.handler === 'anonymous');

/**
 * Apply one answer. "Anyone" forces "Who may pass" to Everyone or Nobody: with no subject the policy
 * has nobody to check (render refuses a noop gate with remote_json).
 */
export function withPreset(gate: Gate, question: 'who' | 'pass' | 'gets' | 'fails', value: string): Gate {
  if (question === 'who') {
    const next = { ...gate, authenticators: WHO[value as WhoPreset] };
    if (value === 'anyone') {
      return { ...next, authorizer: gate.authorizer === 'policy' ? PASS.everyone : gate.authorizer, mutators: GETS.nothing };
    }
    return next;
  }
  if (question === 'pass') return { ...gate, authorizer: PASS[value as PassPreset] };
  if (question === 'gets') return { ...gate, mutators: GETS[value as GetsPreset] };
  return { ...gate, errors: value as FailsPreset };
}

/** Handlers per kind, with the sandbox's enabled set as a fallback when the platform is not read. */
export interface HandlerCatalog { authenticators: string[]; authorizers: string[]; mutators: string[]; errors: string[] }

export const SANDBOX_ENABLED: HandlerCatalog = {
  authenticators: ['noop', 'cookie_session', 'bearer_token', 'oauth2_introspection'],
  authorizers: ['allow', 'deny', 'remote_json'],
  mutators: ['noop', 'header', 'hydrator'],
  errors: ['json', 'redirect'],
};

export const ALL_HANDLERS: HandlerCatalog = {
  authenticators: ['cookie_session', 'bearer_token', 'oauth2_introspection', 'noop', 'jwt', 'anonymous', 'oauth2_client_credentials', 'unauthorized'],
  authorizers: ['remote_json', 'allow', 'deny', 'remote'],
  mutators: ['header', 'hydrator', 'noop', 'cookie', 'id_token'],
  errors: ['redirect', 'json', 'www_authenticate'],
};

/** The handlers a preset needs that the gateway does not run, for the locked explanation. */
export function missingHandlers(handlers: Handler[], enabled: string[]): string[] {
  return handlers.map((h) => h.handler).filter((h) => !enabled.includes(h));
}
