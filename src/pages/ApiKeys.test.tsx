import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render, type } from '../components/ui/testing';

// An organization's API keys: scopes as compact tags, a create drawer whose scopes are ticked by site
// (never typed while a catalogue exists), the secret shown once with a confirm before closing
// uncopied — and nothing about personal keys, which belong to people, not to organizations.

const ORG = '3cb95fec-bc9f-48b1-8fa7-f3da8ed9fff8';
const ME = 'a1b2c3d4-0000-4000-8000-000000000001';
const api = vi.hoisted(() => ({
  listApiKeys: vi.fn(),
  apiKeyScopes: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../api/accounts', () => ({ accountsApi: api }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pageParam: ORG, setPage: vi.fn(), pushToast: api.toast }) }));
vi.mock('../api/orgCatalog', () => ({ useOrgCatalog: () => ({ orgs: [{ id: ORG, name: 'test-org' }], isLoading: false, error: null }) }));
vi.mock('../api/hooks', () => ({
  useSession: () => ({ data: { identity_id: ME, groups: ['admins'], permissions: [] } }),
  useUserIdentity: () => ({ data: undefined }),
}));

import { ApiKeysPage } from './ApiKeys';

const key = {
  client_id: '15b59756-cfe7-45e6-8173-51026fe0a065', organization_id: ORG, label: 'test keys',
  scopes: ['fleet:read', 'fleet:write', 'wiki:read', 'crm:read'], created_by: ME, created_at: '2026-09-20T10:00:00Z', expires_at: null,
};

async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ApiKeysPage /></QueryClientProvider>);
const button = (label: RegExp) => [...document.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
// The drawer's own button, not the page's one behind it.
const inDrawer = (label: RegExp) => [...document.querySelectorAll('.drawer button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
const text = () => document.body.textContent ?? '';

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listApiKeys.mockResolvedValue({ data: [key], total: 1 });
  api.apiKeyScopes.mockResolvedValue([{ scope: 'fleet:write', sites: ['fleet'] }, { scope: 'fleet:read', sites: ['fleet'] }, { scope: 'wiki:read', sites: ['wiki'] }]);
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
  });

  it('ticks scopes by site, starts on a read scope, and shows the secret once with a confirm before closing uncopied', async () => {
    api.createApiKey.mockResolvedValue({ ...key, label: 'Billing sync', client_secret: 'hk_secret', scopes: ['fleet:read'] });
    mount();
    await settle();
    click(button(/^Create key$/));
    await settle();
    const legends = [...document.querySelectorAll('.checklist legend')].map((l) => l.textContent);
    expect(legends).toEqual(['fleet', 'wiki']);
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
    mount();
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
