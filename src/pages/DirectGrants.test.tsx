import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '../components/ui/testing';

// The review page: everyone holding direct grants, the ones that need a look counted and filterable.

const h = vi.hoisted(() => ({ setPage: vi.fn(), permissions: ['users.grants:read'] as string[] }));
vi.mock('../auth/session', () => ({ bearerToken: async () => null }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ setPage: h.setPage, pushToast: vi.fn() }) }));

import { DirectGrantsPage } from './DirectGrants';

const day = 86_400_000;
let status = 200;
beforeEach(() => {
  status = 200;
  h.permissions = ['users.grants:read'];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = new URL(String(url), 'http://x').pathname.replace(/^\/api/, '');
    const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (path === '/whoami') return ok({ authenticated: true, email: 'sam@example.com', permissions: h.permissions });
    if (path === '/admin/grants') {
      if (status === 404) return ok({ message: 'Route GET:/api/admin/grants not found' }, 404);
      return ok({ people: [
        { id: 'u1', email: 'ann@example.com', grants: [{ id: 'a', scope: 'platform', app: 'jinbe', kind: 'permission', name: 'users:read', reason: 'support rota', expiresAt: new Date(Date.now() + 2 * day).toISOString() }] },
        { id: 'u2', email: 'ben@example.com', grants: [
          { id: 'b', scope: 'platform', app: 'payroll', kind: 'role', name: 'editor' },
          { id: 'c', scope: 'o1', app: 'jinbe', kind: 'permission', name: 'org.keys:read', reason: 'audit', expiresAt: new Date(Date.now() - day).toISOString(), active: false },
        ] },
      ] });
    }
    return ok({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function settle() { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DirectGrantsPage /></QueryClientProvider>);
const rows = () => [...document.querySelectorAll('tbody tr')];
const text = () => document.body.textContent ?? '';

describe('Direct grants', () => {
  it('lists everyone holding one, soonest expiry first, with what needs a look counted', async () => {
    mount();
    await settle();
    expect(rows()).toHaveLength(3);
    expect(rows()[0].textContent).toContain('org.keys:read');
    expect(rows()[0].textContent).toContain('expired');
    expect(rows()[2].textContent).toContain('no reason');
    expect(text()).toContain('3 grants');
    // Read-only without the grant permission: no remove buttons.
    expect(document.querySelector('button[aria-label^="Remove"]')).toBeNull();
  });

  it('filters to what has no reason, and to what never expires', async () => {
    mount();
    await settle();
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('No reason'))!.click(); });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('editor');
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Expiring in 7 days') && b.closest('.segmented'))!.click(); });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('users:read');
  });

  it('says the feature is not on this server yet rather than "nobody"', async () => {
    status = 404;
    mount();
    await settle();
    expect(text()).toContain('not available yet on this server');
  });
});
