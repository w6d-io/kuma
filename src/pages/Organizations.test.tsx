import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, type } from '../components/ui/testing';

const ACME = '11111111-1111-4111-8111-111111111111';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const h = vi.hoisted(() => ({
  pageParam: null as string | null,
  toasts: [] as unknown[][],
  setPage: vi.fn(),
  permissions: ['admin.organisation:read', 'admin.organisation:write'] as string[],
}));
vi.mock('../auth/session', () => ({ bearerToken: async () => null }));
vi.mock('../contexts/AppContext', () => ({
  useApp: () => ({
    pageParam: h.pageParam,
    setPage: (page: string, param: string | null) => { h.setPage(page, param); h.pageParam = param; },
    pushToast: (...a: unknown[]) => h.toasts.push(a),
    setUserDrawer: vi.fn(),
  }),
}));

import { OrganizationsPage } from './Organizations';

type Call = { method: string; url: string; body?: unknown };
let calls: Call[] = [];
let orgs: Array<{ id: string; name: string; tenant: string; applications: string[] }> = [];
let members: Record<string, unknown>[] = [];
let listStatus = 200;
let listBody: unknown = null;

beforeEach(() => {
  calls = [];
  h.toasts = [];
  h.pageParam = null;
  h.permissions = ['admin.organisation:read', 'admin.organisation:write'];
  orgs = [];
  members = [];
  listStatus = 200;
  listBody = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const path = new URL(c.url, 'http://x').pathname.replace(/^\/api/, '');
    const ok = (b: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (path === '/whoami') return ok({ authenticated: true, email: 'sam@example.com', permissions: h.permissions, groups: ['admins'] });
    if (path === '/admin/organizations' && c.method === 'GET') return listStatus === 200 ? ok({ organizations: orgs }) : ok(listBody, listStatus);
    if (path === '/admin/organizations' && c.method === 'POST') {
      const body = c.body as { name: string; tenant?: string };
      const created = { id: ACME, name: body.name, tenant: body.tenant ?? 'acme-corp', applications: [] };
      orgs = [...orgs, created];
      return ok(created, 201);
    }
    if (path === `/admin/organizations/${ACME}` && c.method === 'DELETE') {
      if (members.length > 0) return ok({ error: 'organisation_in_use', message: 'still has members', members: members.length }, 409);
      orgs = [];
      return ok(null, 204);
    }
    if (path === `/organizations/${ACME}/users`) return ok({ data: members, total: members.length });
    if (path === '/admin/rbac/org-admin-map') return ok({ mappings: {} });
    if (path === `/organizations/${ACME}/assignable-groups`) return ok({ groups: [] });
    if (path === '/admin/rbac/services') return ok({ services: [] });
    return ok({}, 200);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OrganizationsPage /></QueryClientProvider>,
);
const text = () => document.body.textContent ?? '';
const button = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });

describe('Organizations', () => {
  it('says organisations are not configured only when jinbe says there is truly no store', async () => {
    listStatus = 503;
    listBody = { error: 'organisation_directory_unavailable', reason: 'not_configured', message: 'No organisation database is configured: set ORGANISATION_DATABASE_URL, or ORGANISATION_STORE=kratos to keep organisations in Kratos and Redis.' };
    mount();
    await settle();
    expect(text()).toContain("Organisations aren't configured on this deployment");
    expect(button('Create organization')).toBeNull();
  });

  it('an outage is an outage, not an empty directory', async () => {
    listStatus = 503;
    listBody = { error: 'organisation_directory_unavailable', message: 'The organisation registry could not be read: ECONNREFUSED' };
    mount();
    await settle();
    expect(text()).not.toContain('No organization yet');
    expect(text()).not.toContain("aren't configured");
    expect(button('Retry')).not.toBeNull();
  });

  it('creates the first organisation from a name, showing the tenant it will derive', async () => {
    mount();
    await settle();
    expect(text()).toContain('No organization yet');
    click(button('Create organization'));
    await settle();
    type(document.getElementById('org-name'), 'Acme Corp');
    await settle();
    expect(text()).toContain('acme-corp');
    click(button('Create'));
    await settle();
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/admin/organizations'));
    expect(post?.body).toEqual({ name: 'Acme Corp' });
    expect(h.setPage).toHaveBeenCalledWith('organizations', ACME);
    expect(h.toasts[0][0]).toBe('Created Acme Corp');
  });

  it('refuses a name that yields no tenant, before sending anything', async () => {
    mount();
    await settle();
    click(button('Create organization'));
    await settle();
    type(document.getElementById('org-name'), '***');
    click(button('Create'));
    await settle();
    expect(text()).toMatch(/no letters or digits to make a tenant/);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('offers no create, edit or delete to somebody who may only read', async () => {
    h.permissions = ['admin.organisation:read'];
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme', applications: [] }];
    mount();
    await settle();
    expect(text()).toContain('Acme');
    expect(button('Create organization')).toBeNull();
    expect(button('Edit')).toBeNull();
    expect(button('Delete')).toBeNull();
  });

  it('will not delete an organisation that still has people', async () => {
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme', applications: [] }];
    members = [{ id: BOB, traits: { email: 'bob@example.com' }, state: 'active', metadata_admin: {} }];
    mount();
    await settle();
    click(button('Delete'));
    await settle();
    expect(text()).toContain('It still has 1 member');
    click(button('Delete organization'));
    await settle();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('deletes an empty organisation after its name is typed', async () => {
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme', applications: [] }];
    mount();
    await settle();
    click(button('Delete'));
    await settle();
    const confirm = [...document.querySelectorAll('input')].at(-1)!;
    type(confirm, 'Acme');
    click(button('Delete organization'));
    await settle();
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/admin/organizations/${ACME}`))).toBe(true);
    expect(h.toasts.at(-1)?.[0]).toBe('Deleted Acme');
  });
});
