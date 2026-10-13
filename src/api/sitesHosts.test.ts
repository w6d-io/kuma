import { afterEach, describe, expect, it, vi } from 'vitest';

// The host detail is asked with the host in the query: a path ending in `.com` is refused by the WAF
// (OWASP CRS 920440) — and a refusal is never retried, since retrying a WAF block bans the visitor's IP.

vi.mock('../auth/session', () => ({ bearerToken: async () => null }));

import { sitesApi } from './sites';

afterEach(() => vi.unstubAllGlobals());

describe('sitesApi.host', () => {
  it('puts the host in the query, never as the last path segment', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ host: 'a.example.com', services: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await sitesApi.host('stairling-copilot-demo.authdev.dev.stairling.com');
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/sites/hosts/detail?host=stairling-copilot-demo.authdev.dev.stairling.com');
    expect(new URL(url, 'http://x').pathname.endsWith('.com')).toBe(false);
  });
});
