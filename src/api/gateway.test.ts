import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../auth/session', () => ({ bearerToken: vi.fn(async () => null) }));

import { gatewayApi } from './gateway';

let calls: Array<{ url: string; init: RequestInit }> = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('gatewayApi', () => {
  it('reads and previews under /api/admin/gateway', async () => {
    await gatewayApi.get();
    await gatewayApi.preview([{ kind: 'mutators', name: 'hydrator', enabled: true }]);
    expect(calls.map((c) => c.url)).toEqual(['/api/admin/gateway', '/api/admin/gateway/preview']);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ changes: [{ kind: 'mutators', name: 'hydrator', enabled: true }] });
  });
  it('applies with If-Match and a JSON type', async () => {
    await gatewayApi.apply([{ kind: 'authenticators', name: 'jwt', enabled: true }], 'v3', 'enable jwt');
    const h = calls[0].init.headers as Record<string, string>;
    expect(calls[0].init.method).toBe('PUT');
    expect(h).toMatchObject({ 'If-Match': '"v3"', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(calls[0].init.body)).note).toBe('enable jwt');
  });
  it('rolls back to a version', async () => {
    await gatewayApi.rollback(2);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ toVersion: 2 });
  });
});
