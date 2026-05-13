import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The client module reads `window.__API_BASE__` at import time, so we
// need a stub before the import lands. JSDOM is not configured here;
// fake just the bits the client touches.
(globalThis as unknown as { window: { __API_BASE__?: string } }).window = {};

describe('api.setUserOrganizations / getUserOrganizations', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('PUTs to /admin/users/:email/organizations with JSON body and credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ email: 'a@b.test', organizations: ['org-a'] }),
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const { api } = await import('../client');
    const out = await api.setUserOrganizations('a@b.test', ['org-a']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/users/a%40b.test/organizations');
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ organizations: ['org-a'] });
    expect(out).toEqual({ email: 'a@b.test', organizations: ['org-a'] });
  });

  it('GETs the same endpoint for reading', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ email: 'a@b.test', organizations: [] }),
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const { api } = await import('../client');
    const out = await api.getUserOrganizations('a@b.test');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('/api/admin/users/a%40b.test/organizations');
    // No method on init = GET (default).
    expect(init?.method).toBeUndefined();
    expect(out).toEqual({ email: 'a@b.test', organizations: [] });
  });

  it('surfaces the server message and status when the backend rejects (400 invalid UUID)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_uuid', message: 'organization id is not a valid UUID' }),
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const { api } = await import('../client');
    await expect(api.setUserOrganizations('a@b.test', ['not-a-uuid'])).rejects.toMatchObject({
      status: 400,
      message: 'organization id is not a valid UUID',
      code: 'invalid_uuid',
    });
  });

  it('throws on 404 so callers can detect a legacy backend without losing draft input', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not_found' }),
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const { api } = await import('../client');
    await expect(api.setUserOrganizations('a@b.test', ['org-a'])).rejects.toMatchObject({
      status: 404,
    });
  });
});
