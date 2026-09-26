import { describe, it, expect } from 'vitest';
import {
  EVERYTHING,
  diffGroupSites,
  diffRoles,
  effectiveAccess,
  groupsUsingRole,
  isOrgGrantable,
  membersOf,
  permissionCatalogue,
  permissionOverview,
  removeRoleFromGroups,
  renameRoleInGroups,
  validateGroupName,
  validateRoleName,
  administersPlatform,
  groupOutcome,
  siteChain,
  type RbacUser,
} from './rbacEdit';
import type { GroupsMap, RouteEntry } from '../api/types';

const groups: GroupsMap = {
  super_admins: { global: ['super_admin'], kuma: ['admin'] },
  'kuma-viewer': { kuma: ['viewer'] },
  'kuma-admin': { kuma: ['admin'] },
  editors: { jinbe: ['editor', 'viewer'] },
  users: {},
};

const users: RbacUser[] = [
  { email: 'a@x', groupMembership: { super_admins: true, 'kuma-viewer': false } },
  { email: 'b@x', groupMembership: { 'kuma-viewer': true, 'kuma-admin': true } },
  { email: 'c@x', groupMembership: { 'kuma-admin': true } },
];

describe('groupsUsingRole', () => {
  it('lists the groups that give a role on one site only', () => {
    expect(groupsUsingRole(groups, 'kuma', 'admin')).toEqual(['kuma-admin', 'super_admins']);
    expect(groupsUsingRole(groups, 'jinbe', 'admin')).toEqual([]);
  });
});

describe('membersOf', () => {
  it('counts each person once across several groups', () => {
    expect(membersOf(users, ['kuma-viewer', 'kuma-admin']).map(u => u.email)).toEqual(['b@x', 'c@x']);
  });
  it('ignores memberships marked false', () => {
    expect(membersOf(users, ['kuma-viewer']).map(u => u.email)).toEqual(['b@x']);
  });
});

describe('renameRoleInGroups', () => {
  it('returns only the groups that change, with the new name in place', () => {
    expect(renameRoleInGroups(groups, 'kuma', 'admin', 'owner')).toEqual({
      super_admins: { global: ['super_admin'], kuma: ['owner'] },
      'kuma-admin': { kuma: ['owner'] },
    });
  });
  it('does not duplicate a role the group already has', () => {
    expect(renameRoleInGroups({ g: { s: ['a', 'b'] } }, 's', 'a', 'b')).toEqual({ g: { s: ['b'] } });
  });
});

describe('removeRoleFromGroups', () => {
  it('drops the role and the site entry when it was the last role there', () => {
    expect(removeRoleFromGroups(groups, 'kuma', 'viewer')).toEqual({ 'kuma-viewer': {} });
    expect(removeRoleFromGroups(groups, 'jinbe', 'viewer')).toEqual({ editors: { jinbe: ['editor'] } });
  });
});

describe('validateRoleName', () => {
  it('refuses empty, taken and badly spelt names', () => {
    expect(validateRoleName('', ['admin'])).toMatch(/name/i);
    expect(validateRoleName('admin', ['admin'])).toMatch(/already/);
    expect(validateRoleName('Bad Name', [])).toMatch(/lowercase/);
    expect(validateRoleName('payroll-editor', ['admin'])).toBeNull();
    expect(validateRoleName('org_admin', [])).toBeNull();
  });
  it('lets a role keep its own name', () => {
    expect(validateRoleName('admin', ['admin', 'viewer'], 'admin')).toBeNull();
  });
});

describe('validateGroupName', () => {
  it('follows what jinbe accepts on create', () => {
    expect(validateGroupName('payroll_editors', [])).toBeNull();
    expect(validateGroupName('payroll-editors', [])).toMatch(/lowercase/);
    expect(validateGroupName('users', ['users'])).toMatch(/already/);
  });
});

describe('permissionCatalogue', () => {
  it('merges route, role and known permissions without the wildcard, sorted', () => {
    const routes: RouteEntry[] = [
      { method: 'GET', path: '/a', permission: 'a:read' },
      { method: 'GET', path: '/h' },
    ];
    expect(permissionCatalogue(routes, { admin: ['*'], ed: ['b:write', 'a:read'] }, ['c:list', '*'])).toEqual([
      'a:read', 'b:write', 'c:list',
    ]);
  });
});

describe('diffRoles', () => {
  it('names added, removed and changed roles with their permission deltas', () => {
    const d = diffRoles(
      { admin: ['*'], viewer: ['read'], old: ['x'] },
      { admin: ['*'], viewer: ['read', 'list'], fresh: ['y'] },
    );
    expect(d.added).toEqual(['fresh']);
    expect(d.removed).toEqual(['old']);
    expect(d.changed).toEqual([{ role: 'viewer', added: ['list'], removed: [] }]);
    expect(d.empty).toBe(false);
  });
  it('is empty when only the order differs', () => {
    expect(diffRoles({ a: ['x', 'y'] }, { a: ['y', 'x'] }).empty).toBe(true);
  });
});

describe('diffGroupSites', () => {
  it('reports roles gained and lost per site', () => {
    expect(diffGroupSites({ kuma: ['viewer'], jinbe: ['editor'] }, { kuma: ['admin'], global: ['admin'] })).toEqual([
      { site: 'global', added: ['admin'], removed: [] },
      { site: 'jinbe', added: [], removed: ['editor'] },
      { site: 'kuma', added: ['admin'], removed: ['viewer'] },
    ]);
  });
});

describe('isOrgGrantable', () => {
  const roles = { kuma: { admin: ['*'], viewer: ['read'] }, jinbe: { viewer: ['databases:read'] } };
  it('holds for one site, with roles, none of them everything', () => {
    expect(isOrgGrantable({ kuma: ['viewer'] }, roles)).toEqual({ ok: true, reasons: [] });
  });
  it('explains each failed check', () => {
    expect(isOrgGrantable({ kuma: ['admin'] }, roles).reasons).toEqual(['gives everything on kuma']);
    expect(isOrgGrantable({ kuma: ['viewer'], jinbe: ['viewer'] }, roles).reasons).toEqual(['spans 2 sites']);
    expect(isOrgGrantable({}, roles).reasons).toEqual(['gives no role']);
  });
  it('does not claim yes when the site roles could not be read', () => {
    expect(isOrgGrantable({ payroll: ['viewer'] }, roles).reasons).toEqual(['roles of payroll unknown']);
  });
});

describe('effectiveAccess', () => {
  it('resolves permissions per site and flags everything', () => {
    const roles = { kuma: { admin: ['*'], viewer: ['read'] }, jinbe: { viewer: ['b', 'a'], ed: ['a', 'c'] } };
    expect(effectiveAccess({ kuma: ['admin', 'viewer'], jinbe: ['viewer', 'ed', 'ghost'] }, roles)).toEqual([
      { site: 'jinbe', everything: false, permissions: ['a', 'b', 'c'], undefinedRoles: ['ghost'] },
      { site: 'kuma', everything: true, permissions: ['read'], undefinedRoles: [] },
    ]);
  });
});

describe('permissionOverview', () => {
  const routes: RouteEntry[] = [
    { method: 'GET', path: '/api/db', permission: 'db:read' },
    { method: 'POST', path: '/api/db', permission: 'db:write' },
    { method: 'GET', path: '/api/db/:id', permission: 'db:read' },
    { method: 'DELETE', path: '/api/db/:id', permission: 'db:delete' },
    { method: 'GET', path: '/health' },
  ];
  const roles = { admin: [EVERYTHING], editor: ['db:read', 'db:write', 'reports:run'], viewer: ['db:read'] };
  const siteGroups: GroupsMap = { admins: { s: ['admin'] }, devs: { s: ['editor'] }, other: { t: ['editor'] } };
  const o = permissionOverview('s', routes, roles, siteGroups);

  it('lists each permission a route needs with its routes, roles and groups', () => {
    const read = o.rows.find(r => r.permission === 'db:read')!;
    expect(read.routes).toHaveLength(2);
    expect(read.roles).toEqual(['admin', 'editor', 'viewer']);
    expect(read.groups).toEqual(['admins', 'devs']);
  });
  it('flags a permission only the everything role grants', () => {
    const del = o.rows.find(r => r.permission === 'db:delete')!;
    expect(del.roles).toEqual(['admin']);
    expect(del.onlyEverything).toBe(true);
  });
  it('counts routes needing no permission, and permissions no route needs', () => {
    expect(o.open).toHaveLength(1);
    expect(o.unused).toEqual([{ permission: 'reports:run', roles: ['editor'] }]);
  });
});

describe('administersPlatform', () => {
  const roles = { global: { super_admin: ['*'] }, kuma: { admin: ['*'], viewer: ['read'] }, payroll: { admin: ['*'] } };
  const system = new Set(['kuma']);
  it('holds for everything on global or on a system site', () => {
    expect(administersPlatform({ global: ['super_admin'] }, roles, system)).toBe(true);
    expect(administersPlatform({ kuma: ['admin'] }, roles, system)).toBe(true);
  });
  it('does not for a tenant site or a narrow role', () => {
    expect(administersPlatform({ payroll: ['admin'] }, roles, system)).toBe(false);
    expect(administersPlatform({ kuma: ['viewer'] }, roles, system)).toBe(false);
    expect(administersPlatform(undefined, roles, system)).toBe(false);
  });
});

describe('groupOutcome', () => {
  it('summarises a group per site, with site-qualified permissions', () => {
    const roles = { kuma: { admin: ['*'] }, jinbe: { viewer: ['db:read', 'db:list'] } };
    const o = groupOutcome({ kuma: ['admin'], jinbe: ['viewer', 'ghost'] }, roles);
    expect(o.summary).toBe('jinbe: viewer, ghost · kuma: admin (everything)');
    expect(o.permissions).toEqual(['jinbe:db:list', 'jinbe:db:read', 'kuma:*']);
    expect(o.unknownRoles).toEqual(['jinbe/ghost']);
    expect(groupOutcome(undefined, roles).summary).toBe('gives nothing');
  });
});

describe('siteChain', () => {
  it('walks group → site → role → permission → routes', () => {
    const groups = { devs: { jinbe: ['editor'] } };
    const roles = { jinbe: { editor: ['db:read', 'db:write'] } };
    const routes = { jinbe: [{ method: 'GET', path: '/db', permission: 'db:read' }, { method: 'GET', path: '/h' }] };
    const [b, missing] = siteChain(['devs', 'nope'], groups, roles, routes);
    expect(b.declared).toBe(true);
    expect(b.sites[0].site).toBe('jinbe');
    expect(b.sites[0].roles[0].permissions).toEqual([
      { permission: 'db:read', routes: [{ method: 'GET', path: '/db' }] },
      { permission: 'db:write', routes: [] },
    ]);
    expect(missing).toEqual({ group: 'nope', declared: false, sites: [] });
  });
  it('shows everything as one line covering every declared route', () => {
    const [b] = siteChain(['a'], { a: { k: ['admin'] } }, { k: { admin: ['*'] } }, { k: [{ method: 'GET', path: '/x', permission: 'x:read' }] });
    expect(b.sites[0].roles[0]).toEqual({ role: 'admin', known: true, everything: true, permissions: [] });
  });
});
