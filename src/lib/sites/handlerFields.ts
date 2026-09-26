/**
 * Every per-rule handler field Oathkeeper v25.4.0 accepts (docs/research/oathkeeper-spec.md §11),
 * for the gate's Advanced panel. `level` is where the field shows: A = Advanced, E = Expert only.
 * `locked` fields are global-only (§13.18: introspection URL, caches, hydrator auth, id_token keys,
 * the permission service address) — shown with the reason, never editable per rule.
 */

export type FieldType = 'string' | 'list' | 'bool' | 'enum' | 'duration' | 'url' | 'kv' | 'template' | 'token_from' | 'when' | 'number';

export interface HandlerField {
  key: string;
  label: string;
  type: FieldType;
  level: 'A' | 'E';
  help?: string;
  options?: string[];
  placeholder?: string;
  locked?: string;
}

export type HandlerKind = 'authenticators' | 'authorizers' | 'mutators' | 'errors';

const DURATION = 'e.g. 1s, 100ms, 5m';
const SESSION: HandlerField[] = [
  { key: 'only', label: 'Session cookie names', type: 'list', level: 'E', help: 'Leave as is: the platform default is ory_kratos_session.' },
  { key: 'check_session_url', label: 'Session check address', type: 'url', level: 'E', placeholder: 'http://auth-kratos-public/sessions/whoami' },
  { key: 'preserve_path', label: 'Keep path when checking', type: 'bool', level: 'E' },
  { key: 'preserve_query', label: 'Keep query when checking', type: 'bool', level: 'E' },
  { key: 'preserve_host', label: 'Keep host when checking', type: 'bool', level: 'E' },
  { key: 'force_method', label: 'Force method', type: 'enum', level: 'E', options: ['GET', 'POST', 'HEAD'] },
  { key: 'forward_http_headers', label: 'Forward headers to the check', type: 'list', level: 'E', help: 'Header names only — no secrets.' },
  { key: 'additional_headers', label: 'Extra headers to the check', type: 'kv', level: 'E', help: 'name = value; values that look like secrets are refused.' },
  { key: 'subject_from', label: 'User id field', type: 'string', level: 'E', placeholder: 'identity.id' },
  { key: 'extra_from', label: 'Extra info field', type: 'string', level: 'E', placeholder: '@this' },
];

export const HANDLER_FIELDS: Record<HandlerKind, Record<string, HandlerField[]>> = {
  authenticators: {
    cookie_session: SESSION,
    bearer_token: [
      { key: 'token_from', label: 'Where the token is sent', type: 'token_from', level: 'A', help: 'A header other than Authorization is forwarded to the session check automatically.' },
      { key: 'prefix', label: 'Only tokens starting with', type: 'string', level: 'A', placeholder: 'ory_st_' },
      ...SESSION.filter((f) => f.key !== 'only'),
    ],
    oauth2_introspection: [
      { key: 'required_scope', label: 'Required permissions (scopes)', type: 'list', level: 'A' },
      { key: 'target_audience', label: 'Token must be issued for', type: 'list', level: 'A' },
      { key: 'trusted_issuers', label: 'Trusted token issuers', type: 'list', level: 'A' },
      { key: 'scope_strategy', label: 'Scope matching', type: 'enum', level: 'A', options: ['exact', 'hierarchic', 'wildcard', 'none'], help: 'exact = must match exactly; hierarchic = a grants a.b' },
      { key: 'token_from', label: 'Where the token is sent', type: 'token_from', level: 'E' },
      { key: 'prefix', label: 'Only tokens starting with', type: 'string', level: 'E' },
      { key: 'preserve_host', label: 'Keep host', type: 'bool', level: 'E' },
      { key: 'introspection_request_headers', label: 'Headers to the introspection call', type: 'kv', level: 'E' },
      { key: 'retry.give_up_after', label: 'Give up after', type: 'duration', level: 'E', placeholder: DURATION },
      { key: 'retry.max_delay', label: 'Max delay', type: 'duration', level: 'E', placeholder: DURATION },
      { key: 'introspection_url', label: 'Introspection address', type: 'url', level: 'E', locked: 'Global only: the gateway caches per URL; a per-rule value would bypass the cache and leak tokens elsewhere.' },
      { key: 'cache', label: 'Cache', type: 'string', level: 'E', locked: 'Global only.' },
      { key: 'pre_authorization', label: 'Client credentials for introspection', type: 'string', level: 'E', locked: 'Global only (it holds a secret).' },
    ],
    jwt: [
      { key: 'jwks_urls', label: 'Key set addresses', type: 'list', level: 'A' },
      { key: 'trusted_issuers', label: 'Trusted issuers', type: 'list', level: 'A' },
      { key: 'target_audience', label: 'Audience', type: 'list', level: 'A' },
      { key: 'required_scope', label: 'Required scopes', type: 'list', level: 'A', help: 'Needs a scope strategy other than none.' },
      { key: 'scope_strategy', label: 'Scope matching', type: 'enum', level: 'A', options: ['none', 'exact', 'hierarchic', 'wildcard'] },
      { key: 'allowed_algorithms', label: 'Allowed algorithms', type: 'list', level: 'E', placeholder: 'RS256' },
      { key: 'jwks_ttl', label: 'Key set cache', type: 'duration', level: 'E', placeholder: '30s' },
      { key: 'jwks_max_wait', label: 'Key set max wait', type: 'duration', level: 'E', placeholder: '1s' },
      { key: 'token_from', label: 'Where the token is sent', type: 'token_from', level: 'E' },
    ],
    oauth2_client_credentials: [
      { key: 'required_scope', label: 'Required scopes', type: 'list', level: 'A' },
      { key: 'token_url', label: 'Token address', type: 'url', level: 'E', locked: 'Global only.' },
      { key: 'cache', label: 'Cache', type: 'string', level: 'E', locked: 'Global only.' },
    ],
    anonymous: [{ key: 'subject', label: 'Name for visitors', type: 'string', level: 'A', placeholder: 'anonymous' }],
    noop: [],
    unauthorized: [],
  },
  authorizers: {
    remote_json: [
      { key: 'forward_response_headers_to_upstream', label: 'Pass decision headers to the service', type: 'list', level: 'A', placeholder: 'X-User-Groups' },
      { key: 'payload', label: 'Decision request', type: 'template', level: 'E', help: 'Generated with "app" pinned to this site; overriding it is not accepted yet.', locked: 'Generated by the platform (it pins the site and forwards sign-in strength).' },
      { key: 'headers', label: 'Headers to the permission service', type: 'kv', level: 'E' },
      { key: 'retry.give_up_after', label: 'Give up after', type: 'duration', level: 'E', placeholder: '1s' },
      { key: 'retry.max_delay', label: 'Max delay', type: 'duration', level: 'E', placeholder: '100ms' },
      { key: 'remote', label: 'Permission service', type: 'url', level: 'E', locked: 'Platform-locked: every site asks the same policy engine.' },
    ],
    remote: [
      { key: 'remote', label: 'Policy service', type: 'url', level: 'E' },
      { key: 'headers', label: 'Headers', type: 'kv', level: 'E' },
      { key: 'forward_response_headers_to_upstream', label: 'Pass decision headers', type: 'list', level: 'E' },
    ],
    allow: [],
    deny: [],
  },
  mutators: {
    header: [{ key: 'headers', label: 'Extra headers', type: 'kv', level: 'A', help: 'Added to the platform identity headers (X-User-Id, X-User-Email …), which cannot be removed.' }],
    hydrator: [
      { key: 'api.url', label: 'Enrichment service', type: 'url', level: 'E' },
      { key: 'cache.enabled', label: 'Cache', type: 'bool', level: 'E' },
      { key: 'cache.ttl', label: 'Cache for', type: 'duration', level: 'E', placeholder: '60s' },
      { key: 'api.retry.give_up_after', label: 'Give up after', type: 'duration', level: 'E', placeholder: '1s' },
      { key: 'api.retry.max_delay', label: 'Max delay', type: 'duration', level: 'E', placeholder: '100ms' },
      { key: 'api.auth', label: 'Credentials', type: 'string', level: 'E', locked: 'Never per rule (it holds a secret).' },
    ],
    cookie: [{ key: 'cookies', label: 'Cookies', type: 'kv', level: 'E' }],
    id_token: [
      { key: 'claims', label: 'Signed token claims', type: 'template', level: 'E' },
      { key: 'ttl', label: 'Token lifetime', type: 'duration', level: 'A', placeholder: '15m' },
      { key: 'issuer_url', label: 'Issuer', type: 'url', level: 'E', locked: 'Global only.' },
      { key: 'jwks_url', label: 'Signing keys', type: 'url', level: 'E', locked: 'Global only.' },
    ],
    noop: [],
  },
  errors: {
    redirect: [
      { key: 'to', label: 'Send visitors to', type: 'url', level: 'A', help: 'Absolute https:// or a path on the platform.' },
      { key: 'return_to_query_param', label: 'Remember where they were going in', type: 'string', level: 'A', placeholder: 'return_to' },
      { key: 'code', label: 'Redirect type', type: 'enum', level: 'E', options: ['302', '301'] },
      { key: 'when', label: 'When', type: 'when', level: 'A' },
    ],
    json: [
      { key: 'verbose', label: 'Show error details (debug only)', type: 'bool', level: 'A' },
      { key: 'when', label: 'When', type: 'when', level: 'E' },
    ],
    www_authenticate: [
      { key: 'realm', label: 'Browser login prompt text', type: 'string', level: 'A', placeholder: 'Please authenticate.' },
      { key: 'when', label: 'When', type: 'when', level: 'E' },
    ],
  },
};

export const HANDLER_LABEL: Record<string, string> = {
  cookie_session: 'Session cookie', bearer_token: 'Session token', oauth2_introspection: 'OAuth2 token (introspection)', noop: 'Anyone (no check)',
  jwt: 'JWT', anonymous: 'Optional sign-in', oauth2_client_credentials: 'Client id + secret', unauthorized: 'Always refuse',
  remote_json: 'Check permissions', allow: 'Allow', deny: 'Deny', remote: 'Remote policy (request body)',
  header: 'Identity headers', hydrator: 'Enrich from an API', cookie: 'Cookies', id_token: 'Signed ID token',
  redirect: 'Redirect', json: 'JSON error', www_authenticate: 'Browser login prompt',
};

export const ERROR_NAMES = ['unauthorized', 'forbidden', 'not_found', 'internal_server_error'] as const;

/** Read a dotted key (`retry.max_delay`) from a handler config. */
export function getPath(config: Record<string, unknown> | undefined, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), config);
}

/** Write a dotted key; an empty value removes it, and empty parents with it. */
export function setPath(config: Record<string, unknown> | undefined, key: string, value: unknown): Record<string, unknown> | undefined {
  const [head, ...rest] = key.split('.');
  const out: Record<string, unknown> = { ...(config ?? {}) };
  const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0) || (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
  if (rest.length === 0) {
    if (empty) delete out[head]; else out[head] = value;
  } else {
    const child = setPath(out[head] as Record<string, unknown> | undefined, rest.join('.'), value);
    if (child) out[head] = child; else delete out[head];
  }
  return Object.keys(out).length ? out : undefined;
}

export const isDuration = (v: string) => /^[0-9]+(ns|us|µs|ms|s|m|h)$/.test(v);
