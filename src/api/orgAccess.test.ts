import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth/session', () => ({ bearerToken: async () => null }));

import { orgAccessApi, refusedOf, isNotAvailable } from './orgAccess';

type Call = [string, RequestInit | undefined];
let calls: Call[] = [];

function answer(status: number, body: unknown) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  }));
}

beforeEach(() => { calls = []; });

describe('orgAccessApi', () => {
  it('reads an org\'s grants keyed by email', async () => {
    answer(200, { grants: { 'bob@acme.io': ['fleet-viewers'] } });
    await expect(orgAccessApi.grants('o 1')).resolves.toEqual({ 'bob@acme.io': ['fleet-viewers'] });
    expect(calls[0][0]).toBe('/api/organizations/o%201/grants');
  });

  it('reads a missing grants map as empty', async () => {
    answer(200, {});
    await expect(orgAccessApi.grants('o1')).resolves.toEqual({});
  });

  it('writes one member\'s grants with PUT and the groups body', async () => {
    answer(200, { email: 'bob@acme.io', groups: ['a'] });
    await expect(orgAccessApi.setGrants('o1', 'u1', ['a'])).resolves.toEqual({ email: 'bob@acme.io', groups: ['a'] });
    expect(calls[0][0]).toBe('/api/organizations/o1/users/u1/grants');
    expect(calls[0][1]?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ groups: ['a'] });
  });

  it('carries the refused groups of a 403 onto the error', async () => {
    answer(403, { error: 'Forbidden', message: 'not yours', refused: [{ group: 'fleet-admins', reason: 'carries *' }] });
    const err = await orgAccessApi.setGrants('o1', 'u1', ['fleet-admins']).catch((e) => e);
    expect(err.status).toBe(403);
    expect(refusedOf(err)).toEqual([{ group: 'fleet-admins', reason: 'carries *' }]);
  });

  it('reads assignable groups in the new shape and the older list of names', async () => {
    answer(200, { groups: [{ name: 'viewers', services: { fleet: ['viewer'] } }] });
    await expect(orgAccessApi.assignable('o1')).resolves.toEqual([{ name: 'viewers', services: { fleet: ['viewer'] } }]);
    answer(200, { groups: ['viewers'] });
    await expect(orgAccessApi.assignable('o1')).resolves.toEqual([{ name: 'viewers', services: {} }]);
  });

  it('reads a person\'s two layers of access', async () => {
    const body = {
      site: { groups: ['devs'], byService: { kuma: ['viewer'] } },
      orgs: [{ orgId: 'o1', name: 'Acme', admin: true, grants: ['fleet-viewers'] }],
    };
    answer(200, body);
    await expect(orgAccessApi.userAccess('u1')).resolves.toEqual(body);
    expect(calls[0][0]).toBe('/api/admin/users/u1/access');
  });

  it('fills a sparse access answer so a screen can read it', async () => {
    answer(200, { site: {}, orgs: [{ orgId: 'o1' }] });
    await expect(orgAccessApi.userAccess('u1')).resolves.toEqual({
      site: { groups: [], byService: {} },
      orgs: [{ orgId: 'o1', name: 'o1', admin: false, grants: [] }],
    });
  });

  it('asks the access check with the form, leaving an empty site out', async () => {
    answer(200, { allow: true, reason: 'ok', app: 'kuma', owners: ['kuma'], matchingRules: [], groups: [], roles: [], permissions: [], superAdmin: false });
    await orgAccessApi.accessCheck({ email: 'a@b.c', method: 'get', path: '/api/x', app: '' });
    expect(calls[0][0]).toBe('/api/admin/rbac/access-check');
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ email: 'a@b.c', method: 'GET', path: '/api/x' });
  });

  it('removes from one org and adds an existing person', async () => {
    answer(204, null);
    await orgAccessApi.removeFromOrg('o1', 'u1');
    expect(calls[0]).toEqual(['/api/organizations/o1/users/u1', expect.objectContaining({ method: 'DELETE' })]);
    answer(200, {});
    await orgAccessApi.addMember('o1', 'u1');
    expect(calls[0]).toEqual(['/api/organizations/o1/users/u1/membership', expect.objectContaining({ method: 'PUT' })]);
  });
});

describe('isNotAvailable', () => {
  it('reads the router\'s own 404 as an endpoint this server does not have yet', () => {
    expect(isNotAvailable({ status: 404, message: 'Route GET:/api/organizations/o1/grants not found' })).toBe(true);
    expect(isNotAvailable({ status: 403, message: 'Route GET:/x not found' })).toBe(false);
    expect(isNotAvailable(null)).toBe(false);
  });

  it('does not mistake a missing person or org for a missing endpoint', () => {
    expect(isNotAvailable({ status: 404, message: 'Organization not found' })).toBe(false);
  });
});

describe('refusedOf', () => {
  it('reads nothing from an error without a refusal list', () => {
    expect(refusedOf(new Error('x'))).toEqual([]);
    expect(refusedOf({ details: { refused: 'nope' } })).toEqual([]);
  });

  it('drops malformed entries', () => {
    expect(refusedOf({ details: { refused: [{ group: 'a', reason: 'r' }, { reason: 'no group' }, 7] } }))
      .toEqual([{ group: 'a', reason: 'r' }]);
  });
});
