import { describe, expect, it } from 'vitest';
import { accessChips, accessWord, filterHosts, hostAccess, hostFlags, hostTree, prefillWizardForHost, rewriteParts } from './hosts';
import { WIZARD_STORE } from './wizard';
import type { HostEntry, HostService } from './types';

// Sites by address: reading the grouped sites — search, flags, the path tree, the gateway rewrite.

const svc = (site: string, pathPrefix: string | null, over: Partial<HostService> = {}): HostService => ({
  site, displayName: site, pathPrefix, parent: null, kind: 'page', status: 'live', draft: false, pendingRequest: false, sharedBackendWith: [],
  upstream: { service: `${site}-svc`, namespace: 'apps', port: 80 },
  access: { public: false, signedIn: true, permissions: [], orgKeys: false },
  ...over,
});
const entry = (host: string, services: HostService[], counts: Partial<HostEntry['counts']> = {}): HostEntry => ({
  host, zone: 'dev.example.com', services, counts: { services: services.length, live: services.length, drafts: 0, pendingRequests: 0, ...counts },
});

describe('filterHosts', () => {
  const hosts = [entry('shell.dev.example.com', [svc('cab', '/cab', { displayName: 'Cab booking' })]), entry('api.dev.example.com', [svc('pricing', null)])];
  it('matches the host, a path, a backend, a site name or a title', () => {
    expect(filterHosts(hosts, '').length).toBe(2);
    expect(filterHosts(hosts, 'API.dev').map((h) => h.host)).toEqual(['api.dev.example.com']);
    expect(filterHosts(hosts, '/cab').map((h) => h.host)).toEqual(['shell.dev.example.com']);
    expect(filterHosts(hosts, 'pricing-svc.apps').map((h) => h.host)).toEqual(['api.dev.example.com']);
    expect(filterHosts(hosts, 'booking').map((h) => h.host)).toEqual(['shell.dev.example.com']);
    expect(filterHosts(hosts, 'nothing')).toEqual([]);
  });
});

describe('access and flags at a glance', () => {
  it('counts services per kind of access and flags what waits', () => {
    const services = [
      svc('a', null, { access: { public: true, signedIn: false, permissions: [], orgKeys: false }, sharedBackendWith: ['b'] }),
      svc('b', '/b', { access: { public: false, signedIn: false, permissions: ['x:read'], orgKeys: true } }),
    ];
    expect(hostAccess(services)).toEqual({ public: 1, signedIn: 0, permission: 1, orgKeys: 1 });
    expect(hostFlags(entry('h', services, { drafts: 2, pendingRequests: 1 }))).toEqual(['1 shared backend', '2 drafts waiting', '1 request to apply']);
    expect(hostFlags(entry('h', [svc('c', null)]))).toEqual([]);
  });

  it('words the access of a route and of a service', () => {
    expect(accessWord({ kind: 'public' })).toBe('Anyone');
    expect(accessWord({ kind: 'permission', permission: 'pay:read' })).toBe('pay:read');
    expect(accessWord({ kind: 'deny' })).toBe('Refused');
    expect(accessChips({ public: false, signedIn: false, permissions: ['a:read', 'b:read'], orgKeys: true }).map((c) => c.word)).toEqual(['2 permissions', 'org keys']);
  });
});

describe('hostTree', () => {
  it('draws each service under the one that encloses it, siblings by path', () => {
    const rows = hostTree([
      svc('pricing', '/cab/api/pricing', { parent: 'cab' }),
      svc('admin', '/admin', { parent: 'shell' }),
      svc('cab', '/cab', { parent: 'shell' }),
      svc('shell', null),
      svc('orphan', '/x', { parent: 'gone' }),
    ]);
    expect(rows.map((r) => [r.service.site, r.depth])).toEqual([['shell', 0], ['admin', 1], ['cab', 1], ['pricing', 2], ['orphan', 0]]);
  });
});

describe('rewriteParts', () => {
  it('splits out the stripped prefix and the added base path', () => {
    expect(rewriteParts('/api/v1/days', { service: 's', namespace: 'n', port: 80, stripPath: '/api/v1', path: '/api/external/' }))
      .toEqual({ before: '', stripped: '/api/v1', after: '/days', added: '/api/external' });
    expect(rewriteParts('/days', { service: 's', namespace: 'n', port: 80, stripPath: '/api/v1' })).toEqual({ before: '/days', stripped: null, after: '', added: null });
    expect(rewriteParts('/x', null)).toEqual({ before: '/x', stripped: null, after: '', added: null });
  });
});

describe('prefillWizardForHost', () => {
  it('splits the host on the longest known zone and stores the answers for Plug a site', () => {
    const store = new Map<string, string>();
    const s = prefillWizardForHost('shell.dev.example.com', ['example.com', 'dev.example.com'], { setItem: (k, v) => store.set(k, v) });
    expect([s.label, s.zone, s.pathPrefix]).toEqual(['shell', 'dev.example.com', '']);
    expect(JSON.parse(store.get(WIZARD_STORE)!)).toMatchObject({ label: 'shell', zone: 'dev.example.com' });
    expect(prefillWizardForHost('a.b.other.io', [], null)).toMatchObject({ label: 'a', zone: 'b.other.io' });
  });
});
