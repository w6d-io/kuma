import { describe, it, expect } from 'vitest';
import { explain, formFromQuery, validateCheck, describeCheckError, requiredPermissions } from './accessCheck';
import type { AccessCheckResult } from '../api/orgAccess';

const base: AccessCheckResult = {
  allow: false,
  reason: 'forbidden',
  app: 'fleet',
  owners: ['fleet'],
  matchingRules: [{ method: 'GET', path: '/api/fleet/clusters', permission: 'clusters:read' }],
  groups: ['devs'],
  roles: ['viewer'],
  permissions: ['nodes:read'],
  superAdmin: false,
};

describe('explain', () => {
  it('says allowed through roles', () => {
    const e = explain({ ...base, allow: true, reason: 'ok', permissions: ['clusters:read'] });
    expect(e.verdict).toBe('ALLOWED');
    expect(e.tie).toBe(false);
    expect(e.text).toMatch(/clusters:read/);
  });

  it('says allowed because super admin', () => {
    const e = explain({ ...base, allow: true, reason: 'ok', superAdmin: true });
    expect(e.text).toMatch(/super admin/i);
  });

  it('names the missing permission and the site on a refusal', () => {
    const e = explain(base);
    expect(e.verdict).toBe('DENIED');
    expect(e.text).toMatch(/fleet/);
    expect(e.text).toMatch(/clusters:read/);
  });

  it('calls a route owned by two sites a tie, whatever the reason', () => {
    const e = explain({ ...base, reason: 'not_found', app: null, owners: ['fleet', 'kuma'], matchingRules: [] });
    expect(e.tie).toBe(true);
    expect(e.text).toMatch(/two sites claim this route/i);
    expect(e.text).toMatch(/fleet.*kuma/);
  });

  it('says no site declares an unowned route', () => {
    const e = explain({ ...base, reason: 'not_found', app: null, owners: [], matchingRules: [] });
    expect(e.tie).toBe(false);
    expect(e.text).toMatch(/no site declares/i);
  });

  it('explains an org refusal as the org boundary', () => {
    const e = explain({ ...base, reason: 'forbidden_org' });
    expect(e.text).toMatch(/organization/i);
  });
});

describe('requiredPermissions', () => {
  it('lists each distinct permission the matching rules ask for', () => {
    expect(requiredPermissions({
      ...base,
      matchingRules: [
        { method: 'GET', path: '/a', permission: 'x' },
        { method: 'GET', path: '/b', permission: 'x' },
        { method: 'GET', path: '/c' },
      ],
    })).toEqual(['x']);
  });
});

describe('formFromQuery', () => {
  it('reads a deep link, defaulting the method to GET', () => {
    expect(formFromQuery({ email: 'a@b.c', path: '/api/x' })).toEqual({ email: 'a@b.c', method: 'GET', path: '/api/x', app: '' });
  });

  it('upper-cases the method and ignores one it does not know', () => {
    expect(formFromQuery({ method: 'delete' }).method).toBe('DELETE');
    expect(formFromQuery({ method: 'BREW' }).method).toBe('GET');
  });

  it('reads nothing into an empty form', () => {
    expect(formFromQuery(undefined)).toEqual({ email: '', method: 'GET', path: '', app: '' });
  });
});

describe('validateCheck', () => {
  it('accepts a complete form', () => {
    expect(validateCheck({ email: 'a@b.c', method: 'GET', path: '/api/x', app: '' })).toBeNull();
  });

  it('asks for an email and an absolute path without a query', () => {
    expect(validateCheck({ email: 'nope', method: 'GET', path: '/x', app: '' })).toMatch(/email/i);
    expect(validateCheck({ email: 'a@b.c', method: 'GET', path: 'api/x', app: '' })).toMatch(/start with \//);
    expect(validateCheck({ email: 'a@b.c', method: 'GET', path: '/api/x?y=1', app: '' })).toMatch(/query/);
  });
});

describe('describeCheckError', () => {
  it('reads a 503 as the checker not being set up, not as an outage of access', () => {
    expect(describeCheckError({ status: 503 }).title).toMatch(/not set up/i);
  });

  it('reads the router 404 as not available yet', () => {
    expect(describeCheckError({ status: 404, message: 'Route POST:/api/admin/rbac/access-check not found' }).title)
      .toMatch(/not available yet/i);
  });

  it('shows the server\'s reason for a bad request', () => {
    expect(describeCheckError({ status: 400, message: 'path: must be an absolute path' }).detail).toMatch(/absolute path/);
  });

  it('reads a 502 as the engine not answering', () => {
    expect(describeCheckError({ status: 502 }).title).toMatch(/did not answer/i);
  });
});
