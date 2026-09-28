/** Scopes as typed — commas or spaces, duplicates dropped, order kept. */
export function parseScopes(input: string): string[] {
  return [...new Set(input.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * The scopes jinbe accepts, when a refused create said so in its details — the only source on a
 * jinbe that predates GET …/api-keys/scopes.
 */
export function allowedScopesFrom(err: unknown): string[] | null {
  const details = (err as { details?: { details?: { allowed_scopes?: unknown }; allowed_scopes?: unknown } } | null)?.details;
  const list = details?.details?.allowed_scopes ?? details?.allowed_scopes;
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : null;
}

/**
 * What a new key starts with: the first read-only scope of the catalogue, or nothing. Never a
 * scope the catalogue does not hold (the form used to start on `api:read`, which a catalogue of
 * `fleet:read, fleet:write` refuses).
 */
export function initialScopes(allowed: readonly string[]): string[] {
  const read = allowed.find((s) => /(^|:)read$/.test(s));
  return read ? [read] : [];
}

/** One scope of an organization's catalogue: a permission, and the sites whose routes require it. */
export interface ScopeEntry {
  scope: string;
  sites: string[];
}

/**
 * The catalogue as jinbe answers it — `{scope, sites}` entries, or bare strings from a jinbe that
 * predates the per-org catalogue — as entries. Anything else is dropped rather than shown.
 */
export function normalizeCatalog(raw: unknown): ScopeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ScopeEntry[] = [];
  for (const item of raw) {
    if (typeof item === 'string') out.push({ scope: item, sites: [] });
    else if (item && typeof item === 'object' && typeof (item as ScopeEntry).scope === 'string') {
      const sites = (item as { sites?: unknown }).sites;
      out.push({ scope: (item as ScopeEntry).scope, sites: Array.isArray(sites) ? sites.filter((x): x is string => typeof x === 'string') : [] });
    }
  }
  return out;
}

/**
 * The catalogue by site, for the picker: each site with the scopes its routes require, sites and
 * scopes in alphabetical order. A scope several sites require appears under each (one choice — the
 * scope opens its routes on all of them). Scopes with no site (older jinbe) come last, under `''`.
 */
export function groupBySite(entries: readonly ScopeEntry[]): { site: string; scopes: string[] }[] {
  const bySite = new Map<string, Set<string>>();
  for (const { scope, sites } of entries) {
    for (const site of sites.length > 0 ? sites : ['']) {
      const set = bySite.get(site) ?? new Set<string>();
      set.add(scope);
      bySite.set(site, set);
    }
  }
  return [...bySite.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([site, scopes]) => ({ site, scopes: sortScopes([...scopes]) }));
}

/** One permission a personal key may be narrowed to, and the resource it belongs to (`users`, `audit`). */
export interface PlatformScope {
  scope: string;
  group: string;
}

/** The resource a permission belongs to: what comes before its first `.` or `:`. */
export function scopeGroupOf(scope: string): string {
  return scope.split(/[.:]/)[0] ?? scope;
}

/** jinbe's `{scope, group}` list as entries; a missing group is read off the scope, anything else dropped. */
export function normalizePlatformScopes(raw: unknown): PlatformScope[] {
  if (!Array.isArray(raw)) return [];
  const out: PlatformScope[] = [];
  for (const item of raw) {
    const scope = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { scope?: unknown }).scope : undefined;
    if (typeof scope !== 'string' || !scope) continue;
    const group = item && typeof item === 'object' ? (item as { group?: unknown }).group : undefined;
    out.push({ scope, group: typeof group === 'string' && group ? group : scopeGroupOf(scope) });
  }
  return out;
}

const GROUP_LABELS: Record<string, string> = {
  admin: 'Administration',
  audit: 'Audit trail',
  users: 'Users',
  sessions: 'Sessions',
  org: 'Organizations',
};

/** A readable name for a permission's resource: known ones named, the rest capitalized. */
export function scopeGroupLabel(group: string): string {
  return GROUP_LABELS[group] ?? (group ? group[0].toUpperCase() + group.slice(1) : 'Other');
}

/** Expiry choices for an org key, in days; `null` = never expires. jinbe accepts at most 365. */
export const KEY_EXPIRY_CHOICES: readonly (number | null)[] = [30, 90, 365, null];

/** "in 12 days", "expired" — for the keys table. */
export function expiryLabel(expiresAt: string | null | undefined, now: number = Date.now()): string {
  if (!expiresAt) return 'Never';
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return '—';
  if (at <= now) return 'Expired';
  const days = Math.ceil((at - now) / 86_400_000);
  return days <= 1 ? 'in 1 day' : `in ${days} days`;
}

/** How soon a key stops working, for its tone in a table: past, within a week, later, or never. */
export function expiryState(expiresAt: string | null | undefined, now: number = Date.now()): 'never' | 'expired' | 'soon' | 'ok' | 'unknown' {
  if (expiresAt === undefined) return 'unknown';
  if (expiresAt === null || expiresAt === '') return 'never';
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return 'unknown';
  if (at <= now) return 'expired';
  return at - now <= 7 * 86_400_000 ? 'soon' : 'ok';
}

const READ_VERBS = /:(read|list|get|view)$/;

/**
 * What a scope lets a program do, in two words for the picker: reading, or changing things. Only the
 * verb is read; the platform decides what each permission really opens.
 */
export function scopeHint(scope: string): string {
  return READ_VERBS.test(scope) ? 'Read only' : 'Can change data';
}

/** Scopes by resource, reads before the rest — `fleet:read` right above `fleet:write`. */
export function sortScopes(scopes: readonly string[]): string[] {
  const res = (s: string) => s.slice(0, s.lastIndexOf(':'));
  return [...scopes].sort((a, b) => res(a).localeCompare(res(b)) || Number(!READ_VERBS.test(a)) - Number(!READ_VERBS.test(b)) || a.localeCompare(b));
}

/** Expiry choices for a personal key, in days: it always expires, 30 days at most (jinbe refuses more). */
export const PERSONAL_EXPIRY_CHOICES: readonly number[] = [1, 7, 30];
export const PERSONAL_EXPIRY_DEFAULT = 30;

/** The scope every personal key carries so the MCP server accepts it; not a permission, not shown as one. */
export const MCP_SCOPE = 'mcp';

/**
 * The MCP server a personal key is used with, from the deployment (MCP_SERVER_URL, envsubst like the
 * other runtime settings). Empty: the help panel shows a placeholder and says to ask for it.
 */
export function mcpServerUrl(): string {
  const v = (window as unknown as { __MCP_SERVER_URL__?: unknown }).__MCP_SERVER_URL__;
  return typeof v === 'string' && !v.startsWith('${') ? v.replace(/\/$/, '') : '';
}

/** Where the MCP server answers when the deployment has not said (MCP_SERVER_URL unset). */
export const MCP_URL_PLACEHOLDER = 'https://mcp.<your platform>/mcp';

/** The client configuration most MCP clients take: the server address, and the key as a bearer header. */
export function mcpConfig(url: string, key: string): string {
  return JSON.stringify({ mcpServers: { platform: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2);
}
