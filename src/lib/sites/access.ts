import type { Site } from './types';

/**
 * "Who can do what" on one site (site-ux.md §8.1), computed from the intent alone: role presets
 * expanded as jinbe expands them (rbac-defaults.ts), then groups × the permissions routes need.
 * The server-side matrix (`GET /sites/:name/access-matrix`, with people counts) supersedes this
 * when it exists; until then the cells are exact and only the counts are missing.
 */

export function presetRoles(name: string): Record<string, Record<string, string[]>> {
  const operator = [`${name}:list`, `${name}:read`, `${name}:create`, `${name}:update`, `${name}:delete`, `${name}:execute`];
  const editor = [`${name}:list`, `${name}:read`, `${name}:create`, `${name}:update`];
  const viewer = [`${name}:list`, `${name}:read`];
  return {
    standard: { admin: ['*'], editor, viewer },
    readonly: { viewer },
    operator: { admin: ['*'], operator, editor, viewer },
  };
}

export function expandRolePermissions(site: Pick<Site, 'name' | 'roles'>): Record<string, string[]> {
  return typeof site.roles === 'string' ? presetRoles(site.name)[site.roles] ?? {} : site.roles;
}

/** Whether held permissions cover one (`*` = everything on the site; `x:*` = every verb on x). */
export function covers(held: readonly string[], perm: string): boolean {
  if (held.includes('*') || held.includes(perm)) return true;
  const [res] = perm.split(':');
  return held.includes(`${res}:*`);
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
    ...Object.entries(site.groups.orgGrantable).map(([g, def]) => row('org-grant', g, `${def.label} (org-grantable)`, def.roles)),
    row('signed-in', 'any', 'Any signed-in person (no group)', []),
    row('anonymous', 'anonymous', 'Anonymous', []),
  ];
  const carried = Object.values(roles).flat();
  const unreachable = needed.filter((p) => !Object.values(roles).some((held) => covers(held, p)));
  const unused = [...new Set(carried)].filter((p) => p !== '*' && !needed.includes(p) && !p.endsWith(':list'));
  return { columns, rows, unreachable, unused };
}
