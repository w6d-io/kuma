import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render } from '../../components/ui/testing';
import { withForbidden, type HomeResponse, type Module } from '../../api/home';
import { ModuleFrame } from './ModuleFrame';
import { HomePage } from './HomePage';
import sample from '../../lib/home/home-sample.json';
import { allUnavailableHome, mixedHome, noRightsHome, onTheWire, orgAdminHome, platformHome, supportHome } from '../../lib/home/fixtures';

vi.mock('../../auth/session', () => ({ bearerToken: async () => null }));
const app = { setGrant: vi.fn(), setUserDrawer: vi.fn(), pushToast: vi.fn() };
vi.mock('../../contexts/AppContext', () => ({ useApp: () => app }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.location.hash = ''; });

// ── ModuleFrame: every row of the common states table ───────────────────────

function frame(m: Module<{ n: number }> | undefined, extra: { loading?: boolean; error?: Error | null } = {}) {
  const onRetry = vi.fn();
  const r = render(
    <ModuleFrame<{ n: number }>
      id="t" title="Thing" module={m} loading={extra.loading ?? false} error={extra.error} onRetry={onRetry}
      skeleton={<div className="sk">skeleton</div>} thing="things"
      notConnected={{ title: "Things aren't connected yet", what: 'They come from somewhere.' }}
    >
      {(d) => <div className="data">n={d.n}</div>}
    </ModuleFrame>,
  );
  return { ...r, onRetry };
}
const env = (over: Partial<Module<{ n: number }>>): Module<{ n: number }> => ({ status: 'ok', asOf: new Date().toISOString(), stale: false, sources: {}, ...over });

describe('ModuleFrame', () => {
  it('shows the skeleton while loading, marked busy', () => {
    const { container } = frame(undefined, { loading: true });
    expect(container.querySelector('.sk')).not.toBeNull();
    expect(container.querySelector('section')!.getAttribute('aria-busy')).toBe('true');
  });

  it('draws nothing at all for a forbidden module', () => {
    const { container } = frame(env({ status: 'forbidden', asOf: null }));
    expect(container.innerHTML).toBe('');
  });

  it('draws the data, in a section named by its heading', () => {
    const { container } = frame(env({ data: { n: 0 } }));
    expect(container.querySelector('.data')!.textContent).toBe('n=0');
    const section = container.querySelector('section')!;
    expect(document.getElementById(section.getAttribute('aria-labelledby')!)!.textContent).toBe('Thing');
  });

  it('keeps stale data and says how old it is', () => {
    const { container } = frame(env({ stale: true, data: { n: 3 } }));
    expect(container.querySelector('.data')).not.toBeNull();
    expect(container.querySelector('.home-foot.is-stale')!.textContent).toContain('Updated');
  });

  it('says it is collecting while the cache warms', () => {
    const { container } = frame(env({ status: 'unavailable', reason: 'warming', asOf: null }));
    expect(container.textContent).toContain('Collecting — first figures in about a minute.');
  });

  it('names the source that did not answer and offers a retry', () => {
    const { container, onRetry } = frame(env({ status: 'unavailable', reason: 'timeout', asOf: null, sources: { loki: { state: 'timeout' } } }));
    expect(container.textContent).toContain("Couldn't load things — the audit log (Loki) didn't answer.");
    click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!);
    expect(onRetry).toHaveBeenCalled();
  });

  it('says not connected with the setting and the docs, never a zero', () => {
    const { container } = frame(env({ status: 'unavailable', reason: 'not_configured', asOf: null, connect: { setting: 'LOKI_URL', docs: 'docs/OBSERVABILITY.md' } }));
    expect(container.textContent).toContain("Things aren't connected yet");
    expect(container.querySelector('code')!.textContent).toBe('LOKI_URL');
    expect(container.textContent).toContain('docs/OBSERVABILITY.md');
    expect(container.textContent).not.toMatch(/\b0\b/);
  });

  it('says partial when a source is down but the module answered', () => {
    const { container } = frame(env({ data: { n: 1 }, sources: { kratos: { state: 'down' } } }));
    expect(container.textContent).toContain("Partial — Sign-in (Kratos) didn't answer.");
  });

  it('names a source of several that is not connected, with its own setting', () => {
    const { container } = frame(env({ data: { n: 1 }, sources: { prometheus: { state: 'not_configured', connect: { setting: 'PROMETHEUS_URL', docs: 'jinbe/docs/observability.md' } } } }));
    expect(container.textContent).toContain("Prometheus isn't connected — set PROMETHEUS_URL");
  });

  it('keeps the last data when its own refresh fails, with a retry', () => {
    const { container } = frame(env({ data: { n: 2 } }), { error: new Error('offline') });
    expect(container.querySelector('.data')).not.toBeNull();
    expect(container.textContent).toContain("Couldn't refresh");
  });

  it('shows an error when the first load fails', () => {
    const { container } = frame(undefined, { error: new Error('offline') });
    expect(container.textContent).toContain("Couldn't load things.");
  });
});

// ── The page, per persona, from fixture responses ───────────────────────────

function serve(res: HomeResponse | { status: number; body: unknown }, twoStep?: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/public/second-factor')) return twoStep ? json(200, twoStep) : json(401, { error: 'unauthenticated' });
    if ('status' in res && typeof res.status === 'number') return json(res.status, res.body);
    const home = res as HomeResponse;
    if (u.includes('/home/')) {
      const key = u.split('/home/')[1].split('?')[0] as keyof HomeResponse['modules'];
      const m = home.modules[key];
      return m.status === 'forbidden' ? json(403, m) : json(200, m);
    }
    if (u.includes('/home')) return json(200, onTheWire(home));
    if (u.includes('/me/organizations')) return json(200, { organizations: home.scope.orgs, names: { acme: 'Acme', globex: 'Globex' } });
    if (u.includes('/whoami')) return json(200, { authenticated: true, permissions: [] });
    return json(404, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function page() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(<QueryClientProvider client={qc}><HomePage /></QueryClientProvider>);
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  return r;
}

const headings = (c: HTMLElement) => [...c.querySelectorAll('h2')].map((h) => h.firstChild?.textContent);

describe('HomePage', () => {
  beforeEach(() => { window.location.hash = '#/dashboard'; });

  it('gives the platform owner the whole briefing', async () => {
    serve(platformHome());
    const { container } = await page();
    expect(container.querySelector('h1')!.textContent).toBe('Home');
    expect(headings(container)).toEqual(['Platform', 'Needs you', 'Quick actions', 'Sign-ins', 'Gateway traffic', 'Sites', 'Recent changes', 'People']);
    expect(container.querySelector('.home-summary')!.textContent).toContain('6 things need you');
    expect(container.textContent).toContain("Gateway traffic isn't connected yet");
    expect(container.querySelectorAll('.queue-item')).toHaveLength(6);
    expect(container.querySelector('.queue-item')!.getAttribute('href')).toBe('#/sites?view=requests&id=r1');
  });

  it('puts "set up two-step sign-in" first in Needs you when the role requires it and none is set up', async () => {
    (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__ = 'auth.example.net';
    serve(platformHome(), { secondFactorRequired: true, hasSecondFactor: false, methods: [], aal: 'aal1' });
    const { container } = await page();
    const first = container.querySelector('.queue-item')!;
    expect(first.textContent).toContain('Two-step sign-in is required for your role — set it up now');
    expect(first.getAttribute('href')).toMatch(/^https:\/\/auth\.example\.net\/two-step\?return_to=/);
    expect(container.querySelectorAll('.queue-item')).toHaveLength(7);
    delete (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__;
  });

  it('no two-step item once a second factor exists, or when the role does not require one', async () => {
    (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__ = 'auth.example.net';
    serve(platformHome(), { secondFactorRequired: true, hasSecondFactor: true, methods: ['totp'], aal: 'aal1' });
    const { container } = await page();
    expect(container.textContent).not.toContain('Two-step sign-in is required');
    expect(container.querySelectorAll('.queue-item')).toHaveLength(6);
    delete (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__;
  });

  it('never draws a forbidden module for support, and puts the finder first', async () => {
    serve(supportHome());
    const { container } = await page();
    expect(headings(container)).toEqual(['Find a person', 'Needs you', 'Quick actions', 'People']);
    expect(container.textContent).not.toContain('Sign-ins');
  });

  it('gives an org admin their orgs, a picker defaulting to all of them, and sends ?org=', async () => {
    const fetchMock = serve(orgAdminHome());
    const { container } = await page();
    expect(headings(container)).toEqual(['Needs you', 'Quick actions', 'Sign-ins', 'Gateway traffic', 'Your sites', 'Recent changes', 'People']);
    const select = container.querySelector<HTMLSelectElement>('select[aria-label=Organization]')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['All my orgs', 'Acme', 'Globex']);
    expect(select.value).toBe('');
    await act(async () => { select.value = 'acme'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/home?window=24h&org=acme'))).toBe(true);
    expect(window.location.hash).toBe('#/dashboard?org=acme');
  });

  it('tells someone with no rights so, with a request to copy', async () => {
    serve(noRightsHome());
    const { container } = await page();
    expect(container.textContent).toContain("you don't have access to anything in this console yet");
    expect(container.textContent).toContain('Copy an access request');
    expect(headings(container)).not.toContain('Platform');
  });

  it('keeps the page when every module is unavailable', async () => {
    serve(allUnavailableHome());
    const { container } = await page();
    expect(container.querySelectorAll('section.home-module').length).toBeGreaterThanOrEqual(8);
    expect(container.textContent).toContain('Collecting — first figures in about a minute.');
    expect(container.textContent).toContain("Sites aren't connected yet");
  });

  it('draws a mixed day: the down component leads, the rest keep their own state', async () => {
    serve(mixedHome());
    const { container } = await page();
    expect(container.querySelector('.home-summary.is-danger')!.textContent).toContain('Policy sync is down');
    expect(container.textContent).toContain('Nothing needs you in what we could check');
    expect(container.textContent).toContain('No sites yet');
    expect(container.textContent).toContain('Platform totals from gateway logs');
  });

  it('says an outage when it cannot tell who is asking, instead of a narrowed page', async () => {
    // The body jinbe's requireHomeScope sends when OPA does not answer.
    serve({ status: 503, body: { error: 'Service Unavailable', message: 'Unable to verify authorization. Please try again later.' } });
    const { container } = await page();
    expect(container.textContent).toContain('Access engine unreachable');
    expect(container.textContent).toContain('This is an outage, not a missing permission.');
    expect(container.querySelector('.home-module')).toBeNull();
  });

  it("draws jinbe's own sample response, and does not mark an `ok` change as failed", async () => {
    serve(withForbidden(sample as unknown as Parameters<typeof withForbidden>[0]));
    const { container } = await page();
    expect(headings(container)).toContain('Needs you');
    expect(container.querySelector('.change-row')).not.toBeNull();
    expect(container.querySelector('.change-row.is-failed')).toBeNull();
  });

  it('never renders an email, whatever the fixture carries', async () => {
    const res = platformHome();
    res.modules.changes.data!.items[0].actor.label = 'Sam Ortiz';
    serve(res);
    const { container } = await page();
    expect(container.textContent).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
