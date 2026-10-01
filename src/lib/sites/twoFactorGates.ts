import type { Access, Gate, Site } from './types';
import type { SiteSecondFactor } from '../twoFactor';

/**
 * A site's two-step sign-in bar is enforced by the policy engine, which only a gate whose "Who may
 * pass" is the policy (remote_json) asks. A gate that lets every signed-in person in (allow) — or
 * hands the decision elsewhere — skips the policy, so neither 2FA nor permissions are checked on its
 * routes, while the site still read as "2FA on every request". These are those gates.
 */

export interface TwoFactorBypass {
  gate: string;
  label: string;
  /** allow: every signed-in person passes; other: an authorizer that is not the policy. */
  reason: 'allow' | 'other';
}

/** Whether the site asks for a second factor anywhere (jinbe: a scope, or chosen routes). */
export function requiresTwoFactor(site: Partial<Pick<Site, 'login'>>): boolean {
  const tf = site.login?.twoFactor;
  if (!tf) return false;
  return tf.scope !== 'none' || (tf.routes?.length ?? 0) > 0;
}

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const guarded = (a: Access) => a.kind === 'signed-in' || a.kind === 'permission';

/**
 * Gates that serve a signed-in or permission route the 2FA applies to, without asking the policy —
 * jinbe's second_factor_not_enforced: 'all' every such route, 'writes' those with a write method plus
 * the catch-all, otherwise the chosen route ids ('catch-all' names the catch-all).
 */
export function twoFactorBypass(site: Partial<Pick<Site, 'login' | 'gates' | 'routes'>>): TwoFactorBypass[] {
  if (!requiresTwoFactor(site) || !site.gates || !site.routes) return [];
  const tf = site.login!.twoFactor;
  const chosen = new Set(tf.routes ?? []);
  const applies = (id: string, methods: readonly string[] | null) =>
    tf.scope === 'all' || chosen.has(id) || (tf.scope === 'writes' && (methods === null || methods.some((m) => WRITES.has(m))));
  const used = new Set<string>();
  for (const r of site.routes.items ?? []) {
    // No methods listed: every method, writes included.
    if (guarded(r.access) && applies(r.id, r.methods?.length ? r.methods : null)) used.add(r.gate);
  }
  const ca = site.routes.catchAll;
  if (ca && guarded(ca.access) && applies('catch-all', null)) used.add(ca.gate);
  return site.gates.filter((g) => used.has(g.id) && skipsPolicy(g)).map((g) => ({
    gate: g.id,
    label: g.label || g.id,
    reason: typeof g.authorizer !== 'string' && g.authorizer.handler === 'allow' ? 'allow' : 'other',
  }));
}

/** A gate whose "Who may pass" is neither the policy nor Nobody. */
export const skipsPolicy = (g: Gate) => g.authorizer !== 'policy' && !(typeof g.authorizer !== 'string' && g.authorizer.handler === 'deny');

/** "2FA set but NOT enforced (gate web lets every signed-in person in)". */
export function bypassSentence(b: readonly TwoFactorBypass[]): string {
  if (b.length === 0) return '';
  const first = b[0];
  const why = first.reason === 'allow' ? 'lets every signed-in person in' : 'does not ask the policy engine';
  const more = b.length > 1 ? ` and ${b.length - 1} more gate${b.length === 2 ? '' : 's'}` : '';
  return `2FA set but NOT enforced (gate ${first.label} ${why}${more})`;
}

/** A gate only anonymous callers pass (noop / anonymous alone): nothing to ask a second factor of. */
const publicOnly = (g: Gate) => g.authenticators.length > 0 && g.authenticators.every((a) => a.handler === 'noop' || a.handler === 'anonymous');

/**
 * Gates tab: on a site that requires 2FA, any gate people sign in through whose "Who may pass" is
 * not the policy — whether or not a route uses it yet.
 */
export function gateSkipsTwoFactor(site: Partial<Pick<Site, 'login'>>, gate: Gate): string | null {
  if (!requiresTwoFactor(site) || publicOnly(gate) || !skipsPolicy(gate)) return null;
  const who = typeof gate.authorizer !== 'string' && gate.authorizer.handler === 'allow' ? 'lets every signed-in person in' : 'does not ask the policy engine';
  return `This site requires 2FA, but this gate ${who}: neither 2FA nor permissions are checked on its routes.`;
}

/** The gate a finding is about: its `gates.N…` path, else the "gate 'X'" its fix names. */
export function gateOfFinding(site: Partial<Pick<Site, 'gates'>> | null | undefined, f: { path?: string; fix?: string; message?: string }): Gate | undefined {
  const n = /^gates\.(\d+)/.exec(f.path ?? '')?.[1];
  if (n != null) return site?.gates?.[Number(n)];
  const id = /gate '([^']+)'/.exec(`${f.fix ?? ''} ${f.message ?? ''}`)?.[1];
  return id ? site?.gates?.find((g) => g.id === id || g.label === id) : undefined;
}

/**
 * The gates to name: jinbe's answer when it gave one (`enforced` true / false), the site's own
 * reading otherwise (an older server, or null: it could not tell).
 */
export function resolveBypass(site: Partial<Pick<Site, 'login' | 'gates' | 'routes'>>, sf: SiteSecondFactor | null | undefined): TwoFactorBypass[] {
  const local = twoFactorBypass(site);
  if (sf?.enforced === true) return [];
  if (sf?.enforced !== false) return local;
  return (sf.notEnforcedOn ?? []).map((id) => local.find((b) => b.gate === id)
    ?? { gate: id, label: site.gates?.find((g) => g.id === id)?.label ?? id, reason: 'other' as const });
}
