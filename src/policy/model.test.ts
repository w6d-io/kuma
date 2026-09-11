import { describe, it, expect } from 'vitest';
import { scopesOf, grantsEveryOrganisation, resolveRoles, covers, permits } from './model';

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
