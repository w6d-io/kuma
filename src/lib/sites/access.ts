import type { Site } from './types';

/**
 * "Who can do what" on one site (site-ux.md §8.1), computed from the intent alone: role presets
 * expanded as jinbe expands them (rbac-defaults.ts: `admin` = every permission the routes declare plus
 * the operator set, never `*`), then groups and org roles × the permissions routes need. Exact names.
 * The server-side matrix (`GET /sites/:name/access-matrix`, with people counts) supersedes this
 * when it exists; until then the cells are exact and only the counts are missing.
 */

/** The permissions the site's routes ask for, the catch-all included: what `admin` carries. */
export function declaredPermissions(site: Pick<Site, 'routes'>): string[] {
  const out = new Set<string>();
  for (const r of site.routes.items) if (r.access.kind === 'permission') out.add(r.access.permission);
  if (site.routes.catchAll.access.kind === 'permission') out.add(site.routes.catchAll.access.permission);
  return [...out].sort();
}

export function presetRoles(name: string, declared: readonly string[] = []): Record<string, Record<string, string[]>> {
  const operator = [`${name}:list`, `${name}:read`, `${name}:create`, `${name}:update`, `${name}:delete`, `${name}:execute`];
  const editor = [`${name}:list`, `${name}:read`, `${name}:create`, `${name}:update`];
  const viewer = [`${name}:list`, `${name}:read`];
  const admin = [...new Set([...operator, ...declared])].sort();
  // `user`: somebody who uses the app (jinbe render.ts userRole) — what signed-up people get by default.
  const user = [`${name}:list`, `${name}:read`, `${name}:use`];
  return {
    standard: { admin, editor, viewer, user },
    readonly: { viewer },
    operator: { admin, operator, editor, viewer },
  };
}

export function expandRolePermissions(site: Pick<Site, 'name' | 'roles'> & { routes?: Site['routes'] }): Record<string, string[]> {
  return typeof site.roles === 'string' ? presetRoles(site.name, site.routes ? declaredPermissions({ routes: site.routes }) : [])[site.roles] ?? {} : site.roles;
}

/** A wildcard name (`*`, `resource:*`): never a permission — jinbe refuses it (`wildcard_permission`). */
export const isWildcard = (p: string) => p === '*' || p.endsWith(':*');

/** Whether held permissions carry one: the exact name, nothing else. */
export function covers(held: readonly string[], perm: string): boolean {
  return held.includes(perm);
}

export interface MatrixRow { kind: 'group' | 'org-grant' | 'signed-in' | 'anonymous'; id: string; label: string; roles: string[]; cells: Record<string, boolean> }
export interface Matrix { columns: string[]; rows: MatrixRow[]; unreachable: string[]; unused: string[] }

export const SIGNED_IN = 'Signed-in routes';
export const PUBLIC = 'Public routes';

export function accessMatrix(site: Site): Matrix {
  const roles = expandRolePermissions(site);
  const all = [...site.routes.items.map((r) => r.access), site.routes.catchAll.access];
  const needed = [...new Set(all.flatMap((a) => (a.kind === 'permission' ? [a.permission] : [])))].sort();
  const columns = [...needed, SIGNED_IN, PUBLIC];
  const row = (kind: MatrixRow['kind'], id: string, label: string, roleNames: string[]): MatrixRow => {
    const held = roleNames.flatMap((r) => roles[r] ?? []);
    const signedIn = kind !== 'anonymous';
    return {
      kind, id, label, roles: roleNames,
      cells: Object.fromEntries(columns.map((c) => [c, c === PUBLIC ? true : c === SIGNED_IN ? signedIn : signedIn && covers(held, c)])),
    };
  };
  const rows: MatrixRow[] = [
    ...Object.entries(site.groups.platform).map(([g, rs]) => row('group', g, `${g} → ${rs.join(', ')}`, rs)),
    ...Object.entries(site.groups.orgGrantable).map(([g, def]) => row('org-grant', g, `${def.label} (org role ${orgRoleName(site.name, g)}, per organization)`, def.roles)),
    row('signed-in', 'any', 'Any signed-in person (no group)', []),
    row('anonymous', 'anonymous', 'Anonymous', []),
  ];
  const carried = Object.values(roles).flat();
  const unreachable = needed.filter((p) => !Object.values(roles).some((held) => covers(held, p)));
  const unused = [...new Set(carried)].filter((p) => !needed.includes(p) && !p.endsWith(':list'));
  return { columns, rows, unreachable, unused };
}

/** `payroll-editors` → `editors`: the org role an org-grantable entry becomes (assigned as `payroll:editors`). */
export function orgRoleName(site: string, entry: string): string {
  return entry.startsWith(`${site}-`) ? entry.slice(site.length + 1) : entry;
}
