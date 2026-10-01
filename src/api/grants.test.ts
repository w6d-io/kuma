import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth/session', () => ({ bearerToken: async () => null }));

import { grantsApi, refusedGrantsOf } from './grants';

let calls: [string, RequestInit | undefined][] = [];
function answer(status: number, body: unknown) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }));
}
beforeEach(() => { calls = []; });

describe('grantsApi', () => {
  it('reads a person\'s grants, dropping malformed ones and inventing nothing', async () => {
    answer(200, { grants: [
      { id: 'g1', service: 'payroll', kind: 'role', name: 'editor', reason: 'close', expiresAt: '2026-10-08T00:00:00Z', grantedBy: 'ops@example.com', grantedAt: '2026-10-01T00:00:00Z' },
      { id: 'g2', kind: 'permission', name: 'org.keys:read', org: 'o1' },
      { kind: 'role' }, 'junk',
    ] });
    await expect(grantsApi.of('u 1')).resolves.toEqual([
      { id: 'g1', service: 'payroll', kind: 'role', name: 'editor', reason: 'close', expiresAt: '2026-10-08T00:00:00Z', grantedBy: 'ops@example.com', grantedAt: '2026-10-01T00:00:00Z' },
      { id: 'g2', service: 'jinbe', kind: 'permission', name: 'org.keys:read', org: 'o1', expiresAt: null },
    ]);
    expect(calls[0][0]).toBe('/api/admin/users/u%201/grants');
  });

  it('adds with PUT, and uses the org route inside an organization', async () => {
    answer(200, { grants: [] });
    await grantsApi.add('u1', [{ service: 'jinbe', kind: 'permission', name: 'org.keys:read' }], 'o1');
    expect(calls[0][0]).toBe('/api/organizations/o1/users/u1/grants');
    expect(calls[0][1]?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ grants: [{ service: 'jinbe', kind: 'permission', name: 'org.keys:read' }] });
    answer(204, null);
    await grantsApi.remove('u1', 'g 1');
    expect(calls[0]).toEqual(['/api/admin/users/u1/grants/g%201', expect.objectContaining({ method: 'DELETE' })]);
  });

  it('reads the review list with the person holding each grant', async () => {
    answer(200, { grants: [{ id: 'g1', kind: 'permission', name: 'users:read', subject: { id: 'u1', email: 'a@example.com' } }, { id: 'g2', kind: 'role', name: 'x' }] });
    await expect(grantsApi.all()).resolves.toEqual([{ id: 'g1', service: 'jinbe', kind: 'permission', name: 'users:read', expiresAt: null, subject: { id: 'u1', email: 'a@example.com', name: undefined } }]);
    expect(calls[0][0]).toBe('/api/admin/grants');
  });
});

describe('refusedGrantsOf', () => {
  it('reads each refused grant with what is missing and who could', () => {
    expect(refusedGrantsOf({ details: { refused: [{ service: 'jinbe', kind: 'permission', name: 'users:delete', reason: 'grant_exceeds_own', missing: ['users:delete'], grantedBy: ['super_admins'] }, { reason: 'nameless' }] } })).toEqual([
      { service: 'jinbe', kind: 'permission', name: 'users:delete', reason: 'grant_exceeds_own', missing: ['users:delete'], grantedBy: ['super_admins'] },
    ]);
    expect(refusedGrantsOf(new Error('x'))).toEqual([]);
  });
});
