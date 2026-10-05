import { covers, expandRolePermissions } from './access';
import { displayPath } from './paths';
import type { Access, Site, SiteSignUp } from './types';

/**
 * Public sign-up through a site (jinbe sites/signup), from the intent alone: the default when sign-up
 * is first set up, and "what can a user do" — every route and the catch-all, as one signed-up person
 * meets them with the sign-up roles.
 */

/** Closed, `user` when the site has it (the standard set), a personal org. Opening it is one switch. */
export function defaultSignUp(site: Pick<Site, 'name' | 'roles' | 'routes'>): SiteSignUp {
  const roles = Object.keys(expandRolePermissions(site));
  const role = roles.includes('user') ? 'user' : roles.includes('viewer') ? 'viewer' : roles.find((r) => r !== 'admin');
  return { mode: 'closed', domains: [], roles: role ? [role] : [], orgs: 'personal' };
}

export type Reach = 'everyone' | 'signed-in' | 'role' | 'no';

export interface ReachRow {
  id: string;
  label: string;
  reach: Reach;
  /** The permission the route asks, when it asks one. */
  permission?: string;
  /** The sign-up roles that carry it. */
  via: string[];
}

function reachOf(access: Access, held: Record<string, string[]>): Pick<ReachRow, 'reach' | 'permission' | 'via'> {
  switch (access.kind) {
    case 'public':
      return { reach: 'everyone', via: [] };
    case 'signed-in':
      return { reach: 'signed-in', via: [] };
    case 'permission': {
      const via = Object.entries(held).filter(([, perms]) => covers(perms, access.permission)).map(([r]) => r);
      return { reach: via.length ? 'role' : 'no', permission: access.permission, via };
    }
    default:
      return { reach: 'no', via: [] };
  }
}

export function signUpReach(site: Site, roles: readonly string[]): ReachRow[] {
  const all = expandRolePermissions(site);
  const held = Object.fromEntries(roles.filter((r) => all[r]).map((r) => [r, all[r]]));
  const rows: ReachRow[] = site.routes.items.map((r) => ({ id: r.id, label: `${r.methods.join(' ')} ${displayPath(r.path)}`, ...reachOf(r.access, held) }));
  rows.push({ id: 'catch-all', label: 'Everything else (catch-all)', ...reachOf(site.routes.catchAll.access, held) });
  return rows;
}

export const REACH_WORDS: Record<Reach, string> = {
  everyone: 'Anyone, even signed out',
  'signed-in': 'Any signed-in account',
  role: 'Yes, through',
  no: 'No',
};
