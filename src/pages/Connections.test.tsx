import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render, type } from '../components/ui/testing';

// Connections & keys: a person's own MCP keys. Off on the platform (404) is a calm state, not an
// error; a key belongs to no organization, carries all the person's permissions unless narrowed,
// lives 30 days at most, and is shown once with how to paste it.

const api = vi.hoisted(() => ({
  listMyApiKeys: vi.fn(),
  createMyApiKey: vi.fn(),
  revokeMyApiKey: vi.fn(),
  myApiKeyScopes: vi.fn(),
  listMcpConnections: vi.fn(),
  revokeMcpConnection: vi.fn(),
  revokeAllMcpConnections: vi.fn(),
  toast: vi.fn(),
  status: { data: undefined as unknown },
}));
vi.mock('../api/accounts', () => ({ accountsApi: api }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pushToast: api.toast }) }));
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
  [api.listMyApiKeys, api.createMyApiKey, api.revokeMyApiKey, api.myApiKeyScopes, api.toast,
    api.listMcpConnections, api.revokeMcpConnection, api.revokeAllMcpConnections].forEach((f) => f.mockReset());
  api.listMcpConnections.mockRejectedValue(err(404));
  api.status.data = undefined;
  api.listMyApiKeys.mockResolvedValue({ data: [], total: 0 });
  api.myApiKeyScopes.mockResolvedValue([
    { scope: 'users:read', group: 'users' },
    { scope: 'admin:read', group: 'admin' },
    { scope: 'audit:read', group: 'audit' },
  ]);
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

  it('lists your keys without the mcp scope or an organization, and shows how to connect a client', async () => {
    (window as unknown as { __MCP_SERVER_URL__: string }).__MCP_SERVER_URL__ = 'https://mcp.dev.example.com/mcp';
    api.listMyApiKeys.mockResolvedValue({ data: [
      { client_id: 'c1', organization_id: null, label: 'Laptop', scopes: ['users:read', 'mcp'], all_permissions: false, created_by: 'me', created_at: '2026-09-27T10:00:00Z', expires_at: '2026-10-27T10:00:00Z', kind: 'personal' },
      { client_id: 'c2', organization_id: null, label: 'Desktop', scopes: ['mcp'], all_permissions: true, created_by: 'me', created_at: '2026-09-27T10:00:00Z', expires_at: '2026-10-27T10:00:00Z', kind: 'personal' },
    ], total: 2 });
    mount();
    await settle();
    expect(text()).toContain('Laptop');
    expect([...document.querySelectorAll('th')].map((t) => t.textContent)).not.toContain('Organization');
    expect([...document.querySelectorAll('.tag-list .badge')].map((b) => b.textContent)).toEqual(['users:read']);
    expect(text()).toContain('All my permissions');
    expect((document.querySelector('.copy-field input') as HTMLInputElement).value).toBe('https://mcp.dev.example.com/mcp');
    expect(text()).toContain("export example_MCP_KEY='stk_mcp_<your key>'");
    expect(text()).toContain('claude mcp add --transport http --scope user example https://mcp.dev.example.com/mcp');
    expect(text()).toContain('Authorization: Bearer $example_MCP_KEY');
  });

  it('walks through each client in its own tab, then what a key can do and what refusals mean', async () => {
    (window as unknown as { __MCP_SERVER_URL__: string }).__MCP_SERVER_URL__ = 'https://mcp.dev.example.com/mcp';
    api.status.data = { enabled: true, serverUrl: null, off: null, personalKeys: { maxDays: 7 } };
    mount();
    await settle();
    const tabs = [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent);
    expect(tabs).toEqual(['Claude Code', 'Claude Desktop', 'Cursor', 'VS Code', 'curl']);
    click(button(/^Claude Desktop$/));
    expect(text()).toContain('"mcp-remote"');
    expect(text()).toContain('"AUTH_HEADER": "Bearer stk_mcp_<your key>"');
    click(button(/^Cursor$/));
    expect(text()).toContain('"Authorization": "Bearer ${env:example_MCP_KEY}"');
    click(button(/^VS Code$/));
    expect(text()).toContain('"type": "http"');
    expect(text()).toContain('${input:example-mcp-key}');
    click(button(/^curl$/));
    expect(text()).toContain('"method":"tools/list"');
    expect(document.querySelector('[role=tabpanel]')!.getAttribute('aria-labelledby')).toBe('mcp-client-tab-curl');
    expect(text()).toContain('7 days at most on this platform');
    expect(text()).toContain('deletes are made by hand in the console');
    expect(text()).toContain('403 mcp_disabled — not enabled for your groups');
    expect(text()).toContain('503 retry_later');
  });

  it('creates a key with all your permissions by default, without asking for an organization, and shows it once', async () => {
    api.createMyApiKey.mockResolvedValue({ client_id: 'c2', organization_id: null, label: 'Laptop', scopes: ['mcp'], all_permissions: true, created_by: 'me', created_at: 't', expires_at: '2026-10-28T10:00:00Z', kind: 'personal', client_secret: 's', key: 'stk_mcp_c2.s' });
    mount();
    await settle();
    click(button(/^Create key$/));
    await settle();
    expect(document.querySelector('.drawer')!.textContent).not.toContain('Organization');
    expect(api.myApiKeyScopes).not.toHaveBeenCalled();
    type(document.querySelector('input[placeholder="e.g. Assistant on my laptop"]'), 'Laptop');
    click(inDrawer(/^Create key$/));
    await settle();
    expect(api.createMyApiKey).toHaveBeenCalledWith({ label: 'Laptop', expires_in_days: 30, allow_step_up_actions: true });
    expect((document.querySelector('.drawer .copy-field input') as HTMLInputElement).value).toBe('stk_mcp_c2.s');
    expect(document.querySelector('.drawer')!.textContent).toContain('with all your permissions');
    expect(document.querySelector('.drawer')!.textContent).toContain("export example_MCP_KEY='stk_mcp_c2.s'");
    click([...document.querySelectorAll('.drawer [role=tab]')].find((t) => t.textContent === 'Claude Desktop')!);
    expect(document.querySelector('.drawer')!.textContent).toContain('"AUTH_HEADER": "Bearer stk_mcp_c2.s"');
  });

  it('narrows a key to permissions ticked from your own, grouped by resource', async () => {
    api.createMyApiKey.mockResolvedValue({ client_id: 'c3', organization_id: null, label: 'Reader', scopes: ['users:read', 'mcp'], all_permissions: false, created_by: 'me', created_at: 't', expires_at: '2026-10-28T10:00:00Z', kind: 'personal', client_secret: 's', key: 'stk_mcp_c3.s' });
    mount();
    await settle();
    click(button(/^Create key$/));
    await settle();
    type(document.querySelector('input[placeholder="e.g. Assistant on my laptop"]'), 'Reader');
    const chosen = [...document.querySelectorAll<HTMLInputElement>('.drawer input[type=radio]')].find((r) => r.value === 'chosen')!;
    click(chosen);
    await settle();
    const drawer = document.querySelector('.drawer')!.textContent!;
    expect(drawer).toContain('Administration');
    expect(drawer).toContain('Audit trail');
    expect(drawer).toContain('Users');
    // Nothing ticked yet: nothing to create.
    expect(inDrawer(/^Create key$/).disabled).toBe(true);
    const users = [...document.querySelectorAll<HTMLElement>('.drawer label')].find((l) => l.textContent?.startsWith('users:read'))!;
    click(users);
    click(inDrawer(/^Create key$/));
    await settle();
    expect(api.createMyApiKey).toHaveBeenCalledWith({ label: 'Reader', scopes: ['users:read'], expires_in_days: 30, allow_step_up_actions: true });
    expect(document.querySelector('.drawer')!.textContent).toContain('with the permissions you chose');
  });

  it('says when your groups may not use AI assistants', async () => {
    api.status.data = { enabled: true, serverUrl: null, off: null, personalKeys: { maxDays: 30 }, allowed: false };
    api.createMyApiKey.mockRejectedValue(err(403, { details: { error: 'mcp_disabled', reason: 'group_not_allowed' } }));
    mount();
    await settle();
    expect(text()).toContain('AI assistants are not enabled for your groups');
    click(button(/^Create key$/));
    await settle();
    type(document.querySelector('input[placeholder="e.g. Assistant on my laptop"]'), 'Laptop');
    click(inDrawer(/^Create key$/));
    await settle();
    expect(document.querySelector('.field-error')!.textContent).toContain('not enabled for your groups');
    expect(api.toast).not.toHaveBeenCalled();
    expect(inDrawer(/^Create key$/).disabled).toBe(true);
  });

  describe('signed-in apps', () => {
    const hour = 3_600_000;
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();
    const apps = [
      { client_id: 'c1', client_name: 'Claude Code', redirect_host: 'localhost:53682', granted_at: at(-2 * hour), grant_expires_at: at(20 * 24 * hour),
        scope_mode: 'all', scopes: [], step_up_actions: true, step_up_until: at(3 * hour + 60_000), last_used_at: at(-60_000) },
      { client_id: 'c2', client_name: null, redirect_host: null, granted_at: at(-hour), grant_expires_at: at(2 * 24 * hour),
        scope_mode: 'chosen', scopes: ['users:read', 'audit:read'], step_up_actions: false, step_up_until: null, last_used_at: null },
    ];
    const inModal = (label: RegExp) => [...document.querySelectorAll('.modal-foot button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
    const row = (name: RegExp) => [...document.querySelectorAll('table[aria-label="Signed-in apps"] tbody tr')].find((r) => name.test(r.textContent ?? ''))!;

    it('is not shown on a jinbe without browser sign-in', async () => {
      mount();
      await settle();
      expect(text()).not.toContain('Signed-in apps');
      expect(document.querySelector('[role=alert]')).toBeNull();
    });

    it('lists each app with what it acts with, its protected-actions window and its dates', async () => {
      api.listMcpConnections.mockResolvedValue({ data: apps });
      mount();
      await settle();
      const claude = row(/Claude Code/).textContent!;
      expect(claude).toContain('name not verified');
      expect(claude).toContain('localhost:53682');
      expect(claude).toContain('All my permissions');
      expect(claude).toContain('3 h left');
      expect(claude).toContain('1 min ago');
      const other = row(/Unnamed app/).textContent!;
      expect(other).toContain('users:read');
      expect(other).toContain('Off');
      expect(other).toContain('Never');
    });

    it('disconnects one app after a confirmation, and all of them at once', async () => {
      api.listMcpConnections.mockResolvedValue({ data: apps });
      api.revokeMcpConnection.mockResolvedValue(undefined);
      api.revokeAllMcpConnections.mockResolvedValue(undefined);
      mount();
      await settle();
      click(document.querySelector('[aria-label="Disconnect Claude Code"]'));
      expect(text()).toContain('Disconnect Claude Code?');
      click(inModal(/^Disconnect$/));
      await settle();
      expect(api.revokeMcpConnection).toHaveBeenCalledWith('c1');
      expect(api.toast).toHaveBeenCalledWith('Disconnected Claude Code', expect.anything());

      click(button(/^Disconnect all$/));
      expect(text()).toContain('Disconnect all 2 apps?');
      click(inModal(/^Disconnect all$/));
      await settle();
      expect(api.revokeAllMcpConnections).toHaveBeenCalledWith(['c1', 'c2']);
    });

    it('says when there is none, and how an app signs in', async () => {
      api.listMcpConnections.mockResolvedValue({ data: [] });
      mount();
      await settle();
      expect(text()).toContain('No app signed in');
      expect(button(/^Disconnect all$/)).toBeUndefined();
    });
  });
});
