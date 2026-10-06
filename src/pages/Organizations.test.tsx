import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, type } from '../components/ui/testing';

const ACME = '11111111-1111-4111-8111-111111111111';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAROL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const h = vi.hoisted(() => ({
  pageParam: null as string | null,
  toasts: [] as unknown[][],
  setPage: vi.fn(),
  permissions: ['orgs:read', 'orgs:write', 'orgs:delete'] as string[],
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
let orgs: Array<{ id: string; name: string; tenant: string; owners?: string[]; sites?: string[] }> = [];
let invitations: Record<string, unknown>[] = [];
let createOwner: { status: 'owner' | 'invited' } = { status: 'owner' };
let members: Record<string, unknown>[] = [];
let listStatus = 200;
let listBody: unknown = null;
let orgPermissions: Record<string, string[]> = {};
let orgRoles: Array<{ role: string; permissions: string[]; assignable: boolean }> = [];
let memberRoles: Record<string, string[]> = {};
let rolesPut: { status: number; body: unknown } = { status: 200, body: null };

beforeEach(() => {
  calls = [];
  h.toasts = [];
  h.pageParam = null;
  h.permissions = ['orgs:read', 'orgs:write', 'orgs:delete'];
  orgs = [];
  members = [];
  invitations = [];
  createOwner = { status: 'owner' };
  listStatus = 200;
  listBody = null;
  orgPermissions = {};
  orgRoles = [];
  memberRoles = {};
  rolesPut = { status: 200, body: null };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const path = new URL(c.url, 'http://x').pathname.replace(/^\/api/, '');
    const ok = (b: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (path === '/whoami') return ok({ authenticated: true, email: 'sam@example.com', permissions: h.permissions, groups: ['admins'] });
    if (path === '/admin/organizations' && c.method === 'GET') return listStatus === 200 ? ok({ organizations: orgs }) : ok(listBody, listStatus);
    if (path === '/admin/organizations' && c.method === 'POST') {
      const body = c.body as { name: string; tenant?: string; owner: string };
      const created = { id: ACME, name: body.name, tenant: body.tenant ?? 'acme-corp' };
      orgs = [...orgs, created];
      return ok({
        ...created,
        owner: { email: body.owner, id: createOwner.status === 'owner' ? BOB : null, status: createOwner.status },
        ...(createOwner.status === 'invited' ? { invitation: { id: 'inv1', token: 'tok-123', link: 'https://login.example.com/invite?t=tok-123', expiresAt: '2026-10-20T00:00:00Z' } } : {}),
      }, 201);
    }
    if (path === `/admin/organizations/${ACME}` && c.method === 'DELETE') {
      if (members.length > 0) return ok({ error: 'organisation_in_use', message: 'still has members', members: members.length }, 409);
      orgs = [];
      return ok(null, 204);
    }
    if (path === `/organizations/${ACME}/users`) return ok({ data: members, total: members.length });
    if (path === `/organizations/${ACME}/invitations`) return ok({ invitations });
    if (path === `/admin/organizations/${ACME}/api-keys`) return ok({ data: [], total: 0 });
    if (path === '/admin/users' && c.url.includes('credentials_identifier=carol')) return ok({ data: [{ id: CAROL, traits: { email: 'carol@example.com' } }] });
    if (path === '/me/permissions') return ok({ permissions: h.permissions, orgPermissions });
    if (path === `/organizations/${ACME}/roles`) return ok({ roles: orgRoles });
    const member = path.match(new RegExp(`^/organizations/${ACME}/users/([^/]+)/roles$`));
    if (member && c.method === 'GET') return ok({ id: member[1], roles: memberRoles[member[1]] ?? [] });
    if (member && c.method === 'PUT') return rolesPut.status === 200 ? ok({ id: member[1], roles: (c.body as { roles: string[] }).roles }) : ok(rolesPut.body, rolesPut.status);
    if (path === `/admin/organizations/${ACME}/owners` && c.method === 'PUT') return ok({ owners: (c.body as { owners: string[] }).owners });
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

  it('creates the first organisation for its owner, showing the tenant it will derive', async () => {
    mount();
    await settle();
    expect(text()).toContain('No organization yet');
    click(button('Create organization'));
    await settle();
    type(document.getElementById('org-name'), 'Acme Corp');
    await settle();
    expect(text()).toContain('acme-corp');
    // No owner, nothing sent.
    click(button('Create'));
    await settle();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(text()).toContain('Give the owner’s email address.');
    type(document.getElementById('org-owner'), 'bob@example.com');
    click(button('Create'));
    await settle();
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/admin/organizations'));
    expect(post?.body).toEqual({ name: 'Acme Corp', owner: 'bob@example.com' });
    expect(h.setPage).toHaveBeenCalledWith('organizations', ACME);
    expect(h.toasts[0]).toEqual(['Created Acme Corp', { sub: 'bob@example.com is its owner' }]);
  });

  it('shows the owner invitation once when the address has no account', async () => {
    createOwner = { status: 'invited' };
    mount();
    await settle();
    click(button('Create organization'));
    await settle();
    type(document.getElementById('org-name'), 'Acme Corp');
    type(document.getElementById('org-owner'), 'new@acme.com');
    click(button('Create'));
    await settle();
    expect(text()).toContain('Send the invitation');
    expect((document.querySelector('.copy-field input') as HTMLInputElement).value).toBe('https://login.example.com/invite?t=tok-123');
    expect(h.setPage).not.toHaveBeenCalledWith('organizations', ACME);
    click(button('Done'));
    await settle();
    expect(h.setPage).toHaveBeenCalledWith('organizations', ACME);
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
    h.permissions = ['orgs:read'];
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme' }];
    mount();
    await settle();
    expect(text()).toContain('Acme');
    expect(button('Create organization')).toBeNull();
    expect(button('Edit')).toBeNull();
    expect(button('Delete')).toBeNull();
  });

  it('will not delete an organisation that still has people', async () => {
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme' }];
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
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme' }];
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

  it('shows the owners and the entitled sites read from the org roles, and no applications editor', async () => {
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme' }];
    members = [{ id: BOB, traits: { email: 'bob@example.com' }, state: 'active', metadata_admin: {} }];
    orgPermissions = { [ACME]: ['org.members:read'] };
    orgRoles = [{ role: 'jinbe:owner', permissions: ['org.members:write'], assignable: false }, { role: 'payroll:editor', permissions: ['pay:write'], assignable: false }];
    memberRoles = { [BOB]: ['jinbe:owner'] };
    mount();
    await settle();
    expect(text()).toContain('Owners');
    expect(text()).toContain('bob@example.com');
    expect(text()).toContain('payroll');
    expect(text()).not.toContain('legacy-app');
    expect(text()).not.toMatch(/Administrators|org admin roster|Applications/);
    // orgs:read alone: nobody's owners can be named from here.
    expect(button('Change owners')).toBeNull();
    // org.members:read but not :write here: the roles are shown, not editable.
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => b.disabled)).toBe(true);
    expect(calls.some((c) => c.url.includes('org-admin-map') || c.url.includes('assignable-groups') || c.url.includes('/grants'))).toBe(false);
  });

  it('names owners with orgs.owners:write: the whole list, by identity id', async () => {
    h.permissions = ['orgs:read', 'orgs.owners:write'];
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme' }];
    members = [{ id: BOB, traits: { email: 'bob@example.com' }, state: 'active', metadata_admin: {} }];
    orgPermissions = { [ACME]: ['org.members:read'] };
    mount();
    await settle();
    expect(text()).toContain('No owner yet');
    click(button('Name owners'));
    await settle();
    click([...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'bob@example.com') ?? null);
    await settle();
    // Nobody is named by a typed UUID: somebody else is found by address.
    expect(document.querySelector('input[aria-label="Add an owner by identity id"]')).toBeNull();
    type(document.querySelector('input[aria-label="Add an owner by email"]'), 'carol@example.com');
    click(button('Add'));
    await settle();
    expect(text()).toContain('carol@example.com');
    click(button('Save owners'));
    await settle();
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith(`/admin/organizations/${ACME}/owners`));
    expect(put?.body).toEqual({ owners: [BOB, CAROL] });
  });

  it('lists pending invitations, and the keys from the admin route, made on API keys (a link there for orgs.keys:write)', async () => {
    h.permissions = ['orgs:read', 'orgs.keys:write'];
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme' }];
    orgPermissions = { [ACME]: ['org.members:read'] };
    invitations = [{ id: 'i1', org: ACME, email: 'dana@example.com', roles: ['crm:user'], invitedBy: { id: null, email: 'sam@example.com' }, byPlatform: false, createdAt: '2026-10-05T10:00:00Z', expiresAt: '2099-10-19T10:00:00Z' }];
    mount();
    await settle();
    expect(text()).toContain('Pending invitations');
    expect(text()).toContain('dana@example.com');
    // org.members:read only: shown, not taken back.
    expect(button('Take back')).toBeNull();
    expect(calls.some((c) => c.method === 'GET' && c.url.endsWith(`/admin/organizations/${ACME}/api-keys`))).toBe(true);
    expect(button('Create key')).toBeNull();
    expect(button('Open in API keys')).not.toBeNull();
  });

  it('assigns a role per member and says why jinbe refused each one', async () => {
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme' }];
    members = [{ id: BOB, traits: { email: 'bob@example.com' }, state: 'active', metadata_admin: {} }];
    orgPermissions = { [ACME]: ['org.members:read', 'org.members:write'] };
    orgRoles = [{ role: 'jinbe:viewer', permissions: ['org.members:read'], assignable: true }, { role: 'jinbe:owner', permissions: ['org.keys:write'], assignable: false }];
    rolesPut = { status: 403, body: { error: 'Forbidden', message: 'Not allowed to assign: jinbe:viewer', refused: [{ role: 'jinbe:viewer', reason: 'grant_exceeds_own', missing: ['org.keys:read'] }] } };
    mount();
    await settle();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    // owner is not assignable by this caller: not addable; viewer is.
    expect(boxes.filter((b) => !b.disabled)).toHaveLength(1);
    await act(async () => { boxes.find((b) => !b.disabled)!.click(); });
    await settle();
    click(button('Save'));
    await settle();
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith(`/organizations/${ACME}/users/${BOB}/roles`));
    expect(put?.body).toEqual({ roles: ['jinbe:viewer'] });
    expect(text()).toContain('Nothing was saved for this person');
    expect(text()).toMatch(/jinbe:viewer — it carries permissions you do not hold here \(missing here: org\.keys:read\)/);
  });

  it('reads the owners and the entitled sites from the organisations list when jinbe sends them', async () => {
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme', owners: [BOB], sites: ['crm'] }];
    members = [{ id: BOB, traits: { email: 'bob@example.com' }, state: 'active', metadata_admin: {} }];
    orgPermissions = { [ACME]: ['org.members:read'] };
    mount();
    await settle();
    expect(text()).toContain('crm');
    expect(text()).not.toContain('legacy-app');
    const ownersCard = [...document.querySelectorAll('.fw-medium')].find((e) => e.textContent === 'Owners')!.closest('.card, [class*="card"]') ?? document.body;
    expect(ownersCard.textContent).toContain('bob@example.com');
    expect(calls.some((c) => c.url.includes(`/organizations/${ACME}/users/${BOB}/roles`) && c.method === 'GET')).toBe(true);
  });

  it('reads member roles off the member list, without one call per member, and never shows jinbe as a site', async () => {
    orgs = [{ id: ACME, name: 'Acme', tenant: 'acme', owners: [BOB], sites: ['jinbe', 'crm'] }];
    members = [{ id: BOB, traits: { email: 'bob@example.com' }, state: 'active', metadata_admin: {}, roles: ['jinbe:owner'] }];
    orgPermissions = { [ACME]: ['org.members:read'] };
    orgRoles = [{ role: 'jinbe:owner', permissions: ['org.members:write'], assignable: false }];
    mount();
    await settle();
    expect(calls.some((c) => /\/users\/[^/]+\/roles$/.test(new URL(c.url, 'http://x').pathname))).toBe(false);
    const owner = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0];
    expect(owner.checked).toBe(true);
    const sitesCard = [...document.querySelectorAll('.fw-medium')].find((e) => e.textContent === 'Sites')!.parentElement!;
    expect(sitesCard.textContent).toContain('crm');
    expect(sitesCard.textContent).not.toMatch(/\bjinbe\b/);
  });
});
