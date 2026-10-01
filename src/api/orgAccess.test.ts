import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth/session', () => ({ bearerToken: async () => null }));

import { orgAccessApi, refusedOf, refusalWords, isNotAvailable } from './orgAccess';

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
  it('reads an org\'s roles, each marked assignable or not', async () => {
    answer(200, { roles: [{ role: 'jinbe:owner', permissions: ['org.members:write'], assignable: false }, { role: 'payroll:editor', permissions: ['pay:write'], assignable: true }, { nope: 1 }] });
    await expect(orgAccessApi.roles('o 1')).resolves.toEqual([
      { role: 'jinbe:owner', permissions: ['org.members:write'], assignable: false },
      { role: 'payroll:editor', permissions: ['pay:write'], assignable: true },
    ]);
    expect(calls[0][0]).toBe('/api/organizations/o%201/roles');
  });

  it('reads and writes one member\'s roles', async () => {
    answer(200, { id: 'u1', roles: ['jinbe:viewer'] });
    await expect(orgAccessApi.memberRoles('o1', 'u1')).resolves.toEqual(['jinbe:viewer']);
    expect(calls[0][0]).toBe('/api/organizations/o1/users/u1/roles');
    answer(200, { id: 'u1', roles: ['jinbe:auditor'] });
    await expect(orgAccessApi.setMemberRoles('o1', 'u1', ['jinbe:auditor'])).resolves.toEqual(['jinbe:auditor']);
    expect(calls[0][1]?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ roles: ['jinbe:auditor'] });
  });

  it('carries the refused roles of a 403 onto the error, with what is missing', async () => {
    answer(403, { error: 'Forbidden', message: 'Not allowed to assign: jinbe:owner', refused: [{ role: 'jinbe:owner', reason: 'grant_exceeds_own', missing: ['org.keys:write'] }, { role: 'x:y', reason: 'unknown_role' }] });
    const err = await orgAccessApi.setMemberRoles('o1', 'u1', ['jinbe:owner']).catch((e: unknown) => e);
    expect((err as { status: number }).status).toBe(403);
    expect(refusedOf(err)).toEqual([
      { role: 'jinbe:owner', reason: 'grant_exceeds_own', missing: ['org.keys:write'] },
      { role: 'x:y', reason: 'unknown_role', missing: [] },
    ]);
  });

  it('names an org\'s owners from the platform route', async () => {
    answer(200, { owners: ['id-1'] });
    await expect(orgAccessApi.setOwners('o1', ['id-1'])).resolves.toEqual(['id-1']);
    expect(calls[0][0]).toBe('/api/admin/organizations/o1/owners');
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ owners: ['id-1'] });
  });

  it('reads a person\'s two layers of access', async () => {
    const body = {
      site: { groups: ['devs'], byService: { jinbe: ['support'] } },
      orgs: [{ orgId: 'o1', name: 'Acme', roles: ['jinbe:owner'], permissions: ['org.members:read'] }],
    };
    answer(200, body);
    await expect(orgAccessApi.userAccess('u1')).resolves.toEqual(body);
    expect(calls[0][0]).toBe('/api/admin/users/u1/access');
  });

  it('fills a sparse access answer so a screen can read it', async () => {
    answer(200, { site: {}, orgs: [{ orgId: 'o1' }] });
    await expect(orgAccessApi.userAccess('u1')).resolves.toEqual({
      site: { groups: [], byService: {} },
      orgs: [{ orgId: 'o1', name: 'o1', roles: [], permissions: [] }],
    });
  });

  it('asks the access check with the form, leaving an empty site out', async () => {
    answer(200, { allow: true, reason: 'ok', app: 'kuma', owners: ['kuma'], matchingRules: [], groups: [], roles: [], permissions: [] });
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

  it('drops malformed entries and keeps grantedBy when jinbe says', () => {
    expect(refusedOf({ details: { refused: [{ role: 'a:b', reason: 'r', reasons: ['missing_permissions'], grantedBy: ['jinbe:owner'] }, { reason: 'no role' }, 7] } }))
      .toEqual([{ role: 'a:b', reason: 'r', missing: [], reasons: ['missing_permissions'], grantedBy: ['jinbe:owner'] }]);
  });
});

describe('refusalWords', () => {
  it('says each reason in words, with what is missing', () => {
    expect(refusalWords({ role: 'a:b', reason: 'unknown_role', missing: [] })).toBe('no such role');
    expect(refusalWords({ role: 'p:e', reason: 'org_not_entitled', missing: [] })).toMatch(/not entitled/);
    expect(refusalWords({ role: 'j:o', reason: 'grant_permission_missing', missing: ['org.members:write'] })).toMatch(/may not assign roles.*org\.members:write/);
    expect(refusalWords({ role: 'j:o', reason: 'grant_exceeds_own', missing: ['org.keys:write'] })).toMatch(/do not hold here.*org\.keys:write/);
  });
});
