import type { LookupHit } from '../api/client';

/**
 * Finding a person by what somebody has at hand: an address, the start of one, or the Kratos
 * identity id another system logged. The lookup itself is jinbe's (one bounded Kratos query per
 * term); this decides when a term is worth sending and how a hit reads.
 */

const KRATOS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Kratos identity id, as pasted — surrounding spaces forgiven. */
export function isKratosId(s: string): boolean {
  return KRATOS_ID.test(s.trim());
}

/** A whole address, as the checker needs it. Mirrors the checker's own validation. */
export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(s.trim());
}

/**
 * The term to look up, or null when there is nothing worth asking yet: one letter matches half
 * the directory and tells nobody anything, so the box waits for two.
 */
export function lookupTerm(q: string): string | null {
  const t = q.trim();
  if (isKratosId(t)) return t.toLowerCase();
  return t.length >= 2 ? t : null;
}

/** A hit in one line, for the option's accessible name and a title. */
export function describeHit(h: LookupHit): string {
  const who = h.name ? `${h.name} <${h.email}>` : h.email;
  const parts = [who];
  if (!h.active) parts.push('inactive');
  if (h.groups) parts.push(h.groups.length ? `groups: ${h.groups.join(', ')}` : 'no groups');
  if (h.mfa === true) parts.push('2FA on');
  if (h.mfa === false) parts.push('2FA off');
  return parts.join(' · ');
}

/**
 * The person a checker link names (`?user=<id|email>`, or the older `?email=`): an address is
 * usable as it is, an id has to be looked up first.
 */
export function linkedPerson(q: Record<string, string> | undefined): { email: string; id: string | null } {
  const user = (q?.user ?? '').trim();
  if (user && isKratosId(user)) return { email: '', id: user.toLowerCase() };
  return { email: user || (q?.email ?? ''), id: null };
}
