import { FAILS_LABEL, GETS_LABEL, PASS_LABEL, WHO, WHO_LABEL, presetsOf, type FailsPreset, type GetsPreset, type PassPreset, type WhoPreset } from './presets';
import type { Gate, Handler } from './types';

/**
 * A customized gate answer said in plain words (site-ux.md §7.1): what the handlers actually do,
 * what that costs when it costs something, and the preset closest to it — so Basic never shows an
 * empty choice with only "see Advanced" beside it.
 */

export type Question = 'who' | 'pass' | 'gets' | 'fails';

export interface CustomAnswer {
  /** "Signed-in people (cookie) · Kratos session token in Authorization". */
  words: string;
  /** The consequence, when the chain loses callers or trust. */
  warning?: { level: 'error' | 'warn'; text: string };
  /** The preset nearest to what is configured; applying it replaces the custom chain. */
  closest: { value: string; label: string };
}

const tokenHeader = (h: Handler): string | null => {
  const from = h.config?.token_from as { header?: string; query_parameter?: string; cookie?: string } | undefined;
  if (!from) return null;
  return from.header ?? (from.cookie ? `cookie ${from.cookie}` : from.query_parameter ? `query ?${from.query_parameter}` : null);
};

function authnWord(h: Handler): string {
  switch (h.handler) {
    case 'cookie_session': return 'Signed-in people (cookie)';
    case 'bearer_token': return `Kratos session token in ${tokenHeader(h) ?? 'Authorization'}`;
    case 'oauth2_introspection': return 'OAuth2 / API tokens';
    case 'oauth2_client_credentials': return 'Client id + secret';
    case 'jwt': return 'Signed JWTs';
    case 'anonymous': return 'Anonymous visitors';
    case 'noop': return 'Anyone (no check)';
    case 'unauthorized': return 'Always refused';
    default: return h.handler;
  }
}

function mutatorWord(h: Handler): string {
  switch (h.handler) {
    case 'header': {
      const names = Object.keys((h.config?.headers as Record<string, unknown> | undefined) ?? {});
      return names.length ? `headers ${names.join(', ')}` : 'identity headers';
    }
    case 'hydrator': return 'enriched from an API';
    case 'id_token': return 'a signed ID token (JWT)';
    case 'cookie': return 'identity cookies';
    case 'noop': return 'nothing';
    default: return h.handler;
  }
}

function errorWord(h: Handler): string {
  switch (h.handler) {
    case 'redirect': return 'send to sign-in';
    case 'json': return 'JSON errors';
    case 'www_authenticate': return 'browser password prompt';
    default: return h.handler;
  }
}

/**
 * A Kratos session token read from Authorization (bearer_token without token_from) takes every
 * bearer token: an OAuth2 / API token there goes to Kratos and is refused. With introspection after
 * it, introspection never runs — jinbe refuses that (bearer_before_oauth2); without introspection
 * it is said (bare_bearer_token). Introspection first is left to the order check.
 */
export function bareBearer(authenticators: Handler[]): 'bearer_before_oauth2' | 'bare_bearer_token' | null {
  const bare = authenticators.findIndex((h) => h.handler === 'bearer_token' && !h.config?.token_from);
  if (bare < 0) return null;
  const intro = authenticators.findIndex((h) => h.handler === 'oauth2_introspection');
  return intro < 0 ? 'bare_bearer_token' : intro > bare ? 'bearer_before_oauth2' : null;
}

export const NOBODY_SIGNS_IN = 'Nobody can sign in through this gate — add a sign-in method or pick one below.';
export const BARE_BEARER = 'A session token read from Authorization takes every bearer token: OAuth2 / API tokens are sent to Kratos and rejected. Read the session token from X-Session-Token instead.';
export const BEARER_BEFORE_OAUTH2 = 'The session token is read from Authorization before OAuth2 introspection, so introspection never runs: OAuth2 / API tokens are rejected. Read the session token from X-Session-Token, or put introspection first.';

/** Overlap of handler names (Jaccard): the preset that keeps most of what is there. */
function nearest<K extends string>(table: Record<K, Handler[]>, handlers: Handler[]): K {
  const have = new Set(handlers.map((h) => h.handler));
  let best = Object.keys(table)[0] as K;
  let score = -1;
  for (const k of Object.keys(table) as K[]) {
    const want = new Set(table[k].map((h) => h.handler));
    const both = [...want].filter((x) => have.has(x)).length;
    const s = both / new Set([...want, ...have]).size;
    if (s > score) { best = k; score = s; }
  }
  return best;
}

export function describeWho(gate: Gate): CustomAnswer {
  const a = gate.authenticators;
  const closest = a.length ? nearest(WHO, a) : 'signed-in';
  return {
    words: a.length ? a.map(authnWord).join(' · ') : 'No sign-in method',
    warning: a.length === 0 ? { level: 'error', text: NOBODY_SIGNS_IN }
      : bareBearer(a) === 'bearer_before_oauth2' ? { level: 'error', text: BEARER_BEFORE_OAUTH2 }
      : bareBearer(a) ? { level: 'warn', text: BARE_BEARER }
      : undefined,
    closest: { value: closest, label: WHO_LABEL[closest as WhoPreset] },
  };
}

export function describePass(gate: Gate): CustomAnswer {
  const z = gate.authorizer;
  const h = typeof z === 'string' ? 'remote_json' : z.handler;
  const closest: PassPreset = h === 'allow' ? 'everyone' : h === 'deny' ? 'nobody' : 'policy';
  const words = h === 'allow' ? 'Everyone who signed in (with extra settings)'
    : h === 'deny' ? 'Nobody (with extra settings)'
    : h === 'remote_json' ? 'A permission check with its own settings'
    : h === 'remote' ? 'An outside service decides (remote)'
    : h;
  return { words, closest: { value: closest, label: PASS_LABEL[closest] } };
}

export function describeGets(gate: Gate): CustomAnswer {
  const m = gate.mutators;
  const names = m.map((h) => h.handler);
  const closest: GetsPreset = names.includes('hydrator') ? 'enrich' : names.some((n) => n === 'header' || n === 'id_token' || n === 'cookie') ? 'identity' : 'nothing';
  const anonymous = gate.authenticators.every((h) => h.handler === 'noop');
  return {
    words: m.length ? `The service gets ${m.map(mutatorWord).join(', then ')}` : 'Nothing is forwarded',
    warning: closest === 'nothing' && !anonymous ? { level: 'warn', text: 'The service receives no identity — it must not trust X-User-* headers from the request.' } : undefined,
    closest: { value: closest, label: GETS_LABEL[closest] },
  };
}

export function describeFails(gate: Gate): CustomAnswer {
  const e = Array.isArray(gate.errors) ? gate.errors : [];
  const names = e.map((h) => h.handler);
  const closest: FailsPreset = names.includes('redirect') ? 'website' : names.length ? 'api' : 'platform';
  return {
    words: e.length ? e.map(errorWord).join(', else ') : 'Platform default',
    closest: { value: closest, label: FAILS_LABEL[closest] },
  };
}

const DESCRIBE: Record<Question, (g: Gate) => CustomAnswer> = { who: describeWho, pass: describePass, gets: describeGets, fails: describeFails };

/** Every question the gate answers outside the presets, in words. */
export function customAnswers(gate: Gate): Partial<Record<Question, CustomAnswer>> {
  const p = presetsOf(gate);
  return Object.fromEntries((Object.keys(DESCRIBE) as Question[]).filter((q) => p[q] === 'custom').map((q) => [q, DESCRIBE[q](gate)]));
}
