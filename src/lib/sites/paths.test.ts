import { describe, it, expect } from 'vitest';
import {
  normalizePath, parseSegments, formatSegments, pathProblem, pathParams, guessOrgParam, orgParamProblem,
  examplePath, displayPath, matchesPath, METHOD_PRESETS, toggleMethod,
} from './paths';

describe('normalizePath', () => {
  it('adds the leading slash and turns a trailing * into :any*', () => {
    expect(normalizePath('assets/*')).toBe('/assets/:any*');
    expect(normalizePath('/assets*')).toBe('/assets/:any*');
    expect(normalizePath('*')).toBe('/:any*');
  });
  it('converts OpenAPI {id} to :id and collapses double slashes', () => {
    expect(normalizePath('/api//payslips/{id}')).toBe('/api/payslips/:id');
  });
  it('drops a trailing slash except for the root', () => {
    expect(normalizePath('/api/')).toBe('/api');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('  ')).toBe('/');
  });
});

describe('segments', () => {
  it('round-trips a path through its parts', () => {
    const segs = parseSegments('/api/orgs/:orgId/files/:any*');
    expect(segs).toEqual([
      { kind: 'exact', value: 'api' }, { kind: 'exact', value: 'orgs' }, { kind: 'param', value: 'orgId' },
      { kind: 'exact', value: 'files' }, { kind: 'rest', value: 'any' },
    ]);
    expect(formatSegments(segs)).toBe('/api/orgs/:orgId/files/:any*');
  });
  it('reads the root as no parts', () => {
    expect(parseSegments('/')).toEqual([]);
    expect(formatSegments([])).toBe('/');
  });
});

describe('pathProblem', () => {
  it('accepts what jinbe accepts', () => {
    for (const p of ['/', '/api', '/api/:id', '/assets/:any*', '/a.b~c@d-e_f']) expect(pathProblem(p)).toBeNull();
  });
  it('refuses a missing slash, a bad param name, a wildcard in the middle, a query', () => {
    expect(pathProblem('api')).toMatch(/start with \//);
    expect(pathProblem('/api/:1x')).toMatch(/:1x/);
    expect(pathProblem('/a/:any*/b')).toMatch(/only end/);
    expect(pathProblem('/a?x=1')).toMatch(/query/);
    expect(pathProblem('/a/**')).not.toBeNull();
  });
});

describe('org params', () => {
  it('lists named params, not the rest wildcard', () => {
    expect(pathParams('/api/orgs/:orgId/p/:id/:any*')).toEqual(['orgId', 'id']);
  });
  it('guesses an org-looking param', () => {
    expect(guessOrgParam('/api/orgs/:orgId/payslips/:id')).toBe('orgId');
    expect(guessOrgParam('/t/:tenantId')).toBe('tenantId');
    expect(guessOrgParam('/api/organizations/:x/y')).toBe('x');
    expect(guessOrgParam('/api/payslips/:id')).toBeUndefined();
  });
  it('mirrors assertOrgParams: exactly once, and present', () => {
    expect(orgParamProblem('/api/:orgId/x', 'orgId')).toBeNull();
    expect(orgParamProblem('/api/x', 'orgId')).toMatch(/Add :orgId/);
    expect(orgParamProblem('/api/:orgId/:orgId', 'orgId')).toMatch(/exactly one part/);
  });
});

describe('examples and matching', () => {
  it('fills params with samples and the wildcard with a segment', () => {
    expect(examplePath('/api/orgs/:orgId/p/:id')).toBe('/api/orgs/3f0c/p/42');
    expect(examplePath('/assets/:any*')).toBe('/assets/x');
  });
  it('shows :any* as *', () => {
    expect(displayPath('/assets/:any*')).toBe('/assets/*');
  });
  it('matches like the route map', () => {
    expect(matchesPath('/api/orgs/:orgId/p', '/api/orgs/a/p')).toBe(true);
    expect(matchesPath('/api/orgs/:orgId/p', '/api/orgs/a/p/1')).toBe(false);
    expect(matchesPath('/assets/:any*', '/assets/a/b')).toBe(true);
    expect(matchesPath('/assets/:any*', '/assets')).toBe(true);
    expect(matchesPath('/assets/:any*', '/other')).toBe(false);
  });
});

describe('methods', () => {
  it('toggles in canonical order', () => {
    expect(toggleMethod(['POST'], 'GET')).toEqual(['GET', 'POST']);
    expect(toggleMethod(['GET', 'POST'], 'GET')).toEqual(['POST']);
  });
  it('has read/write/all presets', () => {
    expect(METHOD_PRESETS.read).toEqual(['GET', 'HEAD']);
    expect(METHOD_PRESETS.write).toEqual(['POST', 'PUT', 'PATCH', 'DELETE']);
  });
});
