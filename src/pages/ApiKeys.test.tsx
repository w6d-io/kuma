import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render, type } from '../components/ui/testing';

// API keys, the one place keys are made: an organization's keys as compact tags, listed and revoked;
// Create key for me (a personal key) or, for platform staff, for any organization picked in the form,
// whose scopes are ticked by kind (never typed while a catalogue exists), the secret shown once with a
// confirm before closing uncopied. My keys (personal) are tested with Connections.

const ORG = '3cb95fec-bc9f-48b1-8fa7-f3da8ed9fff8';
const OTHER = '9d0c1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const ME = 'a1b2c3d4-0000-4000-8000-000000000001';
const perms = vi.hoisted(() => ({ list: [] as string[] }));
const nav = vi.hoisted(() => ({ setPage: vi.fn() }));
const api = vi.hoisted(() => ({
  listApiKeys: vi.fn(),
  apiKeyScopes: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  listMyApiKeys: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../api/accounts', () => ({ accountsApi: api }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pageParam: ORG, setPage: nav.setPage, pushToast: api.toast }) }));
vi.mock('../api/orgCatalog', () => ({ useOrgCatalog: () => ({ orgs: [{ id: ORG, name: 'test-org' }, { id: OTHER, name: 'other-org' }], isLoading: false, error: null }) }));
vi.mock('../api/hooks', () => ({
  useSession: () => ({ data: { identity_id: ME, groups: ['admins'], permissions: perms.list } }),
  useUserIdentity: () => ({ data: undefined }),
  useMcpStatus: () => ({ data: undefined }),
}));

import { ApiKeysPage } from './ApiKeys';

const key = {
  client_id: '15b59756-cfe7-45e6-8173-51026fe0a065', organization_id: ORG, label: 'test keys',
  scopes: ['fleet:read', 'fleet:write', 'wiki:read', 'crm:read'], created_by: ME, created_at: '2026-09-20T10:00:00Z', expires_at: null,
};

async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const wrap = (el: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>);
const mount = () => wrap(<ApiKeysPage />);
// Staff holding orgs.keys:write: the page's Create key.
const mountStaff = () => { perms.list = ['orgs:read', 'orgs.keys:write']; return mount(); };
const button = (label: RegExp) => [...document.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
// The drawer's own button, not the page's one behind it.
const inDrawer = (label: RegExp) => [...document.querySelectorAll('.drawer button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
const text = () => document.body.textContent ?? '';

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  nav.setPage.mockReset();
  perms.list = [];
  api.listApiKeys.mockResolvedValue({ data: [key], total: 1 });
  // Personal keys off unless a test turns them on.
  api.listMyApiKeys.mockRejectedValue(Object.assign(new Error('off'), { status: 404 }));
  api.apiKeyScopes.mockResolvedValue([
    { scope: 'fleet:write', kind: 'permission', sites: ['fleet'], permissions: [] },
    { scope: 'fleet:read', kind: 'permission', sites: ['fleet'], permissions: [] },
    { scope: 'role:fleet:admin', kind: 'role', sites: ['fleet'], permissions: ['fleet:read', 'fleet:write'] },
    { scope: 'group:fleet-ops', kind: 'group', sites: ['fleet'], permissions: ['fleet:read'] },
  ]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('API keys', () => {
  it('lists keys with their scopes folded past three, who created them and when they expire', async () => {
    mount();
    await settle();
    expect(text()).toContain('test keys');
    expect(document.querySelector('.tag-list .badge.is-count')!.textContent).toBe('+2');
    expect(text()).toContain('by you');
    expect(text()).toContain('Never');
    // No last-use column while jinbe does not say it.
    expect([...document.querySelectorAll('th')].map((t) => t.textContent)).not.toContain('Last used');
    // Personal keys are not an organization's business: no policy card.
    expect(text()).not.toContain('Personal keys');
    // Somebody of the organization reads its own route, and creates nothing here.
    expect(api.listApiKeys).toHaveBeenCalledWith(ORG, 'org');
    expect(button(/Create/)).toBeUndefined();
  });

  it('offers staff who may create keys a Create key here, never a detour to Organizations, and lists from the admin route', async () => {
    mountStaff();
    await settle();
    expect(api.listApiKeys).toHaveBeenCalledWith(ORG, 'admin');
    expect(button(/^Create key$/)).toBeDefined();
    expect(button(/Organizations/)).toBeUndefined();
  });

  it('creates for any organization picked in the form, with that organization\'s catalogue, then shows its keys', async () => {
    api.createApiKey.mockResolvedValue({ ...key, organization_id: OTHER, label: 'Sync', client_secret: 'hk_secret', scopes: ['fleet:read'] });
    mountStaff();
    await settle();
    click(button(/^Create key$/));
    await settle();
    const picker = document.querySelector('.drawer select[aria-label="Key for"]') as HTMLSelectElement;
    expect(picker.value).toBe(ORG);
    await act(async () => { picker.value = OTHER; picker.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    expect(api.apiKeyScopes).toHaveBeenLastCalledWith(OTHER);
    type(document.querySelector('input[placeholder="e.g. Billing sync"]'), 'Sync');
    click(inDrawer(/^Create key$/));
    await settle();
    expect(api.createApiKey).toHaveBeenCalledWith(OTHER, { label: 'Sync', scopes: ['fleet:read'], expires_in_days: 90 });
    expect(nav.setPage).toHaveBeenCalledWith('apikeys', OTHER);
  });

  it('creates a personal key for somebody without orgs.keys:write, with no organization to pick; staff pick "Me" for one', async () => {
    api.listMyApiKeys.mockResolvedValue({ data: [], total: 0 });
    mount();
    await settle();
    click(button(/^Create key$/));
    await settle();
    expect(document.querySelector('.drawer')!.textContent).toContain('Create a personal key');
    expect(document.querySelector('.drawer select[aria-label="Key for"]')).toBeNull();
    cleanup();
    mountStaff();
    await settle();
    click(button(/^Create key$/));
    await settle();
    const picker = document.querySelector('.drawer select[aria-label="Key for"]') as HTMLSelectElement;
    await act(async () => { picker.value = ''; picker.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    expect(document.querySelector('.drawer')!.textContent).toContain('Create a personal key');
    expect(document.querySelector('.drawer')!.textContent).toContain('acts as you');
  });

  it('revokes through the admin route with orgs.keys:write, and through the org route otherwise', async () => {
    api.revokeApiKey.mockResolvedValue(undefined);
    for (const [held, route] of [[['orgs:read', 'orgs.keys:write'], 'admin'], [[], 'org']] as const) {
      perms.list = [...held];
      api.revokeApiKey.mockClear();
      mount();
      await settle();
      click(button(/^Revoke$/));
      await settle();
      click(button(/^Revoke key$/));
      await settle();
      expect(api.revokeApiKey).toHaveBeenCalledWith(ORG, key.client_id, route);
      cleanup();
    }
  });

  it('ticks scopes by kind, starts on a read scope, and shows the secret once with a confirm before closing uncopied', async () => {
    api.createApiKey.mockResolvedValue({ ...key, label: 'Billing sync', client_secret: 'hk_secret', scopes: ['fleet:read'] });
    mountStaff();
    await settle();
    click(button(/^Create key$/));
    await settle();
    const legends = [...document.querySelectorAll('.checklist legend')].map((l) => l.textContent);
    expect(legends).toEqual(['Permissions', 'Site roles', 'Groups']);
    const checked = [...document.querySelectorAll('.checklist-options input:checked')].map((i) => i.closest('label')!.textContent);
    expect(checked).toEqual(['fleet:readRead only']);
    expect(document.querySelector('input.mono[placeholder^="e.g. billing"]')).toBeNull();
    type(document.querySelector('input[placeholder="e.g. Billing sync"]'), 'Billing sync');
    click(inDrawer(/^Create key$/));
    await settle();
    expect(api.createApiKey).toHaveBeenCalledWith(ORG, { label: 'Billing sync', scopes: ['fleet:read'], expires_in_days: 90 });
    expect(text()).toContain('Copy the secret now');
    expect((document.querySelector('.copy-field input') as HTMLInputElement).value).toBe('hk_secret');
    click(button(/^Done$/));
    await settle();
    expect(text()).toContain('Close without copying the secret?');
    click(button(/^Close anyway$/));
    await settle();
    expect(text()).not.toContain('Copy the secret now');
  });

  it('closes at once once the secret was copied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } });
    api.createApiKey.mockResolvedValue({ ...key, client_secret: 'hk_secret' });
    mountStaff();
    await settle();
    click(button(/^Create key$/));
    await settle();
    type(document.querySelector('input[placeholder="e.g. Billing sync"]'), 'Sync');
    click(inDrawer(/^Create key$/));
    await settle();
    await act(async () => { button(/^Copy$/).click(); });
    click(button(/^Done$/));
    await settle();
    expect(text()).not.toContain('Close without copying');
    expect(text()).not.toContain('Copy the secret now');
  });
});
