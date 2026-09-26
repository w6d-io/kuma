import { secretLooking } from './validate';
import type { Check, Gate, Handler } from './types';

/**
 * A gate's handler chain, checked the moment it changes (site-ux.md §12 "Gates"). Order rules and
 * secret-looking values; the `when` overlap and schema checks are the server's (gatekit).
 */

function scan(value: unknown, at: string, out: Check[]) {
  if (typeof value === 'string') {
    if (secretLooking(value)) out.push({ level: 'error', code: 'secret_in_rule', message: `${at}: that value looks like a secret. Gateway rules are readable inside the cluster — use platform settings for secrets.` });
  } else if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) scan(v, `${at}.${k}`, out);
}

export function gateChecks(gate: Gate): Check[] {
  const out: Check[] = [];
  const authn = gate.authenticators.map((h) => h.handler);
  const noop = authn.indexOf('noop');
  if (noop >= 0 && noop !== authn.length - 1) out.push({ level: 'error', code: 'noop_not_last', message: '“Anyone (no check)” must be the last sign-in method, or the only one.' });
  if (authn.length === 1 && authn[0] === 'noop' && gate.authorizer === 'policy') {
    out.push({ level: 'error', code: 'noop_with_policy', message: 'Anyone has no identity to check — pick Everyone or Nobody under “Who may pass”.' });
  }
  const intro = authn.indexOf('oauth2_introspection');
  const bearerAuth = gate.authenticators.findIndex((h) => h.handler === 'bearer_token' && !(h.config?.token_from as Record<string, unknown> | undefined));
  if (intro >= 0 && bearerAuth > intro) out.push({ level: 'warn', code: 'introspection_first', message: 'OAuth2 introspection reads Authorization; put it after methods that read other headers.' });
  const muts = gate.mutators.map((h) => h.handler);
  if (muts.includes('hydrator') && muts.includes('header') && muts.indexOf('hydrator') > muts.indexOf('header')) {
    out.push({ level: 'error', code: 'hydrator_order', message: 'Enrich (hydrator) must come before the identity headers.' });
  }
  if (muts.length === 1 && muts[0] === 'noop' && !authn.every((a) => a === 'noop')) {
    out.push({ level: 'warn', code: 'noop_mutator', message: 'The service receives no identity headers — it must not trust X-User-* headers from the request.' });
  }
  const jwt = gate.authenticators.find((h) => h.handler === 'jwt');
  if (jwt && (jwt.config?.required_scope as string[] | undefined)?.length && (jwt.config?.scope_strategy ?? 'none') === 'none') {
    out.push({ level: 'error', code: 'jwt_scope', message: 'JWT required scopes need a scope matching other than none.' });
  }
  const all: Handler[] = [...gate.authenticators, ...(typeof gate.authorizer === 'string' ? [] : [gate.authorizer]), ...gate.mutators, ...(Array.isArray(gate.errors) ? gate.errors : [])];
  all.forEach((h) => scan(h.config, h.handler, out));
  if (gate.expert?.matchUrl && /\?/.test(gate.expert.matchUrl.replace(/<[^>]*>/g, ''))) {
    out.push({ level: 'error', code: 'pattern_query', message: 'A match URL cannot contain a query string.' });
  }
  return out;
}

/** Move one handler in a chain (keyboard: Alt+↑/↓). */
export function moveHandler<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** The error presets written out, so Advanced can customize them. Same handlers render emits. */
export function explicitErrors(errors: Gate['errors']): Handler[] {
  if (errors === 'platform') return [];
  if (errors === 'website') return [{ handler: 'redirect' }, { handler: 'json' }];
  if (errors === 'api') return [{ handler: 'json' }];
  return errors;
}

/** Balanced `<…>` and none of the constructs Oathkeeper's regexp strategy breaks on (OK§3.1). */
export function patternShape(url: string): string | null {
  if (url.includes('(?<')) return 'Named groups and look-behind (?<…) are not supported.';
  let depth = 0;
  for (const ch of url) {
    if (ch === '<') { depth++; if (depth > 1) return 'A < inside a <…> group is not allowed.'; }
    if (ch === '>') { depth--; if (depth < 0) return 'A > without its <.'; }
  }
  if (depth !== 0) return 'A <…> group is not closed.';
  if (url.includes('**')) return '** is not valid here — use .* for “anything”.';
  if (!/^(https?|<https\?>|<https?\??>)/.test(url) && !url.startsWith('<')) return 'Start with a scheme (https://) or <https?>.';
  return null;
}
