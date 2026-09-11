import { describe, it, expect } from 'vitest';
import { scopesOf, grantsEveryOrganisation, resolveRoles, covers, permits, hierarchyOf, summarise, permissionChain } from './model';

// The screen this backs replaced one that read a catalogue from a database and laid it out as a
// column per SERVICE. These tests pin the shape the model actually has: a scope per ORGANISATION,
// with `*` a scope of its own rather than a fallback.

describe('the scopes a group grants in', () => {
  it('puts every-organisation first, ahead of the named ones', () => {
    // The widest grant is the one a reader must not miss under a list of identifiers.
    const scopes = scopesOf({ 'org-1': ['operator'], '*': ['platform-admin'] });
    expect(scopes.map(s => s.key)).toEqual(['*', 'org-1']);
    expect(scopes[0].everyOrganisation).toBe(true);
    expect(scopes[1].everyOrganisation).toBe(false);
  });

  it('keeps both when one group names an organisation AND every organisation', () => {
    // `*` is a second source, not a fallback for the absence of the other — dropping either would
    // understate what the group grants.
    const scopes = scopesOf({ '*': ['auditor'], 'org-1': ['operator'] });
    expect(scopes).toHaveLength(2);
    expect(scopes.flatMap(s => s.roles).sort()).toEqual(['auditor', 'operator']);
  });

  it('leaves out a scope that names no role', () => {
    expect(scopesOf({ 'org-1': [], 'org-2': ['operator'] }).map(s => s.key)).toEqual(['org-2']);
  });

  it('answers nothing for a group that grants nothing, and for one that is absent', () => {
    expect(scopesOf({})).toEqual([]);
    expect(scopesOf(undefined)).toEqual([]);
  });
});

describe('whether a group is a platform grant', () => {
  it('is one when it grants in every organisation', () => {
    expect(grantsEveryOrganisation({ '*': ['platform-admin'] })).toBe(true);
  });

  it('is not one when it only grants inside a named organisation', () => {
    // Scope is what separates the two now: the tree has no `*` permission to spot.
    expect(grantsEveryOrganisation({ 'd5c9806e': ['operator'] })).toBe(false);
  });

  it('is not one when the every-organisation entry names no role', () => {
    expect(grantsEveryOrganisation({ '*': [] })).toBe(false);
    expect(grantsEveryOrganisation(undefined)).toBe(false);
  });
});

describe('what a set of roles carries', () => {
  it('unions the permissions across roles, deduplicated and ordered', () => {
    const { permissions } = resolveRoles(['admin', 'auditor'], {
      admin: ['admin:write', 'admin:read'],
      auditor: ['admin:read'],
    });
    expect(permissions).toEqual(['admin:read', 'admin:write']);
  });

  it('names a role the catalogue does not define instead of rendering a blank', () => {
    // "Grants nothing" and "points at something missing" read the same as an empty list, and only
    // one of them is a model somebody should fix.
    const { permissions, undefined: missing } = resolveRoles(['ghost', 'auditor'], {
      auditor: ['admin:read'],
    });
    expect(missing).toEqual(['ghost']);
    expect(permissions).toEqual(['admin:read']);
  });

  it('carries nothing for no roles at all', () => {
    expect(resolveRoles([], { auditor: ['admin:read'] })).toEqual({
      permissions: [],
      undefined: [],
    });
  });
});

describe('whether a held permission covers a required one', () => {
  it('admits an ancestor of the required resource', () => {
    expect(covers('admin:write', 'admin.membership:write')).toBe(true);
    expect(covers('admin:write', 'admin.membership.bulk:write')).toBe(true);
  });

  it('admits the exact permission', () => {
    expect(covers('admin.membership:write', 'admin.membership:write')).toBe(true);
    expect(covers('context:read', 'context:read')).toBe(true);
  });

  it('refuses a descendant standing in for its ancestor', () => {
    expect(covers('admin.membership:write', 'admin:write')).toBe(false);
  });

  it('refuses a sibling', () => {
    expect(covers('admin.membership:write', 'admin.organisation:write')).toBe(false);
  });

  it('does not let one verb imply another', () => {
    // A role that reads and writes carries both — a line to read rather than a rule to remember.
    expect(covers('admin:write', 'admin.membership:read')).toBe(false);
    expect(covers('admin:read', 'admin:write')).toBe(false);
  });

  it('treats the dot as the boundary, not the string prefix', () => {
    expect(covers('admin.member:write', 'admin.membership:write')).toBe(false);
    expect(covers('context:read', 'contexts:read')).toBe(false);
  });

  it('gives no meaning to a wildcard, because the model defines none', () => {
    // The console used to pass its own checks on `*`, which no role carries any more.
    expect(covers('*', 'admin:read')).toBe(false);
  });
});

describe('what a set of held permissions admits', () => {
  it('admits when any one of them covers it', () => {
    expect(permits(['context:read', 'admin:write'], 'admin.membership:write')).toBe(true);
  });

  it('refuses an empty or absent set', () => {
    expect(permits([], 'admin:read')).toBe(false);
    expect(permits(undefined, 'admin:read')).toBe(false);
  });
});

describe('which group stands above which', () => {
  const ROLES = {
    'platform-admin': ['admin:read', 'admin:write'],
    'platform-auditor': ['admin:read'],
    'membership-admin': ['admin:read', 'admin.membership:write'],
    operator: ['context:read'],
  };
  const GROUPS = {
    'platform-admin': { '*': ['platform-admin'] },
    'platform-auditor': { '*': ['platform-auditor'] },
    'membership-admin': { '*': ['membership-admin'] },
    'platform-operator': { '*': ['operator'] },
    'premium-operator': { 'org-premium': ['operator'] },
  };

  it('puts a group above one whose grants it entirely contains', () => {
    const under = hierarchyOf(GROUPS, ROLES);
    expect(under['platform-admin']).toContain('platform-auditor');
    expect(under['membership-admin']).toContain('platform-auditor');
  });

  it('counts scope, so granting everywhere stands above granting in one organisation', () => {
    // `platform-operator` gives `context:read` in every organisation; `premium-operator` gives it in
    // one. The first therefore includes the second.
    expect(hierarchyOf(GROUPS, ROLES)['platform-operator']).toEqual(['premium-operator']);
  });

  it('leaves unrelated branches unrelated', () => {
    // Administering the platform and reading a tenant's context are not comparable, and pretending
    // otherwise would invent a ranking the engine does not have.
    const under = hierarchyOf(GROUPS, ROLES);
    expect(under['platform-admin']).not.toContain('platform-operator');
    expect(under['platform-operator']).not.toContain('platform-auditor');
  });

  it('does not put two equal groups above each other', () => {
    const equal = { a: { '*': ['operator'] }, b: { '*': ['operator'] } };
    expect(hierarchyOf(equal, ROLES)).toEqual({ a: [], b: [] });
  });

  it('stands above nothing when the other grants nothing', () => {
    // A group conferring nothing is not "below" everything — it is outside the relation. Otherwise
    // every group would claim to dominate the base group, which says nothing about either.
    const withEmpty = { ...GROUPS, users: {} };
    expect(hierarchyOf(withEmpty, ROLES)['platform-admin']).not.toContain('users');
  });

  it('places membership-admin under platform-admin, through the resource path', () => {
    // `admin:write` covers `admin.membership:write`, so the reach of the first includes the second —
    // but only because the model says so, not because the names look alike.
    expect(hierarchyOf(GROUPS, ROLES)['platform-admin']).toContain('membership-admin');
  });
});

describe('what a group gives, in a sentence', () => {
  const ROLES = {
    'platform-admin': ['admin:read', 'admin:write'],
    'membership-admin': ['admin:read', 'admin.membership:write'],
    operator: ['context:read'],
  };

  it('names the permissions the engine matches, not a friendlier paraphrase', () => {
    // A reader deciding whether to hand a group out is better served by the string that will be
    // checked than by prose that might not mean the same thing.
    const said = summarise({ '*': ['membership-admin'] }, ROLES);
    expect(said).toContain('admin.membership:write');
    expect(said).toContain('admin:read');
  });

  it('says where, and every-organisation is said in words', () => {
    expect(summarise({ '*': ['operator'] }, ROLES)).toContain('in every organisation');
    expect(summarise({ 'org-premium': ['operator'] }, ROLES)).toContain('in one organisation');
  });

  it('counts organisations rather than listing identifiers', () => {
    const said = summarise({ 'org-a': ['operator'], 'org-b': ['operator'] }, ROLES);
    expect(said).toContain('in 2 organisations');
  });

  it('keeps the two scopes apart when a group has both', () => {
    const said = summarise({ '*': ['operator'], 'org-a': ['membership-admin'] }, ROLES);
    expect(said).toContain('in every organisation');
    expect(said).toContain('in one organisation');
  });

  it('says so plainly when a group gives nothing', () => {
    // The base group. "Gives nothing" is the fact; an empty sentence would read as unknown.
    expect(summarise({}, ROLES)).toBe('Gives nothing.');
    expect(summarise(undefined, ROLES)).toBe('Gives nothing.');
  });

  it('does not invent a permission for a role the catalogue omits', () => {
    expect(summarise({ '*': ['ghost'] }, ROLES)).toBe('Gives nothing.');
  });
});

describe('permissionChain', () => {
  const model = {
    groups: {
      'platform-admin': { '*': ['platform-admin'] },
      'premium-operator': { 'org-1': ['operator'] },
      'points-nowhere': { '*': ['ghost-role'] },
      'grants-nothing': {},
    },
    roles: { 'platform-admin': ['admin:read', 'admin:write'], operator: ['context:read'] },
  };
  const tables = [{
    name: 'strada-demo-api',
    routes: [
      { method: 'GET', path: '/api/v1/context', class: 'authorized', permission: 'context:read' },
      { method: 'POST', path: '/api/v1/context', class: 'authorized', permission: 'context:read' },
      { method: 'GET', path: '/health/live', class: 'public' },
    ],
  }];

  it('reaches the routes a permission opens — the question the screen exists to answer', () => {
    const [branch] = permissionChain(['premium-operator'], model, tables);
    const permission = branch.scopes[0].roles[0].permissions[0];
    expect(permission.permission).toBe('context:read');
    expect(permission.routes).toEqual([
      { api: 'strada-demo-api', method: 'GET', path: '/api/v1/context' },
      { api: 'strada-demo-api', method: 'POST', path: '/api/v1/context' },
    ]);
  });

  it('marks a platform-wide grant as such rather than naming an organisation', () => {
    const [branch] = permissionChain(['platform-admin'], model, tables);
    expect(branch.scopes[0].everywhere).toBe(true);
  });

  it('tells a group the model does not declare from one that grants nothing', () => {
    // The failure this replaced showed both as the same blank line, so a privileged group and a
    // missing one were indistinguishable.
    const [missing] = permissionChain(['gone'], model, tables);
    expect(missing.declared).toBe(false);
    const [empty] = permissionChain(['grants-nothing'], model, tables);
    expect(empty.declared).toBe(true);
    expect(empty.scopes).toEqual([]);
  });

  it('names a role the model does not define, instead of rendering it empty', () => {
    const [branch] = permissionChain(['points-nowhere'], model, tables);
    expect(branch.scopes[0].roles[0]).toMatchObject({ role: 'ghost-role', known: false, permissions: [] });
  });

  it('leaves a permission no route declares with an empty list, not a missing one', () => {
    const [branch] = permissionChain(['platform-admin'], model, tables);
    expect(branch.scopes[0].roles[0].permissions.map((p) => p.routes)).toEqual([[], []]);
  });

  it('builds the chain with no route tables at all', () => {
    const [branch] = permissionChain(['premium-operator'], model);
    expect(branch.scopes[0].roles[0].permissions[0].routes).toEqual([]);
  });

  it('ignores a public route, which requires no permission', () => {
    const [branch] = permissionChain(['premium-operator'], model, tables);
    const paths = branch.scopes[0].roles[0].permissions.flatMap((p) => p.routes.map((r) => r.path));
    expect(paths).not.toContain('/health/live');
  });
});
