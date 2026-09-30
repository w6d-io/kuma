import type { DeletionRequest, EphemeralLimits, EphemeralView } from './types';

/**
 * Ephemeral sites and deletion requests, in words (wave 19). An ephemeral site is paused by jinbe when
 * its TTL passes — never deleted — and Extend moves the expiry to now + a TTL. A deletion is asked for
 * by anyone who may save a site and decided by somebody else holding sites:delete (four-eyes).
 */

/** jinbe's limits when the platform does not say: 1 hour to 7 days, 24 hours by default. */
export const EPHEMERAL_DEFAULTS: EphemeralLimits = { minSec: 3600, maxSec: 7 * 86_400, defaultSec: 86_400 };

const CHOICES = [3600, 4 * 3600, 12 * 3600, 86_400, 3 * 86_400, 7 * 86_400];

/** "1 hour", "12 hours", "1 day", "3 days". */
export function ttlWords(sec: number): string {
  if (sec % 86_400 === 0) return sec === 86_400 ? '1 day' : `${sec / 86_400} days`;
  const h = Math.round(sec / 3600);
  return h === 1 ? '1 hour' : `${h} hours`;
}

/** The TTLs offered, within the platform's limits, its default always among them. */
export function ttlChoices(limits: EphemeralLimits = EPHEMERAL_DEFAULTS): number[] {
  return [...new Set([...CHOICES.filter((s) => s >= limits.minSec && s <= limits.maxSec), limits.defaultSec])].sort((a, b) => a - b);
}

/** "3 h 20 min", "2 days 4 h", "12 min": how long is left, coarse enough to read at a glance. */
export function remaining(ms: number): string {
  const min = Math.max(0, Math.ceil(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} day${d === 1 ? '' : 's'} ${h % 24} h` : `${d} day${d === 1 ? '' : 's'}`;
}

export type ExpiryTone = 'ok' | 'soon' | 'expired';

/**
 * Where an ephemeral site stands: paused for its TTL, or how long until it is. Under an hour left
 * reads as soon. Recomputed from `expiresAt` so a countdown stays true between reads.
 */
export function expiryState(e: EphemeralView, now: number = Date.now()): { tone: ExpiryTone; label: string; detail: string } {
  const left = Date.parse(e.expiresAt) - now;
  if (e.expired || left <= 0) {
    return { tone: 'expired', label: 'Expired', detail: `Paused when its ${ttlWords(e.ttlSec)} ran out. Extend it, then resume it to serve it again.` };
  }
  return {
    tone: left <= 3_600_000 ? 'soon' : 'ok',
    label: `${remaining(left)} left`,
    detail: `Ephemeral: paused automatically at ${new Date(e.expiresAt).toLocaleString()}. Nothing is deleted.`,
  };
}

/** One line per step of a deletion request's trail, oldest first. */
export function deletionTrail(r: DeletionRequest): Array<{ id: string; label: string; at: string; detail?: string; state: 'done' | 'failed' | 'pending' }> {
  const out: ReturnType<typeof deletionTrail> = [
    { id: 'asked', label: `Asked by ${r.requestedBy}${r.requestedVia ? ' through a key' : ''}`, at: r.requestedAt, detail: r.reason ? `“${r.reason}”` : undefined, state: 'done' },
  ];
  if (r.state === 'pending') out.push({ id: 'waiting', label: 'Waiting for someone else holding sites:delete', at: '', state: 'pending' });
  else {
    const verb = r.state === 'approved' ? 'Approved and deleted' : r.state === 'rejected' ? 'Rejected' : 'Cancelled';
    out.push({ id: r.state, label: `${verb}${r.decidedBy ? ` by ${r.decidedBy}` : ''}`, at: r.decidedAt ?? '', detail: r.decisionReason ? `“${r.decisionReason}”` : undefined, state: r.state === 'approved' ? 'done' : 'failed' });
  }
  return out;
}

/**
 * Whether the caller asked for this request, so may not decide it: jinbe says so on the inbox
 * (`requestedByYou`); elsewhere the requester's address is compared with the caller's.
 */
export function askedByMe(r: DeletionRequest, me: { email?: string | null }): boolean {
  if (r.requestedByYou !== undefined) return r.requestedByYou;
  return !!me.email && r.requestedBy === me.email;
}

// The lifetime chosen for a new site, kept from the wizard to its first save (the draft cannot carry it).
const KEY = (name: string) => `kuma.sites.lifetime.${name}`;

export function rememberLifetime(name: string, ttl: number | null): void {
  try {
    if (ttl) sessionStorage.setItem(KEY(name), String(ttl));
    else sessionStorage.removeItem(KEY(name));
  } catch { /* private mode: the choice is asked again on Review */ }
}

export function rememberedLifetime(name: string): number | null {
  try {
    const n = Number(sessionStorage.getItem(KEY(name)));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
