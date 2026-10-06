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

/** What a key scope is: a permission (`resource:verb`), a site role (`role:<site>:<role>`) or a group (`group:<name>`). */
export type ScopeKind = 'permission' | 'role' | 'group';

/** One scope of an organization's catalogue: what it is, the sites it reaches, the permissions it stands for. */
export interface ScopeEntry {
  scope: string;
  kind: ScopeKind;
  sites: string[];
  /** For a role or a group: the permissions it carries today. */
  permissions: string[];
}

/** The kind a scope's shape says, when jinbe does not. */
export function scopeKindOf(scope: string): ScopeKind {
  if (scope.startsWith('role:')) return 'role';
  if (scope.startsWith('group:')) return 'group';
  return 'permission';
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * The catalogue as jinbe answers it — `{scope, kind, sites, permissions}` entries, or bare strings
 * from an older jinbe — as entries. Anything else is dropped rather than shown.
 */
export function normalizeCatalog(raw: unknown): ScopeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ScopeEntry[] = [];
  for (const item of raw) {
    if (typeof item === 'string') out.push({ scope: item, kind: scopeKindOf(item), sites: [], permissions: [] });
    else if (item && typeof item === 'object' && typeof (item as ScopeEntry).scope === 'string') {
      const { scope, kind, sites, permissions } = item as { scope: string; kind?: unknown; sites?: unknown; permissions?: unknown };
      out.push({
        scope,
        kind: kind === 'permission' || kind === 'role' || kind === 'group' ? kind : scopeKindOf(scope),
        sites: strings(sites),
        permissions: strings(permissions),
      });
    }
  }
  return out;
}

export const SCOPE_KIND_LABEL: Record<ScopeKind, string> = {
  permission: 'Permissions',
  role: 'Site roles',
  group: 'Groups',
};

/** The catalogue by kind, for the picker: permissions, then site roles, then groups; empty kinds left out. */
export function groupByKind(entries: readonly ScopeEntry[]): { kind: ScopeKind; entries: ScopeEntry[] }[] {
  return (['permission', 'role', 'group'] as const)
    .map((kind) => ({ kind, entries: entries.filter((e) => e.kind === kind) }))
    .filter((g) => g.entries.length > 0)
    .map((g) => ({ ...g, entries: g.kind === 'permission' ? sortScopes(g.entries.map((e) => e.scope)).map((s) => g.entries.find((e) => e.scope === s)!) : [...g.entries].sort((a, b) => a.scope.localeCompare(b.scope)) }));
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
 * What a scope lets a program do, for the picker. A permission: reading, or changing things (only the
 * verb is read; the platform decides what it really opens). A role or a group: where, and what it
 * carries today.
 */
export function scopeHint(entry: ScopeEntry | string): string {
  const e = typeof entry === 'string' ? { scope: entry, kind: scopeKindOf(entry), sites: [], permissions: [] } : entry;
  if (e.kind === 'permission') return READ_VERBS.test(e.scope) ? 'Read only' : 'Can change data';
  const where = e.sites.length ? `On ${e.sites.join(', ')}` : '';
  const what = e.permissions.length ? `${e.permissions.length} permission${e.permissions.length === 1 ? '' : 's'}: ${e.permissions.slice(0, 4).join(', ')}${e.permissions.length > 4 ? '…' : ''}` : 'No permission today';
  return where ? `${where} · ${what}` : what;
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

/**
 * Whether a signed-in app may still do the protected actions (publish, change an address, grant a
 * group) on the second factor proven at sign-in: until `until`, ended, or never allowed.
 */
export function protectedWindow(until: string | null | undefined, allowed: boolean | undefined, now: number = Date.now()): { state: 'on' | 'ended' | 'off'; until?: string } {
  if (allowed === false || !until) return { state: 'off' };
  const at = Date.parse(until);
  if (Number.isNaN(at)) return { state: 'off' };
  return at > now ? { state: 'on', until } : { state: 'ended', until };
}

/** "in 3 h", "in 40 min", "in 2 days": how long until a moment ahead. */
export function remainingLabel(at: string, now: number = Date.now()): string {
  const ms = Date.parse(at) - now;
  if (Number.isNaN(ms) || ms <= 0) return 'ended';
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}
