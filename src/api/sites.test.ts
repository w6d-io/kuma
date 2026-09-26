import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../auth/session', () => ({ bearerToken: vi.fn(async () => 'tok') }));

import { sitesApi, notAvailable, checksOf } from './sites';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let next: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(() => {
  calls = [];
  next = { status: 200, body: {} };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: next.status < 400, status: next.status, json: async () => next.body } as Response;
  }));
});
afterEach(() => vi.unstubAllGlobals());

const headers = (c: Call) => c.init.headers as Record<string, string>;

describe('sitesApi', () => {
  it('lists and reads under /api/admin/sites', async () => {
    await sitesApi.list();
    await sitesApi.get('pay roll');
    expect(calls.map((c) => c.url)).toEqual(['/api/admin/sites', '/api/admin/sites/pay%20roll']);
  });

  it('saves with If-Match, keeping the JSON type and the token', async () => {
    await sitesApi.save('payroll', { name: 'payroll' } as never, { etag: 'abc', note: 'n' });
    const c = calls[0];
    expect(c.init.method).toBe('PUT');
    expect(headers(c)).toMatchObject({ 'If-Match': '"abc"', 'Content-Type': 'application/json', Authorization: 'Bearer tok' });
    expect(JSON.parse(String(c.init.body))).toEqual({ site: { name: 'payroll' }, note: 'n' });
  });

  it('sends the draft with its base version', async () => {
    await sitesApi.putDraft('payroll', { displayName: 'P' }, 3);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ site: { displayName: 'P' }, baseVersion: 3 });
  });

  it('apply and rollback carry the version', async () => {
    await sitesApi.apply('payroll', 4);
    await sitesApi.rollback('payroll', 2);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ version: 4 });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ toVersion: 2 });
  });

  it('match sends the draft only when asked', async () => {
    await sitesApi.match({ method: 'GET', url: 'https://p.dev.stairling.com/x', against: 'live' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ method: 'GET', url: 'https://p.dev.stairling.com/x', against: 'live' });
  });
});

describe('errors', () => {
  it('reads the router 404 as not available yet, a real 404 as not', async () => {
    next = { status: 404, body: { message: 'Route GET:/api/admin/sites/p/status not found', error: 'Not Found' } };
    const e1 = await sitesApi.status('p').catch((e) => e);
    expect(notAvailable(e1)).toBe(true);
    next = { status: 404, body: { error: 'not_found', message: 'No draft for p' } };
    const e2 = await sitesApi.getDraft('p').catch((e) => e);
    expect(notAvailable(e2)).toBe(false);
  });
  it('reads a planned static path swallowed by /:name as not available yet', async () => {
    next = { status: 404, body: { error: 'not_found', message: 'Site not found: migration' } };
    expect(notAvailable(await sitesApi.migration().catch((e) => e))).toBe(true);
    next = { status: 404, body: { error: 'not_found', message: 'Site not found: payroll' } };
    expect(notAvailable(await sitesApi.get('payroll').catch((e) => e))).toBe(false);
  });
  it('carries the checks of a refused save', async () => {
    next = { status: 422, body: { error: 'invalid_site', message: 'no', checks: [{ level: 'error', code: 'x', message: 'bad' }] } };
    const e = await sitesApi.save('p', {} as never).catch((err) => err);
    expect(e.code).toBe('invalid_site');
    expect(checksOf(e)).toEqual([{ level: 'error', code: 'x', message: 'bad' }]);
  });
});
