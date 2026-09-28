import { labelProblem } from './validate';
import type { Check, Site } from './types';

/**
 * Editing a site's address after it is live: label + zone (the host) and path prefix. Pure.
 *
 * Mirrors jinbe src/sites/address.ts: a sign-in landing page or sign-out link left on the old host
 * is moved to the same path under the new address, so the change never strands visitors there.
 */

export type Address = Site['address'];
export interface AddressForm { label: string; zone: string; pathPrefix: string }

export const addressUrl = (a: Address) => `https://${a.host}${a.pathPrefix ?? ''}/`;

export const sameAddress = (a: Address, b: Address) =>
  a.host.toLowerCase() === b.host.toLowerCase() && (a.pathPrefix ?? '') === (b.pathPrefix ?? '');

/** The form for an address: the most specific zone the host is one label under, else label + the rest. */
export function formOf(a: Address, zones: readonly string[]): AddressForm {
  const host = a.host.toLowerCase();
  const zone = [...zones].sort((x, y) => y.length - x.length).find((z) => host.endsWith(`.${z}`));
  const label = zone ? host.slice(0, -(zone.length + 1)) : host.split('.')[0];
  return { label, zone: zone ?? host.split('.').slice(1).join('.'), pathPrefix: a.pathPrefix ?? '' };
}

export const addressOf = (f: AddressForm): Address => ({ host: `${f.label}.${f.zone}`, ...(f.pathPrefix ? { pathPrefix: f.pathPrefix } : {}) });

/** Format only, as jinbe's schema; where the address may live is the preview's answer. */
export function formProblems(f: AddressForm): Partial<Record<keyof AddressForm, string>> {
  const out: Partial<Record<keyof AddressForm, string>> = {};
  const label = f.label ? labelProblem(f.label) : 'Needed.';
  if (label) out.label = label;
  if (!f.zone) out.zone = 'Pick a zone.';
  if (f.pathPrefix && !/^(\/[A-Za-z0-9._~@-]+)+$/.test(f.pathPrefix)) out.pathPrefix = 'A literal prefix like /payroll, or empty.';
  return out;
}

/** A URL on the old address, moved to the same path under the new one; null when it is elsewhere. */
export function movedUrl(raw: string, from: Address, to: Address): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.hostname.toLowerCase() !== from.host.toLowerCase()) return null;
  const oldPrefix = from.pathPrefix ?? '';
  const underOld = !oldPrefix || url.pathname === oldPrefix || url.pathname.startsWith(`${oldPrefix}/`);
  const rest = underOld ? url.pathname.slice(oldPrefix.length) : url.pathname;
  url.hostname = to.host;
  url.pathname = `${to.pathPrefix ?? ''}${rest || '/'}`;
  return url.toString();
}

/** The site's links that sit on the old address: what moving them would write. */
export function linksToMove(site: Site, to: Address): Array<{ field: 'defaultReturnUrl' | 'postLogoutUrl'; label: string; from: string; to: string }> {
  if (sameAddress(site.address, to)) return [];
  const out: ReturnType<typeof linksToMove> = [];
  const fields = [['defaultReturnUrl', 'Landing page after sign-in'], ['postLogoutUrl', 'Page after sign-out']] as const;
  for (const [field, label] of fields) {
    const raw = site.login?.[field];
    const next = raw ? movedUrl(raw, site.address, to) : null;
    if (raw && next && next !== raw) out.push({ field, label, from: raw, to: next });
  }
  return out;
}

/** The site with its new address, and its links on the old address moved along when asked. */
export function withAddress(site: Site, to: Address, moveLinks: boolean): Site {
  const next: Site = { ...site, address: to };
  const links = moveLinks ? linksToMove(site, to) : [];
  if (links.length > 0 && site.login) next.login = { ...site.login, ...Object.fromEntries(links.map((l) => [l.field, l.to])) };
  return next;
}

/** Checks grouped by severity, the address change itself first among the warnings. */
export function groupChecks(checks: readonly Check[]): { blocking: Check[]; warnings: Check[] } {
  const first = (c: Check) => (c.code === 'address_changed' ? 0 : 1);
  return {
    blocking: checks.filter((c) => c.level === 'error'),
    warnings: checks.filter((c) => c.level !== 'error').sort((a, b) => first(a) - first(b)),
  };
}
