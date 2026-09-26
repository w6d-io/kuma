import type { GroupMapping, GroupsMap, RouteEntry } from '../api/types';

/**
 * Editing the site layer: roles per site, groups as sets of those roles.
 *
 * Pure, so every screen that changes a role or a group computes its impact the same way — which
 * groups a role sits in, who that reaches, what a rename or delete does to the groups holding it —
 * before anything is sent.
 */

/** The role permission that means "everything on this site" (not the org-scoped routes). */
export const EVERYTHING = '*';

export type SiteRoles = Record<string, string[]>;
export type RolesBySite = Record<string, SiteRoles>;

/** A person as `GET /admin/rbac/users` lists them. */
export interface RbacUser {
  email: string;
  name?: string;
  identityId?: string;
  groupMembership: Record<string, boolean>;
}

const uniqSorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

export function isEverything(perms: readonly string[] | undefined): boolean {
  return !!perms?.includes(EVERYTHING);
}

/** Groups that give `role` on `site`, sorted. */
export function groupsUsingRole(groups: GroupsMap, site: string, role: string): string[] {
  return Object.keys(groups).filter(g => groups[g]?.[site]?.includes(role)).sort();
}

/** The people in any of these groups, each once, in list order. */
export function membersOf<U extends Pick<RbacUser, 'groupMembership'>>(users: readonly U[], groupNames: readonly string[]): U[] {
  return users.filter(u => groupNames.some(g => u.groupMembership?.[g] === true));
}

/** The groups a rename changes, rewritten with the new role name. Unchanged groups are left out. */
export function renameRoleInGroups(groups: GroupsMap, site: string, from: string, to: string): GroupsMap {
  const out: GroupsMap = {};
  for (const g of groupsUsingRole(groups, site, from)) {
    const roles = [...new Set(groups[g][site].map(r => (r === from ? to : r)))];
    out[g] = { ...groups[g], [site]: roles };
  }
  return out;
}

/** The groups a delete changes, with the role taken out (and the site too, when it was the last). */
export function removeRoleFromGroups(groups: GroupsMap, site: string, role: string): GroupsMap {
  const out: GroupsMap = {};
  for (const g of groupsUsingRole(groups, site, role)) {
    const rest = groups[g][site].filter(r => r !== role);
    const next: GroupMapping = { ...groups[g] };
    if (rest.length) next[site] = rest;
    else delete next[site];
    out[g] = next;
  }
  return out;
}

const ROLE_NAME = /^[a-z][a-z0-9_-]*$/;
// jinbe's create schema: `^[a-z_]+$`. Mirrored so the form refuses what the API would.
const GROUP_NAME = /^[a-z_]+$/;

export function validateRoleName(name: string, existing: readonly string[], current?: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the role a name.';
  if (!ROLE_NAME.test(n)) return 'Use lowercase letters, digits, - and _, starting with a letter.';
  if (n !== current && existing.includes(n)) return `This site already has a role called ${n}.`;
  return null;
}

export function validateGroupName(name: string, existing: readonly string[]): string | null {
  const n = name.trim();
  if (!n) return 'Give the group a name.';
  if (!GROUP_NAME.test(n)) return 'Use lowercase letters and _ only.';
  if (existing.includes(n)) return `A group called ${n} already exists.`;
  return null;
}

/**
 * Every permission worth offering in a role editor: what the site's routes ask for, what its roles
 * already carry, and whatever else jinbe knows for the site. Never the wildcard — that one has its
 * own control.
 */
export function permissionCatalogue(routes: readonly RouteEntry[] | undefined, roles: SiteRoles | undefined, known: readonly string[] = []): string[] {
  const all = [
    ...(routes ?? []).map(r => r.permission).filter((p): p is string => !!p),
    ...Object.values(roles ?? {}).flat(),
    ...known,
  ];
  return uniqSorted(all.filter(p => p !== EVERYTHING));
}

export interface RolesDiff {
  added: string[];
  removed: string[];
  changed: { role: string; added: string[]; removed: string[] }[];
  empty: boolean;
}

export function diffRoles(before: SiteRoles, after: SiteRoles): RolesDiff {
  const added = Object.keys(after).filter(r => !(r in before)).sort();
  const removed = Object.keys(before).filter(r => !(r in after)).sort();
  const changed = Object.keys(after)
    .filter(r => r in before)
    .sort()
    .map(role => ({
      role,
      added: uniqSorted(after[role].filter(p => !before[role].includes(p))),
      removed: uniqSorted(before[role].filter(p => !after[role].includes(p))),
    }))
    .filter(c => c.added.length || c.removed.length);
  return { added, removed, changed, empty: !added.length && !removed.length && !changed.length };
}

export function diffGroupSites(before: GroupMapping, after: GroupMapping) {
  const sites = uniqSorted([...Object.keys(before), ...Object.keys(after)]);
  return sites
    .map(site => {
      const b = before[site] ?? [];
      const a = after[site] ?? [];
      return { site, added: a.filter(r => !b.includes(r)).sort(), removed: b.filter(r => !a.includes(r)).sort() };
    })
    .filter(d => d.added.length || d.removed.length);
}

/**
 * Whether an org admin could hand this group out inside their organisation: one site only, at least
 * one role, and no role that gives everything. Each failed check is named, so the screen can say why.
 */
export function isOrgGrantable(group: GroupMapping, roles: RolesBySite): { ok: boolean; reasons: string[] } {
  const sites = Object.keys(group).filter(s => group[s]?.length);
  const reasons: string[] = [];
  if (sites.length === 0) reasons.push('gives no role');
  else if (sites.length > 1) reasons.push(`spans ${sites.length} sites`);
  else if (!roles[sites[0]]) reasons.push(`roles of ${sites[0]} unknown`);
  else if (group[sites[0]].some(r => isEverything(roles[sites[0]][r]))) reasons.push(`gives everything on ${sites[0]}`);
  return { ok: reasons.length === 0, reasons };
}

export interface SiteAccess {
  site: string;
  everything: boolean;
  permissions: string[];
  /** Roles the group names that the site does not define: they give nothing. */
  undefinedRoles: string[];
}

/** What a group actually gives, per site, sorted by site. */
export function effectiveAccess(group: GroupMapping, roles: RolesBySite): SiteAccess[] {
  return Object.keys(group).sort().map(site => {
    const defined = roles[site] ?? {};
    const perms = group[site].flatMap(r => defined[r] ?? []);
    return {
      site,
      everything: perms.includes(EVERYTHING),
      permissions: uniqSorted(perms.filter(p => p !== EVERYTHING)),
      undefinedRoles: group[site].filter(r => !(r in defined)),
    };
  });
}

export interface PermissionRow {
  permission: string;
  routes: RouteEntry[];
  /** Roles on this site granting it, the everything role included. */
  roles: string[];
  /** Groups giving one of those roles on this site. */
  groups: string[];
  /** Only a role carrying everything grants it — nobody holds it on purpose. */
  onlyEverything: boolean;
}

/**
 * The granular view of one site: every permission its routes ask for, which routes, and which roles
 * and groups grant it. Plus the routes that need no permission and the permissions no route needs.
 */
export function permissionOverview(site: string, routes: readonly RouteEntry[], roles: SiteRoles, groups: GroupsMap) {
  const byPerm = new Map<string, RouteEntry[]>();
  const open: RouteEntry[] = [];
  for (const r of routes) {
    if (!r.permission) { open.push(r); continue; }
    byPerm.set(r.permission, [...(byPerm.get(r.permission) ?? []), r]);
  }
  const grants = (perm: string) => Object.keys(roles).filter(role => roles[role].includes(perm) || isEverything(roles[role])).sort();
  const rows: PermissionRow[] = [...byPerm.keys()].sort().map(permission => {
    const granting = grants(permission);
    return {
      permission,
      routes: byPerm.get(permission)!,
      roles: granting,
      groups: uniqSorted(granting.flatMap(role => groupsUsingRole(groups, site, role))),
      onlyEverything: granting.length > 0 && granting.every(role => isEverything(roles[role]) && !roles[role].includes(permission)),
    };
  });
  const needed = new Set(byPerm.keys());
  const unused = permissionCatalogue([], roles)
    .filter(p => !needed.has(p))
    .map(permission => ({ permission, roles: Object.keys(roles).filter(r => roles[r].includes(permission)).sort() }));
  return { rows, open, unused };
}

/**
 * Whether a group administers the platform: everything on `global` or on a system site (jinbe,
 * kuma). Handing one out is an escalation, so it is gated and flagged wherever groups are given.
 */
export function administersPlatform(group: GroupMapping | undefined, roles: RolesBySite, systemSites: ReadonlySet<string>): boolean {
  if (!group) return false;
  return effectiveAccess(group, roles).some(a => a.everything && (a.site === 'global' || systemSites.has(a.site)));
}

/** A group in one line, and every permission it gives qualified by its site (`jinbe:db:read`). */
export function groupOutcome(group: GroupMapping | undefined, roles: RolesBySite) {
  const access = effectiveAccess(group ?? {}, roles);
  const summary = access.length === 0 ? 'gives nothing' : Object.keys(group!).sort()
    .map(site => `${site}: ${group![site].join(', ')}${access.find(a => a.site === site)?.everything ? ' (everything)' : ''}`)
    .join(' · ');
  return {
    access,
    summary,
    permissions: access.flatMap(a => [...(a.everything ? [EVERYTHING] : []), ...a.permissions].map(p => `${a.site}:${p}`)).sort(),
    unknownRoles: access.flatMap(a => a.undefinedRoles.map(r => `${a.site}/${r}`)),
  };
}

export interface ChainBranch {
  group: string;
  declared: boolean;
  sites: {
    site: string;
    roles: {
      role: string;
      known: boolean;
      everything: boolean;
      permissions: { permission: string; routes: { method: string; path: string }[] }[];
    }[];
  }[];
}

/** Why a person has what they have: group → site → role → permission → the routes it opens. */
export function siteChain(userGroups: readonly string[], groups: GroupsMap, roles: RolesBySite, routeMaps: Record<string, readonly RouteEntry[]>): ChainBranch[] {
  return userGroups.map(group => {
    const def = groups[group];
    if (!def) return { group, declared: false, sites: [] };
    return {
      group,
      declared: true,
      sites: Object.keys(def).sort().filter(s => def[s].length).map(site => ({
        site,
        roles: def[site].map(role => {
          const perms = roles[site]?.[role];
          return {
            role,
            known: perms !== undefined,
            everything: isEverything(perms),
            permissions: (perms ?? []).filter(p => p !== EVERYTHING).map(permission => ({
              permission,
              routes: (routeMaps[site] ?? []).filter(r => r.permission === permission).map(r => ({ method: r.method, path: r.path })),
            })),
          };
        }),
      })),
    };
  });
}
