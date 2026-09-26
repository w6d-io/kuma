import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render } from '../components/ui/testing';
import type { AuditEventV1, AuditEventsPage } from '../api/audit';

vi.mock('../auth/session', () => ({ bearerToken: async () => null }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ setPage: vi.fn(), pushToast: vi.fn(), auditFocus: null, setAuditFocus: vi.fn() }) }));
vi.mock('../api/hooks', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  return {
    useSession: () => ({ data: { permissions: ['admin:read'] } }),
    useMyOrganizationNames: () => ({ data: { acme: 'Acme' } }),
    useUserIdentity: (id: string | undefined, enabled = true) =>
      useQuery({ queryKey: ['user-identity', id], queryFn: async () => { throw new Error('unused'); }, enabled: !!id && enabled }),
  };
});

import { AuditPage } from './Audit';

const ev = (over: Partial<AuditEventV1> = {}): AuditEventV1 => ({
  event_id: 'e1', ts: new Date().toISOString(), event: 'access.denied', category: 'access', action: 'deny', result: 'denied',
  reason: 'not_member', actor: { type: 'user', id: '3f2a9c10-1111' }, target: { type: 'route', id: 'PUT /api/orgs/1' },
  org_id: 'acme', site: 'kuma', trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', ...over,
});
const page = (over: Partial<AuditEventsPage> = {}): AuditEventsPage => ({
  events: [ev()], nextCursor: null, scope: { orgs: [], platform: true }, range: { from: new Date(Date.now() - 7 * 864e5).toISOString(), to: new Date().toISOString() },
  truncated: false, ...over,
});
const facets = { facets: { event: [{ key: 'access.denied', count: 1 }], category: [], result: [{ key: 'denied', count: 1 }], site: [], actor: [] }, total: 1, truncated: false };
const summary = { window: '7d', total: 1, series: [{ t: new Date().toISOString(), total: 1, failed: 1 }] };

type Handler = (path: string) => [number, unknown];
function serve(handler: Handler) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const [status, body] = handler(String(url));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
}
const routes = (events: [number, unknown]): Handler => (p) => {
  if (p.startsWith('/api/audit/events/')) return [200, { event: ev(), chain: 'verified' }];
  if (p.startsWith('/api/audit/events')) return events;
  if (p.startsWith('/api/audit/facets')) return [200, facets];
  if (p.startsWith('/api/audit/summary')) return [200, summary];
  if (p.startsWith('/api/audit/saved-queries')) return [200, { queries: [{ id: 's1', name: 'Team denials', filters: { result: 'denied' }, shared: true, mine: false }] }];
  if (p.startsWith('/api/admin/organizations')) return [200, { organizations: [{ id: 'acme', name: 'Acme', tenant: 't' }] }];
  return [404, { message: `Route GET:${p} not found` }];
};

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AuditPage /></QueryClientProvider>);
}

beforeEach(() => { window.location.hash = '#/audit'; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AuditPage', () => {
  it('says "not available yet" on the router 404, not an empty log', async () => {
    serve(routes([404, { message: 'Route GET:/api/audit/events not found', error: 'Not Found' }]));
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Not available yet');
    expect(container.textContent).not.toContain('No events');
  });

  it('says outage on 503', { timeout: 5000 }, async () => {
    serve(routes([503, { error: 'audit_store_unavailable' }]));
    const { container } = mount();
    // An outage is retried once (after ~1 s) before it is shown.
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
    await flush();
    expect(container.textContent).toContain('This is an outage, not an empty log');
  });

  it('lists events with pseudonymous actors, facets and the org picker for a platform reader', async () => {
    serve(routes([200, page()]));
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('user · 3f2a9c10');
    expect(container.textContent).toContain('scope: all organisations');
    expect(container.querySelector('legend')?.textContent).toBe('Result');
    expect(container.querySelector('select[aria-label="Organisation"]')).not.toBeNull();
  });

  it('scopes an org admin: no org facet, no org picker, and says so', async () => {
    serve(routes([200, page({ scope: { orgs: ['acme'], platform: false } })]));
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('scope: Acme');
    expect(container.textContent).toContain('org admin');
    expect([...container.querySelectorAll('legend')].map((l) => l.textContent)).not.toContain('Organisation');
    expect(container.querySelector('select[aria-label="Organisation"]')).toBeNull();
  });

  it('lists server saved views beside the defaults', async () => {
    serve(routes([200, page()]));
    const { container } = mount();
    await flush();
    const opts = [...container.querySelectorAll('select[aria-label="Saved views"] option')].map((o) => o.textContent);
    expect(opts).toContain('Denied access');
    expect(opts).toContain('Team denials (shared)');
  });

  it('warns when the result is truncated', async () => {
    serve(routes([200, page({ truncated: true })]));
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Showing the newest 5 000 of more events');
  });

  it('opens a denied event with why-denied, chain status and a trace link', async () => {
    (window as unknown as { __GRAFANA_URL__: string }).__GRAFANA_URL__ = 'https://grafana.example';
    serve(routes([200, page()]));
    const { container } = mount();
    await flush();
    click(container.querySelector('.audit-row-head'));
    await flush();
    expect(container.textContent).toContain('Why was this denied?');
    expect(container.textContent).toContain('chain verified');
    const trace = container.querySelector('a[href*="/explore"]') as HTMLAnchorElement;
    expect(trace).not.toBeNull();
    expect(trace.href).not.toMatch(/%40|@/);
    delete (window as unknown as { __GRAFANA_URL__?: string }).__GRAFANA_URL__;
  });

  it('shows the §5.2 empty state with widen and clear actions', async () => {
    window.location.hash = '#/audit?result=denied';
    serve(routes([200, page({ events: [] })]));
    const { container } = mount();
    await flush();
    expect(container.textContent).toMatch(/No events in all organisations between .* matching these filters/);
    expect(container.textContent).toContain('Widen to 30 days');
    expect(container.textContent).toContain('Clear filters');
  });

  it('opens one event from #/audit/event/<id>', async () => {
    window.location.hash = '#/audit/event/e1?ts=2026-09-25T11:00:00Z';
    serve(routes([200, page()]));
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('All events');
    expect(container.textContent).toContain('denied');
    expect(container.textContent).toContain('e1');
  });
});
