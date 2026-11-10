import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render, type } from '../../components/ui/testing';
import { durationChoices, formatLeft, impersonateBlocked, impersonationFailure, groupSites, inForce, reachNotice, secondsLeft } from '../../lib/impersonation';
import { impersonationApi } from '../../api/impersonation';

const h = vi.hoisted(() => ({ session: {} as Record<string, unknown>, toasts: [] as unknown[][] }));
vi.mock('../../auth/session', () => ({ bearerToken: async () => null }));
vi.mock('../../contexts/AppContext', () => ({ useApp: () => ({ pushToast: (...a: unknown[]) => h.toasts.push(a) }) }));
vi.mock('../../api/hooks', () => ({ useSession: () => ({ data: h.session }) }));

import { ImpersonateCard, ViewingAsNotice } from './UserImpersonation';
import type { User } from '../../api/types';

const BOB: User = { id: 'u-bob', name: 'Bob Stone', email: 'bob@example.com', groups: ['support'], title: '', active: true, last: '' };
const ALICE = { id: 'u-alice', name: 'Alice Reed', email: 'alice@example.com' };
const soon = (minutes = 30) => new Date(Date.now() + minutes * 60_000).toISOString();
const activeFor = (target: { id: string; name: string; email: string }, minutes = 30) =>
  ({ target: { id: target.id, name: target.name, email: target.email }, reason: 'Ticket 4821', startedAt: new Date().toISOString(), expiresAt: soon(minutes), mode: 'read' as const });

type Call = { method: string; url: string; body?: unknown };
let calls: Call[] = [];
type Reply = [number, unknown];
/** Answers the state, their access and the sites by address; `start` answers the POST. */
function serve(state: unknown, start: (c: Call) => Reply = () => [201, { active: activeFor(BOB) }]) {
  calls = [];
  let current = state;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    let reply: Reply = [404, { error: 'Not Found' }];
    if (c.url === '/api/admin/impersonation' && c.method === 'GET') reply = [200, current];
    else if (c.url === '/api/admin/impersonation' && c.method === 'DELETE') { current = { ...(current as object), active: null }; reply = [204, null]; }
    else if (c.url.endsWith('/impersonate')) {
      reply = start(c);
      if (reply[0] === 201) current = { ...(current as object), active: (reply[1] as { active: unknown }).active };
    }
    else if (c.url.endsWith('/reachable-sites')) reply = reach;
    const [status, body] = reply;
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
}
const BILLING = { name: 'billing', title: 'Billing', url: 'https://billing.example.com/', access: 'role' };
const DOCS = { name: 'docs', title: 'Docs', url: 'https://docs.example.com/', access: 'signed-in' };
/** What GET …/reachable-sites answers; each test sets its own. */
let reach: Reply = [200, { sites: [BILLING, DOCS] }];

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const text = () => document.body.textContent ?? '';
const button = (label: string) => [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === label) ?? null;
/** The dialog's own button: the card behind it has an Impersonate too. */
const inDialog = (label: string) => [...document.body.querySelectorAll('.modal button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined ?? null;
const links = () => [...document.body.querySelectorAll('.modal a')] as HTMLAnchorElement[];
/** The reach warning in the dialog: the form step has no other warning box. */
const warning = () => [...document.body.querySelectorAll('.modal .callout.warning')].find(c => !c.textContent?.includes('Sites now open as')) ?? null;
const posts = () => calls.filter(c => c.method === 'POST');
function mount(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
async function mountCard(user: User = BOB) {
  mount(<ImpersonateCard user={user} />);
  await flush();
}
async function fillAndStart(reason = 'Ticket 4821: cannot see invoices') {
  type(document.getElementById('impersonate-reason'), reason);
  click(inDialog('Impersonate'));
  await flush();
}

beforeEach(() => {
  h.session = { identity_id: 'u-me', permissions: ['users:read'] };
  h.toasts = [];
  reach = [200, { sites: [BILLING, DOCS] }];
  (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__ = 'auth.example.com';
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('lib/impersonation', () => {
  it('counts down in minutes and seconds, and an expired one is none', () => {
    const now = Date.parse('2026-11-10T10:00:00Z');
    expect(secondsLeft('2026-11-10T10:29:05Z', now)).toBe(1745);
    expect(formatLeft(1745)).toBe('29:05');
    expect(formatLeft(0)).toBe('00:00');
    expect(secondsLeft('2026-11-10T09:59:59Z', now)).toBe(0);
    expect(secondsLeft('not a date', now)).toBe(0);
    const active = { ...activeFor(BOB), expiresAt: '2026-11-10T10:30:00Z' };
    expect(inForce({ enabled: true, allowed: true, active }, now)).toBe(active);
    expect(inForce({ enabled: true, allowed: true, active }, now + 31 * 60_000)).toBeNull();
    expect(inForce({ enabled: false, allowed: true, active }, now)).toBeNull();
  });

  it('says why the action is greyed', () => {
    const me = { identity_id: 'u-me' };
    expect(impersonateBlocked({ allowed: true }, me, BOB)).toBeNull();
    expect(impersonateBlocked({ allowed: false }, me, BOB)).toContain('users:impersonate');
    expect(impersonateBlocked({ allowed: true }, me, { ...BOB, id: 'u-me' })).toBe('You cannot impersonate yourself.');
    expect(impersonateBlocked({ allowed: true }, me, { ...BOB, groups: ['super_admins'] })).toBe('A super admin cannot be impersonated.');
    expect(impersonateBlocked({ allowed: true }, me, { ...BOB, active: false })).toContain('inactive');
  });

  it('names each refusal', () => {
    const f = (code: string, status = 403) => impersonationFailure({ status, code }, 'bob@example.com');
    expect(f('impersonation_disabled', 404)).toEqual({ title: 'Not available here', detail: 'Impersonation is switched off in this environment.' });
    expect(f('impersonation_target_admin')).toEqual({ title: 'A super admin cannot be impersonated', detail: 'bob@example.com is a super admin. Nothing was started.' });
    expect(f('impersonation_self').detail).toBe('You cannot impersonate your own account.');
    expect(f('impersonation_target_unavailable').detail).toContain('inactive or a machine account');
    expect(f('impersonation_session_required').detail).toContain('signed in with a token');
    expect(f('reauth_required', 422).stepUp).toBe(true);
    // A permission refusal carries the code in the body, beside error: "Forbidden".
    expect(impersonationFailure({ status: 403, code: 'Forbidden', details: { code: 'impersonation_self' } }, 'x').title).toBe('Not yourself');
    expect(impersonationFailure({ status: 403, code: 'Forbidden' }, 'x').detail).toContain('users:impersonate');
    expect(impersonationFailure({ status: 500, message: 'boom' }, 'x')).toEqual({ title: 'Could not start', detail: 'boom' });
  });

  it('groups the sites they can open, and says when no role or nothing at all', () => {
    const billing = { ...BILLING, access: 'role' as const };
    const docs = { ...DOCS, access: 'signed-in' as const };
    expect(groupSites([billing, docs])).toEqual({ role: [billing], signedIn: [docs] });
    expect(reachNotice([billing, docs])).toBeNull();
    expect(reachNotice([docs])!.title).toBe('No role on any site');
    expect(reachNotice([])!.title).toBe('Nothing this person can open');
  });

  it('keeps only sites with a name and an http(s) address', async () => {
    serve(null);
    reach = [200, { sites: [BILLING, { name: 'x', title: 'X', url: 'javascript:alert(1)', access: 'role' }, { title: 'no name', url: 'https://a.example.com/' }, { name: 'plain', url: 'https://plain.example.com/' }] }];
    expect(await impersonationApi.reachableSites('u-bob')).toEqual([
      { name: 'billing', title: 'Billing', url: 'https://billing.example.com/', access: 'role' },
      { name: 'plain', title: 'plain', url: 'https://plain.example.com/', access: 'signed-in' },
    ]);
    expect(calls).toEqual([{ method: 'GET', url: '/api/admin/users/u-bob/reachable-sites', body: undefined }]);
  });
});

describe('the Impersonate action', () => {
  it('is not there where the feature is off, or on a jinbe without it', async () => {
    serve({ enabled: false, allowed: true, active: null });
    await mountCard();
    expect(text()).toBe('');
    cleanup();
    serve(null);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 })));
    await mountCard();
    expect(text()).toBe('');
  });

  it('is greyed, with the reason, without users:impersonate', async () => {
    serve({ enabled: true, allowed: false, active: null });
    await mountCard();
    expect(button('Impersonate')!.disabled).toBe(true);
    expect(text()).toContain('You cannot impersonate (users:impersonate).');
  });

  it('is greyed on your own account and on a super admin', async () => {
    serve({ enabled: true, allowed: true, active: null });
    await mountCard({ ...BOB, id: 'u-me' });
    expect(button('Impersonate')!.disabled).toBe(true);
    expect(text()).toContain('You cannot impersonate yourself.');
    cleanup();
    await mountCard({ ...BOB, groups: ['super_admins'] });
    expect(button('Impersonate')!.disabled).toBe(true);
    expect(text()).toContain('A super admin cannot be impersonated.');
  });

  it('says what it does, and will not start without a reason', async () => {
    serve({ enabled: true, allowed: true, active: null });
    await mountCard();
    click(button('Impersonate'));
    expect(text()).toContain('Impersonate bob@example.com?');
    expect(text()).toContain('Read-only: nothing can be changed as them.');
    expect(text()).toContain('Only on the sites, in other tabs. This console stays yours.');
    expect(text()).toContain('They are not notified.');
    expect(text()).toContain('Everything is recorded in the audit trail, with your name.');
    const start = inDialog('Impersonate')!;
    expect(start.disabled).toBe(true);
    type(document.getElementById('impersonate-reason'), 'abc');
    expect(start.disabled).toBe(true);
    type(document.getElementById('impersonate-reason'), 'abcde');
    expect(start.disabled).toBe(false);
    expect(posts()).toHaveLength(0);
  });

  it('starts for 30 minutes by default, then says where to go and offers their sites in a new tab', async () => {
    serve({ enabled: true, allowed: true, active: null });
    await mountCard();
    click(button('Impersonate'));
    await fillAndStart('  Ticket 4821: cannot see invoices ');
    expect(posts()).toEqual([{ method: 'POST', url: '/api/admin/users/u-bob/impersonate', body: { reason: 'Ticket 4821: cannot see invoices', minutes: 30 } }]);
    expect(text()).toContain('Viewing as Bob Stone');
    expect(text()).toContain('Sites now open as Bob Stone — read-only, until');
    expect(text()).toContain('This console is still yours.');
    // Both groups, the role sites first, each opening its address in a new tab.
    expect(text()).toContain('Open as this person:Billing');
    expect(text()).toContain('Open to any signed-in person:Docs');
    expect(links().map(a => [a.textContent, a.getAttribute('href'), a.target, a.rel])).toEqual([
      ['Billing', 'https://billing.example.com/', '_blank', 'noopener noreferrer'],
      ['Docs', 'https://docs.example.com/', '_blank', 'noopener noreferrer'],
    ]);
    expect(document.body.querySelector('.modal .callout.warning .callout-title')!.textContent).toContain('Sites now open as');
    expect(text()).not.toContain('No role on any site');
    // The card behind the dialog is now Stop.
    expect(button('Stop impersonating')).not.toBeNull();
  });

  it('starts for 15 minutes when chosen', async () => {
    serve({ enabled: true, allowed: true, active: null });
    await mountCard();
    click(button('Impersonate'));
    click(button('15 min'));
    await fillAndStart();
    expect(posts()[0].body).toEqual({ reason: 'Ticket 4821: cannot see invoices', minutes: 15 });
  });

  it('offers only the durations jinbe allows', async () => {
    expect(durationChoices()).toEqual([15, 30]);
    expect(durationChoices(60)).toEqual([15, 30]);
    expect(durationChoices(20)).toEqual([15]);
    expect(durationChoices(10)).toEqual([10]);
    serve({ enabled: true, allowed: true, active: null, maxMinutes: 20 });
    await mountCard();
    click(button('Impersonate'));
    expect(button('30 min')).toBeNull();
    await fillAndStart();
    expect(posts()[0].body).toEqual({ reason: 'Ticket 4821: cannot see invoices', minutes: 15 });
  });

  it('before starting: what they will be able to open, as names — a link would open as you', async () => {
    serve({ enabled: true, allowed: true, active: null });
    await mountCard();
    click(button('Impersonate'));
    await flush();
    expect(calls.filter(c => c.url.endsWith('/reachable-sites')).map(c => c.url)).toEqual(['/api/admin/users/u-bob/reachable-sites']);
    expect(text()).toContain('They will be able to open:Billing');
    expect(text()).toContain('Open to any signed-in person:Docs');
    expect(links()).toHaveLength(0);
    expect(warning()).toBeNull();
  });

  it('no role on any site: warns before starting, lists what is open to anybody, and still starts', async () => {
    reach = [200, { sites: [DOCS] }];
    serve({ enabled: true, allowed: true, active: null });
    await mountCard();
    click(button('Impersonate'));
    await flush();
    expect(warning()!.textContent).toContain('No role on any site');
    expect(warning()!.textContent).toContain('sites that need one will show "no access" — that is what they see too.');
    // A warning, not an error: nothing is announced as a failure.
    expect(document.body.querySelector('.modal [role="alert"]')).toBeNull();
    expect(text()).not.toContain('They will be able to open:');
    expect(text()).toContain('Open to any signed-in person:Docs');
    await fillAndStart();
    expect(posts()).toHaveLength(1);
    expect(links().map(a => a.getAttribute('href'))).toEqual(['https://docs.example.com/']);
    expect(text()).toContain('No role on any site');
  });

  it('nothing they can open: says so, and still starts', async () => {
    reach = [200, { sites: [] }];
    serve({ enabled: true, allowed: true, active: null });
    await mountCard();
    click(button('Impersonate'));
    await flush();
    expect(warning()!.textContent).toContain('Nothing this person can open');
    expect(text()).not.toContain('Open to any signed-in person:');
    await fillAndStart();
    expect(posts()).toHaveLength(1);
    expect(links()).toHaveLength(0);
    expect(text()).toContain('Nothing this person can open');
  });

  it.each([403, 404, 500])('the list could not be loaded (%i): not "none" — no warning, the plain instruction', async (status) => {
    reach = [status, { error: 'refused' }];
    serve({ enabled: true, allowed: true, active: null });
    await mountCard();
    click(button('Impersonate'));
    await flush();
    expect(warning()).toBeNull();
    expect(text()).toContain('Which sites they can open could not be checked.');
    await fillAndStart();
    expect(posts()).toHaveLength(1);
    expect(links()).toHaveLength(0);
    expect(text()).toContain('Open any site in a new tab — it loads as this person.');
    expect(text()).not.toContain('No role on any site');
    expect(text()).not.toContain('Nothing this person can open');
    cleanup();
  });

  it('does not wait for the list: the form works while it loads', async () => {
    serve({ enabled: true, allowed: true, active: null });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (String(url).endsWith('/reachable-sites') ? new Promise<Response>(() => {}) : real(url, init))));
    await mountCard();
    click(button('Impersonate'));
    await flush();
    expect(text()).toContain('Checking which sites they can open…');
    await fillAndStart();
    expect(text()).toContain('Sites now open as Bob Stone');
  });

  const refusals: [string, number, string][] = [
    ['impersonation_disabled', 404, 'Impersonation is switched off in this environment.'],
    ['impersonation_target_admin', 403, 'A super admin cannot be impersonated'],
    ['impersonation_self', 403, 'You cannot impersonate your own account.'],
    ['impersonation_target_unavailable', 403, 'bob@example.com is inactive or a machine account.'],
    ['impersonation_session_required', 403, 'You are signed in with a token, not a browser session.'],
  ];
  it.each(refusals)('%s: says so, and nothing started', async (code, status, said) => {
    serve({ enabled: true, allowed: true, active: null }, () => [status, { error: status === 404 ? 'Not Found' : 'Forbidden', code, message: 'refused' }]);
    await mountCard();
    click(button('Impersonate'));
    await fillAndStart();
    expect(text()).toContain(said);
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    expect(button('Confirm my second factor')).toBeNull();
    cleanup();
  });

  it('a stale second factor: offers the step-up, and asks to do it again afterwards', async () => {
    serve({ enabled: true, allowed: true, active: null }, () => [422, { error: 'reauth_required', message: 'Re-authenticate.' }]);
    await mountCard();
    click(button('Impersonate'));
    await fillAndStart();
    expect(text()).toContain('Confirm your own second factor first');
    click(button('Confirm my second factor'));
    expect(window.sessionStorage.getItem('kuma:resume-redo')).toContain('Impersonate bob@example.com again');
    window.sessionStorage.clear();
  });

  it('already viewing as somebody else: asks about the switch before anything', async () => {
    serve({ enabled: true, allowed: true, active: activeFor(ALICE) });
    await mountCard();
    expect(text()).toContain('You are viewing as Alice Reed now. Impersonating them switches.');
    click(button('Impersonate'));
    expect(text()).toContain('You are viewing as Alice Reed. Switch to Bob Stone?');
    expect(document.getElementById('impersonate-reason')).toBeNull();
    click(button('Keep viewing as Alice Reed'));
    expect(text()).not.toContain('Switch to Bob Stone?');
    expect(posts()).toHaveLength(0);

    click(button('Impersonate'));
    click(button('Switch to Bob Stone'));
    await fillAndStart();
    expect(posts()).toHaveLength(1);
    expect(text()).toContain('Sites now open as Bob Stone');
  });

  it('on the person being viewed as, it is Stop impersonating — one click', async () => {
    serve({ enabled: true, allowed: false, active: activeFor(BOB) });
    await mountCard();
    expect(button('Impersonate')).toBeNull();
    expect(text()).toContain('You are viewing the sites as them — read-only');
    click(button('Stop impersonating'));
    await flush();
    expect(calls.filter(c => c.method === 'DELETE').map(c => c.url)).toEqual(['/api/admin/impersonation']);
    expect(button('Stop impersonating')).toBeNull();
    expect(h.toasts[0][0]).toBe('Stopped viewing as Bob Stone');
  });
});

describe('ViewingAsNotice (top of the drawer)', () => {
  it('only on the person being viewed as, with Stop and their sites', async () => {
    serve({ enabled: true, allowed: true, active: activeFor(BOB) });
    mount(<ViewingAsNotice user={{ ...BOB, ...ALICE }} />);
    await flush();
    expect(text()).toBe('');
    cleanup();
    mount(<ViewingAsNotice user={BOB} />);
    await flush();
    expect(text()).toMatch(/Viewing sites as Bob Stone — read-only — (29:5\d|30:00) left/);
    expect(document.body.querySelector('a[href="https://billing.example.com/"]')!.getAttribute('rel')).toContain('noopener');
    click(button('Stop'));
    await flush();
    expect(text()).toBe('');
  });

  it('same list, same groups; no role is said in the notice itself', async () => {
    serve({ enabled: true, allowed: true, active: activeFor(BOB) });
    mount(<ViewingAsNotice user={BOB} />);
    await flush();
    expect(text()).toContain('Open as this person:Billing');
    expect(text()).toContain('Open to any signed-in person:Docs');
    cleanup();
    reach = [200, { sites: [DOCS] }];
    serve({ enabled: true, allowed: true, active: activeFor(BOB) });
    mount(<ViewingAsNotice user={BOB} />);
    await flush();
    expect(text()).toContain('No role on any site.');
    expect(document.body.querySelectorAll('.callout')).toHaveLength(1);
    expect(document.body.querySelector('a[href="https://docs.example.com/"]')!.getAttribute('target')).toBe('_blank');
  });
});
