import { describe, it, expect } from 'vitest';
import { accessMatrix, covers, expandRolePermissions, SIGNED_IN, PUBLIC } from './access';
import { buildSite, orgGrantableFor } from './templates';

const base = buildSite('api', { name: 'payroll', displayName: 'Payroll', host: 'payroll.dev.stairling.com', service: 's', namespace: 'n', port: 80 });

describe('roles', () => {
  it('expands presets like jinbe', () => {
    expect(expandRolePermissions(base).admin).toEqual(['*']);
    expect(expandRolePermissions({ name: 'p', roles: 'readonly' })).toEqual({ viewer: ['p:list', 'p:read'] });
  });
  it('covers * and resource wildcards', () => {
    expect(covers(['*'], 'a:read')).toBe(true);
    expect(covers(['a:*'], 'a:read')).toBe(true);
    expect(covers(['a:list'], 'a:read')).toBe(false);
  });
});

describe('accessMatrix', () => {
  const site = {
    ...base,
    routes: { ...base.routes, items: [...base.routes.items, { id: 'x', methods: ['POST' as const], path: '/run', gate: 'api', access: { kind: 'permission' as const, permission: 'reports:execute' } }] },
    groups: { platform: { admins: ['admin'], viewers: ['viewer'] }, orgGrantable: orgGrantableFor('payroll', 'Payroll') },
  };
  const m = accessMatrix(site);
  it('columns are the permissions routes need, then the two buckets', () => {
    expect(m.columns).toEqual(['payroll:read', 'reports:execute', SIGNED_IN, PUBLIC]);
  });
  it('fills cells per group, with the implicit populations', () => {
    const byId = Object.fromEntries(m.rows.map((r) => [r.id, r.cells]));
    expect(byId.admins['reports:execute']).toBe(true);
    expect(byId.viewers['payroll:read']).toBe(true);
    expect(byId.viewers['reports:execute']).toBe(false);
    expect(byId['payroll-editors']['payroll:read']).toBe(true);
    expect(byId.any[SIGNED_IN]).toBe(true);
    expect(byId.any['payroll:read']).toBe(false);
    expect(byId.anonymous[SIGNED_IN]).toBe(false);
    expect(byId.anonymous[PUBLIC]).toBe(true);
  });
  it('names permissions nobody can reach', () => {
    expect(accessMatrix({ ...site, roles: 'readonly' }).unreachable).toEqual(['reports:execute']);
  });
});
