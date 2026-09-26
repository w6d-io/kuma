import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/session', () => ({ bearerToken: async () => null }));

import { AUDIT_ERROR_COPY, auditApi, auditErrorKind, auditQueryString } from './audit';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('auditQueryString', () => {
  it('repeats list facets and drops empty values', () => {
    expect(auditQueryString({ from: 'a', to: 'b', event: ['x.y', 'z.*'], org: '', cursor: null, limit: 50 }))
      .toBe('from=a&to=b&event=x.y&event=z.*&limit=50');
  });
  it('escapes values instead of passing them raw', () => {
    expect(auditQueryString({ q: '"} |= "x' })).toBe('q=%22%7D+%7C%3D+%22x');
  });
});

describe('auditApi', () => {
  it('pages events with the cursor', async () => {
    const page = { events: [], nextCursor: null, scope: { orgs: [], platform: true }, range: { from: 'a', to: 'b' }, truncated: false };
    const f = mockFetch(200, page);
    await expect(auditApi.events({ from: 'a', to: 'b', result: 'denied' }, 'c1')).resolves.toEqual(page);
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('/api/audit/events?from=a&to=b&result=denied&limit=50&cursor=c1');
  });
  it('asks for one event by id and ts', async () => {
    const f = mockFetch(200, { event: {}, chain: 'verified' });
    await auditApi.event('0192/x', '2026-09-25T11:00:00Z');
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('/api/audit/events/0192%2Fx?ts=2026-09-25T11%3A00%3A00Z');
  });
  it('starts an export with a JSON body', async () => {
    const f = mockFetch(202, { id: 'job1' });
    await expect(auditApi.startExport({ from: 'a', to: 'b', filters: {}, format: 'csv' })).resolves.toEqual({ id: 'job1' });
    const init = (f.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ from: 'a', to: 'b', filters: {}, format: 'csv' });
  });
  it('accepts saved queries as a list or wrapped', async () => {
    mockFetch(200, { queries: [{ id: '1', name: 'n', filters: {}, shared: false }] });
    await expect(auditApi.savedQueries()).resolves.toHaveLength(1);
    mockFetch(200, [{ id: '1', name: 'n', filters: {}, shared: false }]);
    await expect(auditApi.savedQueries()).resolves.toHaveLength(1);
  });
  it('unwraps facets and keeps the page-level total', async () => {
    mockFetch(200, { facets: { event: [{ key: 'a.b', count: 2 }], category: [], result: [], site: [], actor: [] }, total: 2, truncated: true });
    await expect(auditApi.facets({ from: 'a', to: 'b' })).resolves.toMatchObject({ event: [{ key: 'a.b', count: 2 }], total: 2, truncated: true });
  });
  it('asks the summary for the window and org only', async () => {
    const f = mockFetch(200, { window: '7d', total: 0, series: [] });
    await auditApi.summary('7d', 'acme');
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('/api/audit/summary?window=7d&org=acme');
  });
  it('downloads an export through fetch, and says when it expired', async () => {
    const f = mockFetch(200, 'x');
    const created = vi.fn(() => 'blob:1');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    await auditApi.download('/api/audit/exports/j1/download', 'a.csv');
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('/api/audit/exports/j1/download');
    expect(created).toHaveBeenCalled();
    mockFetch(410, { error: 'expired' });
    await expect(auditApi.download('/api/audit/exports/j1/download', 'a.csv')).rejects.toThrow(/expired/);
  });
  it('builds the tail address without from/to', () => {
    expect(auditApi.tailUrl({ result: 'denied' })).toBe('/api/audit/tail?result=denied');
  });
});

describe('auditErrorKind', () => {
  const err = (status: number, message = 'x') => Object.assign(new Error(message), { status });
  it('tells the router 404 (no API yet) from everything else', async () => {
    mockFetch(404, { message: 'Route GET:/api/audit/events not found', error: 'Not Found', statusCode: 404 });
    const e = await auditApi.events({ from: 'a', to: 'b' }).catch((x) => x);
    expect(auditErrorKind(e)).toBe('not-available');
    expect(auditErrorKind(err(404, 'event not found'))).toBe('failed');
  });
  it('maps 503, 403, 400 and 429 to the §5.2 states', () => {
    expect(auditErrorKind(err(503))).toBe('store-down');
    expect(auditErrorKind(err(403))).toBe('out-of-scope');
    expect(auditErrorKind(Object.assign(err(400), { code: 'range_too_large' }))).toBe('range');
    expect(auditErrorKind(Object.assign(err(400), { code: 'invalid_request' }))).toBe('failed');
    expect(auditErrorKind(err(429))).toBe('busy');
    expect(AUDIT_ERROR_COPY['store-down'].detail).toMatch(/outage, not an empty log/);
  });
});
