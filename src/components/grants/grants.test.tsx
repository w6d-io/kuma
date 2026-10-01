import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, type } from '../ui/testing';

// Individual access: the list (reason, who granted, the countdown), the picker (roles with what they
// carry, permissions by resource, the recent-2FA mark, optional reason and expiry), and refusals named
// one by one with what is missing and who could.

const U = 'uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu';
const h = vi.hoisted(() => ({ toasts: [] as unknown[][] }));
vi.mock('../../auth/session', () => ({ bearerToken: async () => null }));
vi.mock('../../contexts/AppContext', () => ({
  useApp: () => ({
    state: { services: [{ name: 'jinbe', system: true }, { name: 'payroll' }], roles: { jinbe: { support: ['users:read', 'users:delete'] }, payroll: { editor: ['pay:write'] } } },
    pushToast: (...a: unknown[]) => h.toasts.push(a),
  }),
}));

import { IndividualAccess } from './IndividualAccess';

type Call = { method: string; url: string; body?: unknown };
let calls: Call[] = [];
let grants: unknown[] = [];
let put: { status: number; body: unknown } = { status: 200, body: { grants: [] } };
const puts = () => calls.filter((c) => c.method === 'PUT');

beforeEach(() => {
  calls = [];
  h.toasts = [];
  grants = [];
  put = { status: 200, body: { grants: [] } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const path = new URL(c.url, 'http://x').pathname.replace(/^\/api/, '');
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (path === `/admin/users/${U}/grants` && c.method === 'GET') return ok({ grants });
    if (path === `/admin/users/${U}/grants` && c.method === 'PUT') return ok(put.body, put.status);
    if (path === '/catalog') return ok({ permissions: [{ name: 'users:delete', label: 'Delete a user', stepUp: true }, { name: 'users:read', label: 'Find users' }], roles: [] });
    if (path === '/whoami') return ok({ authenticated: true, email: 'sam@example.com', permissions: [] });
    return ok({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function settle() { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <IndividualAccess userId={U} who="bob@example.com" mayGrant pushToast={(...a: unknown[]) => h.toasts.push(a)} />
  </QueryClientProvider>,
);
const text = () => document.body.textContent ?? '';
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;
const box = (name: string) => [...document.querySelectorAll('label')].find((l) => [...l.querySelectorAll('.mono')].some((m) => m.textContent === name))?.querySelector('input') ?? null;

describe('IndividualAccess', () => {
  it('lists each grant with its reason, who granted it and the countdown', async () => {
    grants = [
      { id: 'g1', scope: 'platform', app: 'payroll', kind: 'role', name: 'editor', reason: 'covering the close', grantedBy: 'ops@example.com', grantedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      { id: 'g2', scope: 'platform', app: 'jinbe', kind: 'permission', name: 'users:read' },
    ];
    mount();
    await settle();
    expect(text()).toContain('editor');
    expect(text()).toContain('on payroll');
    expect(text()).toContain('covering the close');
    expect(text()).toContain('by ops@example.com');
    expect(text()).toContain('expires in 3 days');
    expect(text()).toContain('no reason given');
    expect(text()).toContain('no expiry');
  });

  it('grants picked roles and permissions with an optional reason and expiry, and marks step-up permissions', async () => {
    mount();
    await settle();
    await act(async () => { button('Add individual access')!.click(); });
    await settle();
    // jinbe's role shows what it carries; a step-up permission carries the mark.
    expect(text()).toContain('users:read · users:delete');
    expect(box('users:delete')?.closest('label')?.textContent).toContain('recent 2FA');
    await act(async () => { box('users:read')!.click(); });
    type(document.querySelector('input[placeholder^="e.g. covering"]'), 'OPS-123');
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent === '1 week')!.click(); });
    await settle();
    expect(text()).toContain('expires in 7 days');
    await act(async () => { button('Grant')!.click(); });
    await settle();
    const body = puts()[0]?.body as { grants: Array<Record<string, unknown>> };
    expect(body.grants).toHaveLength(1);
    expect(body.grants[0]).toMatchObject({ scope: 'platform', app: 'jinbe', kind: 'permission', name: 'users:read', reason: 'OPS-123' });
    expect(Date.parse(String(body.grants[0].expiresAt)) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(h.toasts.at(-1)?.[0]).toBe('Granted users:read to bob@example.com');
  });

  it('sends no reason and no expiry when none is given, and names each refusal', async () => {
    put = { status: 403, body: { error: 'Forbidden', code: 'grant_exceeds_own', message: 'refused', refused: [{ grant: { scope: 'platform', app: 'jinbe', kind: 'permission', name: 'users:delete' }, reasons: ['missing_permissions'], missing: ['users:delete'], grantedBy: ['super_admins'] }] } };
    mount();
    await settle();
    await act(async () => { button('Add individual access')!.click(); });
    await settle();
    await act(async () => { box('users:delete')!.click(); });
    await act(async () => { button('Grant')!.click(); });
    await settle();
    expect((puts()[0]?.body as { grants: unknown[] }).grants).toEqual([{ scope: 'platform', app: 'jinbe', kind: 'permission', name: 'users:delete' }]);
    expect(text()).toContain('Nothing was granted. Refused:');
    expect(text()).toContain('it gives what you do not hold');
    expect(text()).toContain('you would need users:delete');
    expect(text()).toContain('held through super_admins');
  });
});
