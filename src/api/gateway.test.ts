import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../auth/session', () => ({ bearerToken: vi.fn(async () => null) }));

import { gatewayApi } from './gateway';
import { stateFromWire } from '../lib/gateway/adapt';

let calls: Array<{ url: string; init: RequestInit }> = [];
let body: unknown = {};
beforeEach(() => {
  calls = [];
  body = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => body } as Response;
  }));
});
afterEach(() => vi.unstubAllGlobals());

const state = stateFromWire({ managed: true, etag: 'rv:4', errorFallback: ['json'], handlers: [] });

describe('gatewayApi', () => {
  it('reads and adapts the state', async () => {
    body = { managed: false, etag: 'unmanaged', handlers: [{ kind: 'error', name: 'json', enabled: true, config: {} }] };
    const s = await gatewayApi.get();
    expect(calls[0].url).toBe('/api/admin/gateway');
    expect(s.managed).toBe(false);
    expect(s.adapted.errors[0].name).toBe('json');
  });
  it('previews with the whole spec', async () => {
    body = { ok: true, issues: [], changes: [], managed: true, etag: 'rv:4' };
    await gatewayApi.preview(state, [{ kind: 'authenticators', name: 'jwt', enabled: true }]);
    expect(JSON.parse(String(calls[0].init.body)).spec.authenticators).toEqual({ jwt: { enabled: true } });
  });
  it('applies with If-Match rv:N, or unmanaged to adopt', async () => {
    await gatewayApi.apply(state, [], 'n');
    expect((calls[0].init.headers as Record<string, string>)['If-Match']).toBe('rv:4');
    await gatewayApi.apply({ ...state, managed: false }, []);
    expect((calls[1].init.headers as Record<string, string>)['If-Match']).toBe('unmanaged');
  });
  it('rolls back with a note', async () => {
    await gatewayApi.rollback('bad change');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ note: 'bad change' });
  });
});
