import type { FieldType } from '../sites/handlerFields';
import type { HandlerKind } from './types';

/**
 * Every Oathkeeper v25.4.0 handler and its GLOBAL config (docs/research/oathkeeper-spec.md §4–§7),
 * for the Gateway handlers page. Unlike the per-gate catalog (sites/handlerFields.ts) nothing here
 * is locked — this is where the platform-only values live — but secrets are only ever a Vault
 * reference, and `required` marks what Oathkeeper refuses to start without once the handler is on.
 *
 * Level: B = Basic (shown by default), A = Advanced, E = Expert.
 */

export interface GlobalField {
  key: string;
  label: string;
  type: FieldType | 'secret' | 'object';
  level: 'B' | 'A' | 'E';
  required?: boolean;
  help?: string;
  options?: string[];
  placeholder?: string;
}

export interface HandlerInfo {
  name: string;
  label: string;
  summary: string;
  fields: GlobalField[];
  /** Why this handler is risky or legacy — shown before enabling. */
  caution?: string;
}

const SESSION: GlobalField[] = [
  { key: 'check_session_url', label: 'Session check address', type: 'url', level: 'B', required: true, placeholder: 'http://auth-kratos-public/sessions/whoami' },
  { key: 'preserve_path', label: 'Keep path when checking', type: 'bool', level: 'A', help: 'Kratos needs this on.' },
  { key: 'preserve_query', label: 'Keep query when checking', type: 'bool', level: 'E' },
  { key: 'preserve_host', label: 'Send X-Forwarded-Host', type: 'bool', level: 'E' },
  { key: 'force_method', label: 'Force method', type: 'enum', level: 'E', options: ['GET', 'POST', 'HEAD'] },
  { key: 'forward_http_headers', label: 'Forward headers to the check', type: 'list', level: 'A' },
  { key: 'additional_headers', label: 'Extra headers to the check', type: 'kv', level: 'E', help: 'Static values only; secrets are refused.' },
  { key: 'subject_from', label: 'User id field (GJSON)', type: 'string', level: 'A', placeholder: 'identity.id' },
  { key: 'extra_from', label: 'Extra info field (GJSON)', type: 'string', level: 'A', placeholder: '@this' },
];
const RETRY = (prefix = 'retry'): GlobalField[] => [
  { key: `${prefix}.give_up_after`, label: 'Give up after', type: 'duration', level: 'E', placeholder: '1s' },
  { key: `${prefix}.max_delay`, label: 'Max delay', type: 'duration', level: 'E', placeholder: '100ms' },
];
const WHEN: GlobalField = { key: 'when', label: 'When (global fallback)', type: 'when', level: 'A', help: 'Used when a rule has no error handler of its own, or none of its handlers is responsible.' };

export const CATALOG: Record<HandlerKind, HandlerInfo[]> = {
  authenticators: [
    { name: 'cookie_session', label: 'Session cookie', summary: 'Signed-in people, by their Kratos session cookie.', fields: [
      ...SESSION,
      { key: 'only', label: 'Session cookie names', type: 'list', level: 'B', placeholder: 'ory_kratos_session', help: 'Empty means ANY cookie makes it responsible — a stray analytics cookie then gets a 401 instead of falling through.' },
    ] },
    { name: 'bearer_token', label: 'Session token', summary: 'Kratos session tokens from a header, a query parameter or a cookie.', fields: [
      ...SESSION,
      { key: 'token_from', label: 'Where the token is sent', type: 'token_from', level: 'A' },
      { key: 'prefix', label: 'Only tokens starting with', type: 'string', level: 'A', placeholder: 'ory_st_' },
    ] },
    { name: 'oauth2_introspection', label: 'OAuth2 token (introspection)', summary: 'Opaque OAuth2 access tokens, checked with Hydra.', fields: [
      { key: 'introspection_url', label: 'Introspection address', type: 'url', level: 'B', required: true, placeholder: 'http://auth-hydra-admin:4445/admin/oauth2/introspect' },
      { key: 'scope_strategy', label: 'Scope matching', type: 'enum', level: 'A', options: ['none', 'exact', 'hierarchic', 'wildcard'] },
      { key: 'required_scope', label: 'Required scopes', type: 'list', level: 'A' },
      { key: 'target_audience', label: 'Audience', type: 'list', level: 'A' },
      { key: 'trusted_issuers', label: 'Trusted issuers', type: 'list', level: 'A' },
      { key: 'token_from', label: 'Where the token is sent', type: 'token_from', level: 'E' },
      { key: 'introspection_request_headers', label: 'Headers to the introspection call', type: 'kv', level: 'E' },
      { key: 'pre_authorization.enabled', label: 'Authenticate to the introspection endpoint', type: 'bool', level: 'A' },
      { key: 'pre_authorization.client_id', label: 'Client id', type: 'string', level: 'A' },
      { key: 'pre_authorization.client_secret', label: 'Client secret', type: 'secret', level: 'A' },
      { key: 'pre_authorization.token_url', label: 'Token address', type: 'url', level: 'A' },
      { key: 'cache.enabled', label: 'Cache introspection results', type: 'bool', level: 'A', help: 'One process-wide cache keyed by token.' },
      { key: 'cache.ttl', label: 'Cache for', type: 'duration', level: 'A', placeholder: '60s' },
      ...RETRY(),
    ] },
    { name: 'jwt', label: 'JWT', summary: 'Signed JWT access tokens, verified against a key set.', fields: [
      { key: 'jwks_urls', label: 'Key set addresses', type: 'list', level: 'B', required: true, placeholder: 'http://auth-hydra-public:4444/.well-known/jwks.json' },
      { key: 'trusted_issuers', label: 'Trusted issuers', type: 'list', level: 'A' },
      { key: 'target_audience', label: 'Audience', type: 'list', level: 'A' },
      { key: 'scope_strategy', label: 'Scope matching', type: 'enum', level: 'A', options: ['none', 'exact', 'hierarchic', 'wildcard'] },
      { key: 'allowed_algorithms', label: 'Allowed algorithms', type: 'list', level: 'E', placeholder: 'RS256' },
      { key: 'jwks_ttl', label: 'Key set cache', type: 'duration', level: 'E', placeholder: '30s' },
      { key: 'jwks_max_wait', label: 'Key set max wait', type: 'duration', level: 'E', placeholder: '1s' },
      { key: 'token_from', label: 'Where the token is sent', type: 'token_from', level: 'E' },
    ] },
    { name: 'oauth2_client_credentials', label: 'Client id + secret', summary: 'Legacy Basic-auth clients: the gateway runs the client_credentials grant for them.', caution: 'The client secret travels on every request. Prefer introspection or JWT.', fields: [
      { key: 'token_url', label: 'Token address', type: 'url', level: 'B', required: true },
      { key: 'required_scope', label: 'Required scopes', type: 'list', level: 'A' },
      { key: 'cache.enabled', label: 'Cache tokens', type: 'bool', level: 'E' },
      ...RETRY(),
    ] },
    { name: 'anonymous', label: 'Optional sign-in', summary: 'Lets callers without credentials through as a named visitor.', fields: [
      { key: 'subject', label: 'Name for visitors', type: 'string', level: 'B', placeholder: 'anonymous' },
    ] },
    { name: 'noop', label: 'Anyone (no check)', summary: 'Always succeeds with no identity; the authorizer and mutators still run.', fields: [] },
    { name: 'unauthorized', label: 'Always refuse', summary: 'Always 401 — a terminator for chains.', fields: [] },
  ],
  authorizers: [
    { name: 'remote_json', label: 'Check permissions', summary: 'Asks the platform policy engine (OPA via opa-authz-proxy).', fields: [
      { key: 'remote', label: 'Permission service', type: 'url', level: 'B', required: true, placeholder: 'http://auth-opa-authz-proxy:8080/v1/data/rbac/decision' },
      { key: 'payload', label: 'Decision request (template)', type: 'template', level: 'E', required: true, help: 'Must render to JSON. Sites pin their own app on top of this.' },
      { key: 'headers', label: 'Headers', type: 'kv', level: 'E' },
      { key: 'forward_response_headers_to_upstream', label: 'Pass decision headers to the service', type: 'list', level: 'A', placeholder: 'X-User-Groups' },
      ...RETRY(),
    ] },
    { name: 'remote', label: 'Remote policy (request body)', summary: 'Streams the original request body to a content-aware policy service.', caution: 'jinbe cannot express this authorizer in sites yet.', fields: [
      { key: 'remote', label: 'Policy service', type: 'url', level: 'B', required: true },
      { key: 'headers', label: 'Headers', type: 'kv', level: 'A' },
      { key: 'forward_response_headers_to_upstream', label: 'Pass decision headers', type: 'list', level: 'A' },
      ...RETRY(),
    ] },
    { name: 'allow', label: 'Allow', summary: 'Everyone who got past sign-in.', fields: [] },
    { name: 'deny', label: 'Deny', summary: 'Always 403.', fields: [] },
    { name: 'keto_engine_acp_ory', label: 'Keto ACP (legacy)', summary: 'The pre-v0.5 Keto engine.', caution: 'Legacy — not offered to sites.', fields: [
      { key: 'base_url', label: 'Keto address', type: 'url', level: 'B', required: true },
      { key: 'required_action', label: 'Action (template)', type: 'template', level: 'A', required: true },
      { key: 'required_resource', label: 'Resource (template)', type: 'template', level: 'A', required: true },
      { key: 'flavor', label: 'Flavor', type: 'enum', level: 'E', options: ['regex', 'exact', 'glob'] },
    ] },
  ],
  mutators: [
    { name: 'header', label: 'Identity headers', summary: 'Headers the service receives (X-User-Id, X-User-Email …).', fields: [
      { key: 'headers', label: 'Headers (name → template)', type: 'kv', level: 'B', required: true, help: 'Sites add to these but cannot remove one. Names are case-insensitive: never define one twice.' },
    ] },
    { name: 'hydrator', label: 'Enrich from an API', summary: 'Sends the session (and request headers) to an API that returns an enriched session.', caution: 'The hydrator can inject any upstream header: treat it as trusted code.', fields: [
      { key: 'api.url', label: 'Enrichment service', type: 'url', level: 'B', required: true },
      { key: 'api.auth.basic.username', label: 'Username', type: 'string', level: 'A' },
      { key: 'api.auth.basic.password', label: 'Password', type: 'secret', level: 'A' },
      { key: 'cache.enabled', label: 'Cache', type: 'bool', level: 'A', help: 'Keyed by the whole session including headers — rarely hits.' },
      { key: 'cache.ttl', label: 'Cache for', type: 'duration', level: 'A', placeholder: '1m' },
      ...RETRY('api.retry'),
    ] },
    { name: 'cookie', label: 'Cookies', summary: 'Sets named cookies on the upstream request.', fields: [
      { key: 'cookies', label: 'Cookies (name → template)', type: 'kv', level: 'B', required: true },
    ] },
    { name: 'id_token', label: 'Signed ID token', summary: 'Signs a JWT and sends it as Authorization to the service.', caution: 'Needs a private key Secret mounted in the gateway pods.', fields: [
      { key: 'issuer_url', label: 'Issuer', type: 'string', level: 'B', required: true },
      { key: 'jwks_url', label: 'Signing keys (private)', type: 'secret', level: 'B', required: true, help: 'A Vault reference to the private key set.' },
      { key: 'ttl', label: 'Token lifetime', type: 'duration', level: 'A', placeholder: '15m' },
      { key: 'claims', label: 'Claims (template)', type: 'template', level: 'E' },
    ] },
    { name: 'noop', label: 'Nothing', summary: 'Client headers pass through unchanged.', fields: [] },
  ],
  errors: [
    { name: 'json', label: 'JSON error', summary: 'The error as JSON with the original status.', fields: [
      { key: 'verbose', label: 'Show error details (debug only)', type: 'bool', level: 'A', help: 'May leak internals.' },
      WHEN,
    ] },
    { name: 'redirect', label: 'Redirect', summary: 'Sends browsers to the sign-in page.', fields: [
      { key: 'to', label: 'Send visitors to', type: 'url', level: 'B', required: true },
      { key: 'return_to_query_param', label: 'Remember where they were going in', type: 'string', level: 'A', placeholder: 'return_to' },
      { key: 'code', label: 'Redirect type', type: 'enum', level: 'E', options: ['302', '301'] },
      WHEN,
    ] },
    { name: 'www_authenticate', label: 'Browser login prompt', summary: '401 with a Basic-auth prompt.', fields: [
      { key: 'realm', label: 'Prompt text', type: 'string', level: 'B', placeholder: 'Please authenticate.' },
      WHEN,
    ] },
  ],
};

export const KIND_LABEL: Record<HandlerKind, string> = {
  authenticators: 'Sign-in methods', authorizers: 'Permission checks', mutators: 'What services receive', errors: 'Error handlers',
};

export function handlerInfo(kind: HandlerKind, name: string): HandlerInfo {
  return CATALOG[kind].find((h) => h.name === name) ?? { name, label: name, summary: 'Not in kuma’s catalog; edit it as JSON.', fields: [] };
}
