import type { Access, HostAccessSummary, HostEntry, HostService } from './types';
import { INITIAL, WIZARD_STORE, type WizardState } from './wizard';

/**
 * Sites by address (Sites redesign, phase 1): how the address list and a host's page read the
 * grouped sites jinbe returns (GET /api/admin/sites/hosts). Nothing here changes a site.
 */

/** Hosts matching a search over the host, its services' paths, backends, site names and titles. */
export function filterHosts(hosts: readonly HostEntry[], search: string): HostEntry[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [...hosts];
  return hosts.filter((h) => h.host.includes(needle) || h.services.some((s) =>
    s.site.includes(needle)
    || s.displayName.toLowerCase().includes(needle)
    || (s.pathPrefix ?? '').toLowerCase().includes(needle)
    || (s.upstream ? `${s.upstream.service}.${s.upstream.namespace}`.includes(needle) : false)));
}

/** One host's access at a glance: how many services are public, signed-in only, permission-gated or take org keys. */
export function hostAccess(services: readonly HostService[]) {
  return {
    public: services.filter((s) => s.access.public).length,
    signedIn: services.filter((s) => s.access.signedIn).length,
    permission: services.filter((s) => s.access.permissions.length > 0).length,
    orgKeys: services.filter((s) => s.access.orgKeys).length,
  };
}

/** The flags a host row shows: backends shared with other sites, drafts waiting, apply requests waiting. */
export function hostFlags(h: HostEntry): string[] {
  const shared = h.services.filter((s) => s.sharedBackendWith.length > 0).length;
  return [
    shared > 0 && `${shared} shared backend${shared === 1 ? '' : 's'}`,
    h.counts.drafts > 0 && `${h.counts.drafts} draft${h.counts.drafts === 1 ? '' : 's'} waiting`,
    h.counts.pendingRequests > 0 && `${h.counts.pendingRequests} request${h.counts.pendingRequests === 1 ? '' : 's'} to apply`,
  ].filter((f): f is string => !!f);
}

export interface TreeRow<T extends HostService = HostService> { service: T; depth: number }

/** The services of a host as a tree in display order: each one under the service whose prefix encloses it. */
export function hostTree<T extends HostService>(services: readonly T[]): TreeRow<T>[] {
  const known = new Set(services.map((s) => s.site));
  const children = new Map<string | null, T[]>();
  for (const s of services) {
    const parent = s.parent && known.has(s.parent) ? s.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), s]);
  }
  const out: TreeRow<T>[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = [...(children.get(parent) ?? [])].sort((a, b) => (a.pathPrefix ?? '').localeCompare(b.pathPrefix ?? '') || a.site.localeCompare(b.site));
    for (const s of list) { out.push({ service: s, depth }); walk(s.site, depth + 1); }
  };
  walk(null, 0);
  return out;
}

export interface RewriteParts {
  /** The request path, split around the part the gateway removes. */
  before: string;
  stripped: string | null;
  after: string;
  /** The base path the gateway puts in front (upstream.path), when any. */
  added: string | null;
}

/** How the gateway turns a request path into the backend path: what it strips, what it adds. */
export function rewriteParts(path: string, upstream: HostService['upstream']): RewriteParts {
  const strip = upstream?.stripPath;
  const at = strip ? path.indexOf(strip) : -1;
  const parts = at < 0 || !strip
    ? { before: path, stripped: null, after: '' }
    : { before: path.slice(0, at), stripped: strip, after: path.slice(at + strip.length) };
  const added = upstream?.path ? upstream.path.replace(/\/+$/, '') : null;
  return { ...parts, added };
}

/** Who may reach a path, in words. */
export function accessWord(a: Access): string {
  switch (a.kind) {
    case 'public': return 'Anyone';
    case 'signed-in': return 'Any signed-in account';
    case 'permission': return a.permission;
    case 'deny': return 'Refused';
  }
}

/** A service's access summary as short chips. */
export function accessChips(a: HostAccessSummary): Array<{ tone: 'danger' | 'warning' | 'info' | 'accent'; word: string }> {
  return [
    a.public && { tone: 'danger' as const, word: 'public' },
    a.signedIn && { tone: 'warning' as const, word: 'signed in' },
    a.permissions.length > 0 && { tone: 'info' as const, word: a.permissions.length === 1 ? a.permissions[0] : `${a.permissions.length} permissions` },
    a.orgKeys && { tone: 'accent' as const, word: 'org keys' },
  ].filter((c): c is { tone: 'danger' | 'warning' | 'info' | 'accent'; word: string } => !!c);
}

/**
 * Prefills "Plug a site" for a new service on this host: the host split into its label and its zone
 * (the longest known zone suffix, else everything after the first label), and a path prefix to fill.
 * The wizard reads its answers from sessionStorage, so it opens on the address step with them.
 */
export function prefillWizardForHost(host: string, zones: readonly string[], storage: Pick<Storage, 'setItem'> | null = safeSession()): WizardState {
  const zone = [...zones].sort((a, b) => b.length - a.length).find((z) => host.endsWith(`.${z}`)) ?? host.slice(host.indexOf('.') + 1);
  const label = host.endsWith(`.${zone}`) ? host.slice(0, host.length - zone.length - 1) : host.split('.')[0];
  const state: WizardState = { ...INITIAL, label, zone, pathPrefix: '' };
  try { storage?.setItem(WIZARD_STORE, JSON.stringify(state)); } catch { /* private mode: the wizard starts empty */ }
  return state;
}

function safeSession(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}
