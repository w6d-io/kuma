import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, key, render } from '../../components/ui/testing';
import type { HostDetail, HostServiceDetail } from '../../lib/sites/types';

// Sites by address, one host: the path tree, the selected service in plain words, and the way into
// the existing editor — nothing is edited on this page.

type Q = { data?: unknown; error?: unknown; isLoading?: boolean; refetch?: () => void };
const h = vi.hoisted(() => ({
  host: {} as Q,
  hosts: {} as Q,
  perms: { canRead: true, canDraft: true, canApply: false },
}));
vi.mock('../../api/sites', () => ({
  useHost: () => h.host,
  useHosts: () => h.hosts,
  useZones: () => ({ data: [{ suffix: 'dev.example.com' }] }),
  notAvailable: (e: unknown) => (e as { notAvailable?: boolean } | undefined)?.notAvailable === true,
  sitesApi: { migration: async () => null },
}));
vi.mock('./usePerms', () => ({ useSitePerms: () => h.perms }));
vi.mock('../../api/hooks', () => ({ useSession: () => ({ data: { groups: ['g'] } }) }));
vi.mock('./Deletions', () => ({ DeletionsWaiting: () => null }));
vi.mock('./SitesList', () => ({ MigrationCallout: () => null }));

import { HostPage } from './HostPage';
import { AddressList } from './AddressList';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const service = (site: string, pathPrefix: string | null, over: Partial<HostServiceDetail> = {}): HostServiceDetail => ({
  site, displayName: site, pathPrefix, parent: null, kind: 'page', status: 'live', draft: false, pendingRequest: false, sharedBackendWith: [],
  upstream: { service: `${site}-svc`, namespace: 'apps', port: 80 },
  access: { public: false, signedIn: true, permissions: [], orgKeys: false },
  routes: [], catchAll: { access: { kind: 'signed-in' }, backendPath: `${pathPrefix ?? ''}/…` },
  ...over,
});
const HOST = 'shell.dev.example.com';
const detail = (services: HostServiceDetail[]): HostDetail => ({
  host: HOST, zone: 'dev.example.com', services, counts: { services: services.length, live: services.length, drafts: 0, pendingRequests: 0 },
});
const shell = detail([
  service('shell', null, { sharedBackendWith: ['cab'] }),
  service('cab', '/cab', { parent: 'shell', draft: true }),
  service('earnings', '/cab/api/earnings', {
    parent: 'cab', kind: 'api',
    upstream: { service: 'earning-service', namespace: 'stairling', port: 80, stripPath: '/cab/api', path: '/api/external' },
    access: { public: false, signedIn: false, permissions: ['earnings:read'], orgKeys: true },
    routes: [{ id: 'days', methods: ['GET'], path: '/cab/api/earnings/days', access: { kind: 'permission', permission: 'earnings:read' }, backendPath: '/api/external/earnings/days' }],
    catchAll: { access: { kind: 'deny' }, backendPath: '/api/external/earnings/…' },
  }),
]);

const text = () => document.body.textContent ?? '';
const button = (label: RegExp) => [...document.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement | undefined;
const items = () => [...document.querySelectorAll('[role="treeitem"]')] as HTMLElement[];
const mount = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
async function settle() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

beforeEach(() => {
  window.location.hash = '';
  sessionStorage.clear();
  h.host = { data: shell };
  h.perms.canDraft = true;
});
afterEach(cleanup);

describe('the host page', () => {
  it('draws the services as a tree nested by path, the first one selected', () => {
    mount(<HostPage host={HOST} query={{}} />);
    expect(items().map((i) => [i.querySelector('.host-tree-path')?.textContent, i.getAttribute('aria-level')])).toEqual([['/', '1'], ['/cab', '2'], ['/cab/api/earnings', '3']]);
    expect(items()[0].getAttribute('aria-selected')).toBe('true');
    expect(items()[0].textContent).toContain('also used by 1 other site');
    expect(text()).toContain('Same backend as');
  });

  it('shows the selected service: the rewrite, who gets in, API, routes with backend paths', () => {
    mount(<HostPage host={HOST} query={{ site: 'earnings' }} />);
    const flow = document.querySelector('.host-flow')!;
    expect(flow.querySelector('del')?.textContent).toBe('/cab/api');
    expect(flow.querySelector('ins')?.textContent).toBe('/api/external');
    expect(flow.textContent).toContain('earning-service.stairling:80');
    expect(text()).toContain('API: answers in JSON');
    expect(text()).toContain('org keys');
    const rows = [...document.querySelectorAll('table[aria-label="Routes of earnings"] tbody tr')].map((r) => r.textContent);
    expect(rows[0]).toContain('/api/external/earnings/days');
    expect(rows[1]).toContain('Refused');
  });

  it('selects with the keyboard and opens the existing editor tabs', () => {
    mount(<HostPage host={HOST} query={{}} />);
    key(items()[0], 'ArrowDown');
    expect(window.location.hash).toBe(`#/sites/hosts/${HOST}?site=cab`);
    click(button(/^Edit routes$/)!);
    expect(window.location.hash).toBe('#/sites/shell/routes');
    click(button(/^Edit access$/)!);
    expect(window.location.hash).toBe('#/sites/shell/access');
    click(button(/^Advanced$/)!);
    expect(window.location.hash).toBe('#/sites/shell/gates');
  });

  it('"Add a service here" opens Plug a site with the host filled in, for those who may draft', () => {
    mount(<HostPage host={HOST} query={{}} />);
    click(button(/Add a service here/)!);
    expect(window.location.hash).toBe('#/sites/new');
    expect(JSON.parse(sessionStorage.getItem('kuma.sites.wizard')!)).toMatchObject({ label: 'shell', zone: 'dev.example.com', pathPrefix: '' });
    cleanup();
    h.perms.canDraft = false;
    mount(<HostPage host={HOST} query={{}} />);
    expect(button(/Add a service here/)).toBeUndefined();
  });

  it('says so for an unknown host, and draws a refusal with Forbidden', () => {
    h.host = { error: { status: 404 } };
    mount(<HostPage host="nope.dev.example.com" query={{}} />);
    expect(text()).toContain('No site is on nope.dev.example.com');
    cleanup();
    h.host = { error: { status: 403, message: 'Forbidden' } };
    mount(<HostPage host={HOST} query={{}} />);
    expect(document.querySelector('.api-error.forbidden')).not.toBeNull();
  });
});

describe('the address list', () => {
  const entry = { ...shell, services: shell.services };
  it('shows one row per host with its services, access and flags; a click opens it', async () => {
    h.hosts = { data: [entry, { ...detail([service('other', null)]), host: 'other.dev.example.com' }] };
    mount(<AddressList query={{}} />);
    await settle();
    const rows = [...document.querySelectorAll('table[aria-label="Addresses"] tbody tr')];
    expect(rows.map((r) => r.querySelector('.mono')?.textContent)).toEqual([HOST, 'other.dev.example.com']);
    expect(rows[0].textContent).toContain('3 services');
    expect(rows[0].textContent).toContain('1 permission');
    expect(rows[0].textContent).toContain('1 shared backend');
    expect(rows[1].textContent).toContain('All live');
    click(rows[0].querySelector('button'));
    expect(window.location.hash).toBe(`#/sites/hosts/${HOST}`);
  });

  it('offers the flat list, says when nothing matches, and when nothing is plugged yet', async () => {
    h.hosts = { data: [entry] };
    mount(<AddressList query={{ q: 'zzz' }} />);
    await settle();
    expect(text()).toContain('No address, path, backend or site matches.');
    click([...document.querySelectorAll('button')].find((b) => /All sites/.test(b.textContent ?? ''))!);
    expect(window.location.hash).toContain('show=all');
    cleanup();
    h.hosts = { data: [] };
    mount(<AddressList query={{}} />);
    await settle();
    expect(text()).toContain('Put your first site behind sign-in');
  });

  it('falls back to "Show all sites" on an older jinbe, and draws a 403 with Forbidden', async () => {
    h.hosts = { error: { status: 404, notAvailable: true } };
    mount(<AddressList query={{}} />);
    await settle();
    expect(text()).toContain('Sites by address need a newer jinbe');
    cleanup();
    h.hosts = { error: { status: 403 } };
    mount(<AddressList query={{}} />);
    await settle();
    expect(document.querySelector('.api-error.forbidden')).not.toBeNull();
  });
});
