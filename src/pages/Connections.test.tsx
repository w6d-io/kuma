import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render, type } from '../components/ui/testing';

// Connections & keys: a person's own MCP keys. Off on the platform (404) is a calm state, not an
// error; a key is created in one organization, 30 days at most, and shown once with how to paste it.

const ORG = '3cb95fec-bc9f-48b1-8fa7-f3da8ed9fff8';
const api = vi.hoisted(() => ({
  listMyApiKeys: vi.fn(),
  createMyApiKey: vi.fn(),
  revokeMyApiKey: vi.fn(),
  apiKeyScopes: vi.fn(),
  myApiKeyScopes: vi.fn(),
  toast: vi.fn(),
  status: { data: undefined as unknown },
}));
vi.mock('../api/accounts', () => ({ accountsApi: api }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pushToast: api.toast }) }));
vi.mock('../api/orgCatalog', () => ({ useOrgCatalog: () => ({ orgs: [{ id: ORG, name: 'test-org' }], isLoading: false, error: null }) }));
vi.mock('../api/hooks', () => ({
  useSession: () => ({ data: { identity_id: 'me', groups: [], permissions: [] } }),
  useUserIdentity: () => ({ data: undefined }),
  useMcpStatus: () => api.status,
}));

import { ConnectionsPage } from './Connections';

const err = (status: number, extra: object = {}) => Object.assign(new Error('refused'), { status, ...extra });
async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ConnectionsPage /></QueryClientProvider>);
const inDrawer = (label: RegExp) => [...document.querySelectorAll('.drawer button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
const button = (label: RegExp) => [...document.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
const text = () => document.body.textContent ?? '';

beforeEach(() => {
  [api.listMyApiKeys, api.createMyApiKey, api.revokeMyApiKey, api.apiKeyScopes, api.myApiKeyScopes, api.toast].forEach((f) => f.mockReset());
  api.status.data = undefined;
  api.listMyApiKeys.mockResolvedValue({ data: [], total: 0 });
  // A member who does not manage the org's keys may not read its catalogue.
  api.apiKeyScopes.mockRejectedValue(err(403));
  api.myApiKeyScopes.mockRejectedValue(err(403));
});
afterEach(() => { cleanup(); delete (window as unknown as { __MCP_SERVER_URL__?: string }).__MCP_SERVER_URL__; });

describe('Connections & keys', () => {
  it('says calmly that personal keys are off on this platform', async () => {
    api.listMyApiKeys.mockRejectedValue(err(404));
    mount();
    await settle();
    expect(text()).toContain('Personal keys aren’t enabled on this platform');
    expect(document.querySelector('[role=alert]')).toBeNull();
    expect(button(/^Create key$/)).toBeUndefined();
  });

  it('says an administrator turned AI assistants off when the deployment allows them', async () => {
    api.status.data = { enabled: false, serverUrl: null, off: 'administrator', personalKeys: { maxDays: 30 } };
    api.listMyApiKeys.mockRejectedValue(err(404));
    mount();
    await settle();
    expect(text()).toContain('AI assistants are turned off by an administrator');
    expect(text()).not.toContain('aren’t enabled on this platform');
    expect(button(/^Create key$/)).toBeUndefined();
  });

  it('shows the server address an administrator set, before the console setting', async () => {
    (window as unknown as { __MCP_SERVER_URL__: string }).__MCP_SERVER_URL__ = 'https://mcp.env.example.com/mcp';
    api.status.data = { enabled: true, serverUrl: 'https://mcp.admin.example.com/mcp/', off: null, personalKeys: { maxDays: 7 } };
    mount();
    await settle();
    expect((document.querySelector('.copy-field input') as HTMLInputElement).value).toBe('https://mcp.admin.example.com/mcp');
  });

  it('offers expiries up to the administrator maximum only, defaulting to it', async () => {
    api.status.data = { enabled: true, serverUrl: null, off: null, personalKeys: { maxDays: 7 } };
    mount();
    await settle();
    click(button(/^Create key$/));
    await settle();
    const select = [...document.querySelectorAll<HTMLSelectElement>('.drawer select')].pop()!;
    expect([...select.options].map((o) => o.value)).toEqual(['1', '7']);
    expect(select.value).toBe('7');
  });

  it('lists your keys without the mcp scope, and shows how to connect a client', async () => {
    (window as unknown as { __MCP_SERVER_URL__: string }).__MCP_SERVER_URL__ = 'https://mcp.dev.example.com/mcp';
    api.listMyApiKeys.mockResolvedValue({ data: [{ client_id: 'c1', organization_id: ORG, label: 'Laptop', scopes: ['fleet:read', 'mcp'], created_by: 'me', created_at: '2026-09-27T10:00:00Z', expires_at: '2026-10-27T10:00:00Z', kind: 'personal' }], total: 1 });
    mount();
    await settle();
    expect(text()).toContain('Laptop');
    expect(text()).toContain('test-org');
    expect([...document.querySelectorAll('.tag-list .badge')].map((b) => b.textContent)).toEqual(['fleet:read']);
    expect((document.querySelector('.copy-field input') as HTMLInputElement).value).toBe('https://mcp.dev.example.com/mcp');
    expect(text()).toContain('"Authorization": "Bearer stk_mcp_…"');
  });

  it('creates a key in one organization for 30 days and shows it once, with the client configuration', async () => {
    api.createMyApiKey.mockResolvedValue({ client_id: 'c2', organization_id: ORG, label: 'Laptop', scopes: ['fleet:read', 'mcp'], created_by: 'me', created_at: 't', expires_at: '2026-10-28T10:00:00Z', kind: 'personal', client_secret: 's', key: 'stk_mcp_c2.s' });
    mount();
    await settle();
    click(button(/^Create key$/));
    await settle();
    // The org's catalogue is for its key managers: scopes are typed, and the reason is said.
    expect(text()).toContain('for its key managers');
    type(document.querySelector('input[placeholder="e.g. Assistant on my laptop"]'), 'Laptop');
    type(document.querySelector('input[placeholder="e.g. billing:read"]'), 'fleet:read');
    click(inDrawer(/^Create key$/));
    await settle();
    expect(api.createMyApiKey).toHaveBeenCalledWith({ label: 'Laptop', organization_id: ORG, scopes: ['fleet:read'], expires_in_days: 30 });
    expect((document.querySelector('.drawer .copy-field input') as HTMLInputElement).value).toBe('stk_mcp_c2.s');
    expect(document.querySelector('.drawer')!.textContent).toContain('"Authorization": "Bearer stk_mcp_c2.s"');
  });

  it('says on the organization field when the organization forbids personal keys', async () => {
    api.createMyApiKey.mockRejectedValue(err(403, { details: { error: 'Forbidden', details: { reason: 'personal_keys_forbidden' } } }));
    mount();
    await settle();
    click(button(/^Create key$/));
    await settle();
    type(document.querySelector('input[placeholder="e.g. Assistant on my laptop"]'), 'Laptop');
    type(document.querySelector('input[placeholder="e.g. billing:read"]'), 'fleet:read');
    click(inDrawer(/^Create key$/));
    await settle();
    expect(document.querySelector('.field-error')!.textContent).toContain('does not allow personal keys');
    expect(api.toast).not.toHaveBeenCalled();
    expect(inDrawer(/^Create key$/).disabled).toBe(true);
  });
});
