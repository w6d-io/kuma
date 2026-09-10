import { describe, it, expect } from 'vitest';
import { scopesOf, grantsEveryOrganisation, resolveRoles } from './model';

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
