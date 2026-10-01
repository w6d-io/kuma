import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth/session', () => ({ bearerToken: async () => null }));

import { grantsApi, mergedRequests, refusedGrantsOf } from './grants';

type Call = [string, RequestInit | undefined];
let calls: Call[] = [];
/** Answers in order, one per call. */
function answers(...bodies: Array<[number, unknown]>) {
  calls = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const [status, body] = bodies[Math.min(i++, bodies.length - 1)];
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }));
}
beforeEach(() => { calls = []; });

const editor = { id: 'g1', scope: 'platform', app: 'payroll', kind: 'role', name: 'editor', reason: 'close', expiresAt: '2026-10-08T00:00:00Z', grantedBy: 'ops@example.com', grantedAt: '2026-10-01T00:00:00Z', active: true };

describe('grantsApi', () => {
  it('reads a person\'s grants in the console\'s shape: app → service, an org scope → org, malformed ones dropped', async () => {
    answers([200, { id: 'u1', email: 'bob@example.com', grants: [editor, { id: 'g2', scope: 'o1', app: 'jinbe', kind: 'permission', name: 'org.keys:read', active: false }, { kind: 'role' }] }]);
    await expect(grantsApi.of('u 1')).resolves.toEqual([
      { id: 'g1', service: 'payroll', kind: 'role', name: 'editor', reason: 'close', expiresAt: '2026-10-08T00:00:00Z', grantedBy: 'ops@example.com', grantedAt: '2026-10-01T00:00:00Z' },
      { id: 'g2', service: 'jinbe', kind: 'permission', name: 'org.keys:read', org: 'o1', expiresAt: null, active: false },
    ]);
    expect(calls[0][0]).toBe('/api/admin/users/u%201/grants');
  });

  it('adds by replacing: the current set plus the new grants, every scope kept, "never" left out', async () => {
    answers([200, { grants: [editor, { id: 'g2', scope: 'o1', app: 'jinbe', kind: 'permission', name: 'org.keys:read' }] }], [200, { grants: [] }]);
    await grantsApi.add('u1', [{ service: 'jinbe', kind: 'permission', name: 'users:read', reason: 'rota' }]);
    expect(calls[1][1]?.method).toBe('PUT');
    expect(JSON.parse(String(calls[1][1]?.body)).grants).toEqual([
      { scope: 'platform', app: 'payroll', kind: 'role', name: 'editor', reason: 'close', expiresAt: '2026-10-08T00:00:00Z' },
      { scope: 'o1', app: 'jinbe', kind: 'permission', name: 'org.keys:read' },
      { scope: 'platform', app: 'jinbe', kind: 'permission', name: 'users:read', reason: 'rota' },
    ]);
  });

  it('inside an organization: that org\'s route and scope', async () => {
    answers([200, { grants: [] }], [200, { grants: [] }]);
    await grantsApi.add('u1', [{ service: 'jinbe', kind: 'permission', name: 'org.keys:read' }], 'o1');
    expect(calls[1][0]).toBe('/api/organizations/o1/users/u1/grants');
    expect(JSON.parse(String(calls[1][1]?.body))).toEqual({ grants: [{ scope: 'o1', app: 'jinbe', kind: 'permission', name: 'org.keys:read' }] });
    answers([200, { grants: [] }]);
    await grantsApi.remove('u1', 'g 1');
    expect(calls[0]).toEqual(['/api/admin/users/u1/grants/g%201', expect.objectContaining({ method: 'DELETE' })]);
  });

  it('a re-granted one replaces its old reason and expiry', () => {
    expect(mergedRequests([{ id: 'g1', service: 'jinbe', kind: 'permission', name: 'users:read', reason: 'old', expiresAt: '2026-10-02T00:00:00Z' }], [{ service: 'jinbe', kind: 'permission', name: 'users:read' }]))
      .toEqual([{ scope: 'platform', app: 'jinbe', kind: 'permission', name: 'users:read' }]);
  });

  it('reads the review list: people, each with their grants', async () => {
    answers([200, { people: [{ id: 'u1', email: 'a@example.com', grants: [{ id: 'g1', scope: 'platform', app: 'jinbe', kind: 'permission', name: 'users:read' }] }, { email: 'no-id' }] }]);
    await expect(grantsApi.all()).resolves.toEqual([{ id: 'g1', service: 'jinbe', kind: 'permission', name: 'users:read', expiresAt: null, subject: { id: 'u1', email: 'a@example.com', name: undefined } }]);
    expect(calls[0][0]).toBe('/api/admin/grants');
  });
});

describe('refusedGrantsOf', () => {
  it('reads each refused grant with its reasons, what is missing and who could', () => {
    expect(refusedGrantsOf({ details: { refused: [
      { grant: { scope: 'o1', app: 'jinbe', kind: 'permission', name: 'org.keys:write' }, reasons: ['missing_permissions'], missing: ['org.keys:write'], grantedBy: ['jinbe:owner'] },
      { reasons: ['x'] },
    ] } })).toEqual([
      { service: 'jinbe', kind: 'permission', name: 'org.keys:write', reason: 'missing_permissions', reasons: ['missing_permissions'], missing: ['org.keys:write'], grantedBy: ['jinbe:owner'], org: 'o1' },
    ]);
    expect(refusedGrantsOf(new Error('x'))).toEqual([]);
  });
});
