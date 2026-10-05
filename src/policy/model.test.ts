import { describe, it, expect } from 'vitest';
import { carries, holds, holdsAny, holdsIn, orgsWhere, resolveRoles } from './model';
import { ORG_PERMISSIONS, PERMISSIONS, PLATFORM_PERMISSIONS, isCatalogPermission } from './catalog';

describe('holds', () => {
  it('matches the exact catalogue name, from effective_permissions', () => {
    const s = { permissions: ['raw'], effective_permissions: ['users:verify'] };
    expect(holds(s, 'users:verify')).toBe(true);
    expect(holds(s, 'users:update_email')).toBe(false);
  });

  it('reads the raw list on a jinbe that does not send effective_permissions', () => {
    expect(holds({ permissions: ['users:read'] }, 'users:read')).toBe(true);
    expect(holds(undefined, 'users:read')).toBe(false);
  });

  it('gives a wildcard, a parent or a legacy name nothing', () => {
    expect(holds({ effective_permissions: ['*'] }, 'users:read')).toBe(false);
    expect(holds({ effective_permissions: ['groups:write'] }, 'groups.members:write')).toBe(false);
    expect(holds({ effective_permissions: ['admin:write'] }, 'users:update')).toBe(false);
  });

  it('holdsAny passes on an empty ask, else on one match', () => {
    expect(holdsAny(undefined, [])).toBe(true);
    expect(holdsAny({ effective_permissions: ['audit:read'] }, ['users:read', 'audit:read'])).toBe(true);
    expect(holdsAny({ effective_permissions: ['audit:read'] }, ['users:read'])).toBe(false);
  });
});

describe('org permissions', () => {
  const held = { o1: ['org.members:read', 'org.members:write'], o2: ['org.keys:read'] };

  it('are held in one organization only', () => {
    expect(holdsIn(held, 'o1', 'org.members:write')).toBe(true);
    expect(holdsIn(held, 'o2', 'org.members:write')).toBe(false);
    expect(holdsIn(held, '', 'org.members:read')).toBe(false);
    expect(holdsIn(undefined, 'o1', 'org.members:read')).toBe(false);
  });

  it('lists the organizations where one is held', () => {
    expect(orgsWhere(held, 'org.members:read')).toEqual(['o1']);
    expect(orgsWhere(held, 'org.keys:read')).toEqual(['o2']);
  });
});

describe('carries and resolveRoles', () => {
  it('carries is exact', () => {
    expect(carries(['sites:read'], 'sites:read')).toBe(true);
    expect(carries(['*'], 'sites:read')).toBe(false);
  });

  it('unions role permissions and names undefined roles', () => {
    const r = resolveRoles(['a', 'b', 'ghost'], { a: ['x:read', 'y:read'], b: ['x:read'] });
    expect(r.permissions).toEqual(['x:read', 'y:read']);
    expect(r.undefined).toEqual(['ghost']);
  });
});

describe('the catalogue snapshot', () => {
  it('holds leaves only: no wildcard, no legacy admin or org: names', () => {
    for (const p of PERMISSIONS) {
      expect(p).toMatch(/^[a-z][a-z0-9_.-]*:[a-z][a-z0-9_-]*$/);
      expect(p.startsWith('admin')).toBe(false);
      expect(p.startsWith('org:')).toBe(false);
    }
    expect(isCatalogPermission('*')).toBe(false);
  });

  it('keeps the two scopes apart: org.* is the org namespace, orgs:* the platform one', () => {
    expect(ORG_PERMISSIONS.every((p) => p.startsWith('org.'))).toBe(true);
    expect(PLATFORM_PERMISSIONS.some((p) => p.startsWith('org.'))).toBe(false);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });
});

describe('isStaff', () => {
  it('needs one platform permission; organization permissions alone are not staff', async () => {
    const { isStaff } = await import('./model');
    expect(isStaff({ effective_permissions: ['sites:read'] })).toBe(true);
    expect(isStaff({ effective_permissions: ['org.members:write', 'org.keys:read'] })).toBe(false);
    expect(isStaff({ effective_permissions: [] })).toBe(false);
    expect(isStaff(undefined)).toBe(false);
  });
});
