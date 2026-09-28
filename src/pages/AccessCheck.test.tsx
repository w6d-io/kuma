import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, key, render, type } from '../components/ui/testing';

vi.mock('../auth/session', () => ({ bearerToken: async () => null }));
vi.mock('../api/hooks', () => ({
  useServices: () => ({ data: [{ name: 'fleet' }, { name: 'billing' }] }),
  useAllRoutes: (names: string[]) => ({
    isLoading: false,
    data: Object.fromEntries(names.map((n) => [n, n === 'fleet'
      ? [{ method: 'GET', path: '/api/clusters/:id', permission: 'fleet:read' }, { method: 'delete', path: '/api/clusters/:id', permission: 'fleet:write' }]
      : [{ method: '*', path: '/invoices' }]])),
  }),
}));

import { AccessCheckPage } from './AccessCheck';

const ID = '6f1c9a52-3b0e-4d0e-9a55-0f3c2b1d7e10';
const ALICE = { id: ID, email: 'alice@example.com', name: 'Alice', active: true, groups: ['ops'], organizations: ['acme'], mfa: true };
const VERDICT = {
  allow: true, reason: 'ok', app: 'fleet', owners: ['fleet'], matchingRules: [], groups: ['ops'], roles: [], permissions: [], superAdmin: false,
};

type Call = { method: string; url: string; body?: unknown };
let calls: Call[] = [];
let lookupStatus = 200;
beforeEach(() => {
  calls = [];
  lookupStatus = 200;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    if (c.url.includes('/admin/users/lookup')) {
      if (lookupStatus !== 200) return new Response(JSON.stringify({ message: 'Route GET:/api/admin/users/lookup not found' }), { status: lookupStatus });
      const q = new URL(c.url, 'http://x').searchParams.get('q') ?? '';
      const hit = q === ID || 'alice@example.com'.startsWith(q);
      return Response.json({ match: hit ? (q === ID ? 'id' : 'prefix') : 'none', data: hit ? [ALICE] : [] });
    }
    if (c.url.includes('/access-check')) return Response.json(VERDICT);
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.location.hash = ''; });

async function settle(ms = 0) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AccessCheckPage /></QueryClientProvider>);
};
const email = () => document.getElementById('ac-email') as HTMLInputElement;
const checks = () => calls.filter((c) => c.url.includes('/access-check'));

describe('Access checker route picker', () => {
  const route = () => document.getElementById('ac-route') as HTMLSelectElement;
  const choose = (sel: HTMLSelectElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });

  it('offers every site\'s declared routes and fills method, path and site from one', async () => {
    mount();
    await settle();
    const labels = [...route().querySelectorAll('option')].map((o) => o.textContent);
    expect(labels).toContain('GET /api/clusters/:id → fleet:read');
    expect(labels).toContain('DELETE /api/clusters/:id → fleet:write');
    expect(labels).toContain('GET /invoices');
    await choose(route(), 'fleet DELETE /api/clusters/:id');
    expect((document.getElementById('ac-method') as HTMLSelectElement).value).toBe('DELETE');
    expect((document.getElementById('ac-path') as HTMLInputElement).value).toBe('/api/clusters/:id');
    expect((document.getElementById('ac-app') as HTMLSelectElement).value).toBe('fleet');
    // With a site chosen, only its routes are offered.
    expect([...route().querySelectorAll('option')].map((o) => o.textContent)).not.toContain('GET /invoices');
  });
});

describe('Access checker quick find', () => {
  it('offers people as you type, debounced, and loads one into the checker with one click', async () => {
    window.location.hash = '#/access-check?path=/api/fleet/clusters';
    mount();
    await settle();
    type(email(), 'a');
    type(email(), 'al');
    type(email(), 'ali');
    await settle(300);
    const lookups = calls.filter((c) => c.url.includes('/admin/users/lookup'));
    expect(lookups).toHaveLength(1);
    expect(lookups[0].url).toContain('q=ali');

    const option = document.querySelector('[role="option"]');
    expect(option?.getAttribute('aria-label')).toBe('Alice <alice@example.com> · groups: ops · 2FA on');
    act(() => { option!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    await settle();

    expect(email().value).toBe('alice@example.com');
    expect(document.querySelector('[aria-label="Person being checked"]')?.textContent).toContain(ID);
    expect(checks()).toHaveLength(1);
    expect(checks()[0].body).toMatchObject({ email: 'alice@example.com', path: '/api/fleet/clusters' });
    // The address written back names the person by id, which survives a change of email.
    expect(window.location.hash).toContain(`user=${ID}`);
  });

  it('picks the highlighted person with Enter', async () => {
    mount();
    await settle();
    type(email(), 'alice');
    await settle(300);
    key(email(), 'Enter');
    await settle();
    expect(email().value).toBe('alice@example.com');
    expect(checks()).toHaveLength(0); // no route yet: loaded, not run
  });

  it('resolves a deep link by Kratos id and runs the check', async () => {
    window.location.hash = `#/access-check?user=${ID}&method=GET&path=/api/fleet/clusters`;
    mount();
    await settle();
    expect(email().value).toBe('alice@example.com');
    expect(checks()).toHaveLength(1);
    expect(checks()[0].body).toMatchObject({ email: 'alice@example.com' });
  });

  it('still takes a deep link by email, and runs at once', async () => {
    window.location.hash = '#/access-check?user=alice@example.com&path=/api/fleet/clusters';
    mount();
    await settle();
    expect(email().value).toBe('alice@example.com');
    expect(checks()).toHaveLength(1);
  });

  it('stays a plain email field against a server without the lookup', async () => {
    lookupStatus = 404;
    mount();
    await settle();
    type(email(), 'alice@example.com');
    await settle(300);
    expect(document.querySelector('[role="option"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Nobody matches');
  });
});
