/**
 * Individual access: a single role or a single permission given to ONE person, on the platform or
 * inside one organization, beside what their groups (or org roles) give. A reason and an expiry are
 * both optional; when an expiry passes the grant stops counting.
 *
 * Pure, so the drawer, the add flows, org user management and the review page say the same thing.
 */

import type { OrgPermission, PlatformPermission } from '../policy/catalog';

export type GrantKind = 'role' | 'permission';

/**
 * What lets somebody see, give or take individual access: users.grants:read / :write on the platform
 * (write needs a recent second factor), org.members:read / :write inside one organization. The holding
 * rule applies to every grant either way: nobody grants what they do not hold.
 */
export const GRANT_PERMISSION: PlatformPermission = 'users.grants:write';
export const GRANTS_READ_PERMISSION: PlatformPermission = 'users.grants:read';
export const ORG_GRANT_PERMISSION: OrgPermission = 'org.members:write';
export const ORG_GRANTS_READ_PERMISSION: OrgPermission = 'org.members:read';

/** What somebody asks for, before jinbe has stored it. */
export interface GrantDraft {
  /** `jinbe` for the platform's own, else the site's name. */
  service: string;
  kind: GrantKind;
  /** The role's name on that service, or the catalogue permission. */
  name: string;
  reason?: string;
  /** ISO; absent or null: never expires. */
  expiresAt?: string | null;
}

/** One stored grant, as jinbe answers it. */
export interface Grant extends GrantDraft {
  id: string;
  /** The organization it counts in; absent: the platform. */
  org?: string;
  grantedBy?: string;
  grantedAt?: string;
  /** False once it has expired: jinbe keeps it listed, marked, until somebody removes it. */
  active?: boolean;
}

/** A grant with the person holding it (the review page). */
export interface HeldGrant extends Grant {
  subject: { id: string; email?: string; name?: string };
}

// ── The picker's value: one string per choice, so a checklist can hold choices across services ──

const SEP = '|';

export function choiceKey(c: Pick<GrantDraft, 'service' | 'kind' | 'name'>): string {
  return [c.service, c.kind, c.name].join(SEP);
}

export function choiceOf(key: string): Pick<GrantDraft, 'service' | 'kind' | 'name'> | null {
  const [service, kind, ...rest] = key.split(SEP);
  const name = rest.join(SEP);
  if (!service || !name || (kind !== 'role' && kind !== 'permission')) return null;
  return { service, kind, name };
}

/** The drafts a set of picked choices makes, all carrying the same reason and expiry. */
export function draftsFrom(keys: readonly string[], reason: string, expiresAt: string | null): GrantDraft[] {
  const why = reason.trim();
  return keys.flatMap((k) => {
    const c = choiceOf(k);
    if (!c) return [];
    return [{ ...c, ...(why ? { reason: why } : {}), ...(expiresAt ? { expiresAt } : {}) }];
  });
}

/** `editor on payroll`, `permission users:read`: the grant in a few words. jinbe's own read plainly. */
export function grantLabel(g: Pick<GrantDraft, 'service' | 'kind' | 'name'>): string {
  const where = g.service === 'jinbe' ? '' : ` on ${g.service}`;
  return g.kind === 'role' ? `role ${g.name}${where}` : `${g.name}${where}`;
}

// ── Expiry ─────────────────────────────────────────────────────────────────────────────────────

export type ExpiryPreset = 'never' | '1d' | '1w' | '1m' | 'custom';

export const EXPIRY_PRESETS: { value: ExpiryPreset; label: string }[] = [
  { value: '1d', label: '1 day' },
  { value: '1w', label: '1 week' },
  { value: '1m', label: '1 month' },
  { value: 'custom', label: 'Custom' },
  { value: 'never', label: 'Never' },
];

const DAY = 86_400_000;

/**
 * When a choice ends, as ISO. `custom` reads a date (`YYYY-MM-DD`) as the end of that day, local
 * time; a date not in the future gives null with `invalid`, so the form can say so.
 */
export function expiryFrom(preset: ExpiryPreset, customDate = '', now = Date.now()): { expiresAt: string | null; invalid: boolean } {
  if (preset === 'never') return { expiresAt: null, invalid: false };
  if (preset === '1d') return { expiresAt: new Date(now + DAY).toISOString(), invalid: false };
  if (preset === '1w') return { expiresAt: new Date(now + 7 * DAY).toISOString(), invalid: false };
  if (preset === '1m') {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return { expiresAt: d.toISOString(), invalid: false };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(customDate);
  if (!m) return { expiresAt: null, invalid: true };
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return end.getTime() > now ? { expiresAt: end.toISOString(), invalid: false } : { expiresAt: null, invalid: true };
}

export type ExpiryTone = 'never' | 'expired' | 'soon' | 'ok';

/** How close an expiry is: past, within a day, later, or never. */
export function expiryTone(expiresAt: string | null | undefined, now = Date.now()): ExpiryTone {
  if (!expiresAt) return 'never';
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return 'never';
  if (at <= now) return 'expired';
  return at - now <= DAY ? 'soon' : 'ok';
}

/** "expires in 3 h", "expires in 5 days", "expired 2 days ago", "no expiry": a countdown in words. */
export function expiresInWords(expiresAt: string | null | undefined, now = Date.now()): string {
  if (!expiresAt) return 'no expiry';
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return 'no expiry';
  const span = Math.abs(at - now);
  const words =
    span < 3_600_000 ? `${Math.max(1, Math.round(span / 60_000))} min`
      : span < DAY ? `${Math.round(span / 3_600_000)} h`
        : `${Math.round(span / DAY)} day${Math.round(span / DAY) === 1 ? '' : 's'}`;
  return at <= now ? `expired ${words} ago` : `expires in ${words}`;
}

/** The review page's filters. */
export type GrantFilter = 'all' | 'expiring' | 'expired' | 'permanent' | 'no-reason';

export function matchesFilter(g: Grant, filter: GrantFilter, now = Date.now()): boolean {
  const tone = expiryTone(g.expiresAt, now);
  switch (filter) {
    case 'expiring': return tone === 'soon' || (tone === 'ok' && Date.parse(g.expiresAt!) - now <= 7 * DAY);
    case 'expired': return tone === 'expired';
    case 'permanent': return tone === 'never';
    case 'no-reason': return !g.reason?.trim();
    default: return true;
  }
}
