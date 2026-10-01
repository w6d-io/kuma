import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from './ui/testing';

const h = vi.hoisted(() => ({ toasts: [] as unknown[][], permissions: ['zones:read', 'zones:write', 'sites:read'] as string[] }));
vi.mock('../auth/session', () => ({ bearerToken: async () => null }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pushToast: (...a: unknown[]) => h.toasts.push(a) }) }));

import { ZonesSettings } from './ZonesSettings';

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let zone: Record<string, unknown> = {};
let dnsOnGateway = false;
let gateways: unknown[] = [];

const gateway = {
  key: 'envoy-gateway-system/eg', namespace: 'envoy-gateway-system', name: 'eg', exists: true, className: 'eg', addresses: ['envoy.elb'], programmed: true, message: '',
  listeners: [{ name: 'dev-example-https', hostname: '*.dev.example.com', port: 443, protocol: 'HTTPS', tls: true, routesFromAll: true, programmed: true, attachedRoutes: 3 }],
  protection: {
    waf: { policy: 'envoy-gateway-system/waf-coraza', modules: ['composer', 'coraza-waf'], accepted: true },
    ipReputation: { policy: 'envoy-gateway-system/eg-edge', backend: 'crowdsec/envoy-bouncer', failOpen: true, accepted: true },
    denylist: { policy: 'envoy-gateway-system/eg-edge' }, protected: true, summary: 'Every route is inspected by the WAF (composer, coraza-waf)',
  },
};

beforeEach(() => {
  calls = [];
  h.toasts = [];
  h.permissions = ['zones:read', 'zones:write', 'sites:read'];
  dnsOnGateway = false;
  gateways = [gateway];
  zone = { name: 'dev', suffix: 'dev.example.com', wildcard: '*.dev.example.com', cookieDomain: '.dev.example.com', sso: true, tls: 'wildcard', ingress: 'per-site', gateway: 'envoy-gateway-system/eg', ready: true, source: 'zone' };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', path: new URL(String(url), 'http://x').pathname.replace(/^\/api/, ''), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (c.path === '/whoami') return ok({ authenticated: true, email: 'sam@example.com', permissions: h.permissions, groups: ['admins'] });
    if (c.path === '/admin/sites/zones' && c.method === 'GET') return ok([zone]);
    if (c.path === '/admin/sites/gateways') return ok({ gateways });
    if (c.path === '/admin/sites/zones' && c.method === 'POST') return ok({ name: 'x', checks: [] }, 201);
    if (c.path === '/admin/sites/zones/dev' && c.method === 'PATCH') {
      const host = { host: 'echo-sandbox-tes.dev.example.com', addresses: ['51.44.199.227'] };
      if (!dnsOnGateway && !c.body?.confirm) {
        return ok({ error: 'dns_not_on_gateway', message: '1 site host(s) do not resolve to Gateway envoy-gateway-system/eg yet', checks: [{ level: 'error', code: 'dns_elsewhere', message: 'echo-sandbox-tes.dev.example.com resolves to 51.44.199.227, not to Gateway envoy-gateway-system/eg', ...host }] }, 409);
      }
      zone = { ...zone, ingress: 'none' };
      return ok({ name: 'dev', checks: [] });
    }
    return ok({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ZonesSettings /></QueryClientProvider>);
const text = () => document.body.textContent ?? '';
const button = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });
const selectIn = (label: string) => [...document.body.querySelectorAll('.field')].find((f) => f.querySelector('.field-label')?.textContent?.includes(label))?.querySelector('select') as HTMLSelectElement;
const typeIn = (el: Element, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const choose = (sel: HTMLSelectElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});

describe('Settings · Zones', () => {
  it('shows how each zone is reached and that the WAF can still be bypassed while nginx answers', async () => {
    mount();
    await settle();
    expect(text()).toContain('*.dev.example.com');
    expect(text()).toContain('nginx + Envoy (migrating)');
    expect(text()).toContain('Unprotected');
  });

  it('dropping the Ingress: DNS not yet on the Gateway is shown per host, and can be confirmed', async () => {
    mount();
    await settle();
    click(button('Edit exposure'));
    await settle();
    expect(selectIn('Gateway').value).toBe('envoy-gateway-system/eg');
    expect([...selectIn('Gateway').options].map((o) => o.textContent)).toContain('envoy-gateway-system/eg — protected by WAF');
    choose(selectIn('nginx Ingress'), 'none');
    click(button('Save'));
    await settle();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ ingress: 'none' });
    expect(text()).toContain('Some site hosts do not point at the Gateway yet');
    expect(text()).toContain('echo-sandbox-tes.dev.example.com resolves to 51.44.199.227');
    expect(h.toasts).toEqual([]);
    click(button('Drop the Ingress anyway'));
    await settle();
    expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ ingress: 'none', confirm: true });
    expect(button('Drop the Ingress anyway')).toBeNull();
    expect(text()).toContain('Protected');
  });

  it('offers no create or edit to somebody who may only read', async () => {
    h.permissions = ['zones:read', 'sites:read'];
    mount();
    await settle();
    expect(text()).toContain('Unprotected');
    expect(button('Edit exposure')).toBeNull();
    expect(button('Create zone')).toBeNull();
  });

  it('Create zone: the WAF-protected Gateway by default, nothing to confirm', async () => {
    mount();
    await settle();
    click(button('Create zone'));
    await settle();
    typeIn(document.querySelector('input[placeholder="apps.dev.example.com"]')!, 'shop.dev.example.com');
    await settle();
    expect(selectIn('Gateway').value).toBe('');
    typeIn(document.querySelector('input[placeholder="apps.dev.example.com"]')!, 'dev.example.com');
    await settle();
    expect(selectIn('Gateway').value).toBe('envoy-gateway-system/eg');
    expect(selectIn('nginx Ingress').value).toBe('none');
    expect(text()).not.toContain('This zone will have no WAF');
    click(button('Create'));
    await settle();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ domain: 'dev.example.com', ingress: 'none', tls: { mode: 'default' }, gateway: { namespace: 'envoy-gateway-system', name: 'eg' } });
  });

  it('Create zone on nginx while a protected Gateway exists: warned, confirmed, and sent as such', async () => {
    mount();
    await settle();
    click(button('Create zone'));
    await settle();
    typeIn(document.querySelector('input[placeholder="apps.dev.example.com"]')!, 'apps.dev.example.com');
    await settle();
    // no listener for *.apps.dev: the hint says how to get the WAF anyway
    expect(text()).toContain('This zone will have no WAF');
    expect(text()).toContain('choose "Issued for the zone" to put it behind the WAF');
    expect(button('Create')!.disabled).toBe(true);
    click(document.body.querySelector('input[type="checkbox"]'));
    await settle();
    click(button('Create'));
    await settle();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ domain: 'apps.dev.example.com', ingress: 'wildcard', tls: { mode: 'default' }, acknowledgeNoWaf: true });
  });

  it('no protected Gateway in the cluster: nginx, with a No WAF warning and nothing to confirm', async () => {
    gateways = [];
    mount();
    await settle();
    click(button('Create zone'));
    await settle();
    typeIn(document.querySelector('input[placeholder="apps.dev.example.com"]')!, 'apps.dev.example.com');
    await settle();
    expect(text()).toContain('No WAF-protected Gateway was found in the cluster');
    expect(button('Create')!.disabled).toBe(false);
  });

  it('reads the zone\'s own TLS mode: an issued certificate needs no Gateway listener for the zone', async () => {
    zone = { ...zone, name: 'authdev', suffix: 'authdev.dev.example.com', wildcard: '*.authdev.dev.example.com', ingress: 'none', tlsMode: 'issuer' };
    mount();
    await settle();
    await click(button('Edit exposure'));
    expect(text()).not.toContain('has no HTTPS listener');
    expect(button('Save')?.hasAttribute('disabled')).toBe(false);
    // The same zone on the Gateway's default certificate does need a covering listener.
    cleanup();
    zone = { ...zone, tlsMode: 'default' };
    mount();
    await settle();
    await click(button('Edit exposure'));
    expect(text()).toContain('has no HTTPS listener for *.authdev.dev.example.com');
  });
});
