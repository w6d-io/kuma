import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { cleanup, click, render, type } from '../../components/ui/testing';

const h = vi.hoisted(() => ({ session: { permissions: ['admin:read', 'admin:write'] } as { permissions: string[]; effective_permissions?: string[] } }));
vi.mock('../../auth/session', () => ({ bearerToken: async () => null }));
vi.mock('../../lib/stepUp', async (orig) => ({ ...(await orig<typeof import('../../lib/stepUp')>()), bounceToStepUp: () => true }));
vi.mock('../../api/hooks', () => ({ useSession: () => ({ data: h.session }) }));
vi.mock('../../api/twoFactor', () => ({ useGroupSecondFactors: () => () => undefined }));
vi.mock('../access/access', () => ({
  useSiteGroups: () => ({ offered: ['billing', 'ops'], mayAssign: true, privileged: () => false, describe: (g: string) => `${g} roles` }),
}));

import { SelectionBar, InviteDialog } from './UsersBulk';

type Call = { method: string; url: string; body?: unknown };
let calls: Call[] = [];
type Reply = [number, unknown, Record<string, string>?];
function serve(handler: (c: Call) => Reply) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const [status, body, headers] = handler(c);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }));
}
async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const text = () => document.body.textContent ?? '';
const button = (label: string) => [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === label) ?? null;
const withQuery = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const SELECTED = new Map([['u-1', 'ann@example.com'], ['u-2', 'bob@example.com'], ['u-3', 'cy@example.com']]);
const PLAN = {
  planId: 'p1', planHash: 'h1', op: 'users.verification', expiresAt: '2026-09-30T12:00:00Z',
  counts: { ok: 1, skip: 1, refused: 1, not_found: 0 },
  items: [
    { index: 0, outcome: { status: 'ok', action: 'send' } },
    { index: 1, outcome: { status: 'skip', reason: 'already_verified' } },
    { index: 2, outcome: { status: 'refused', reason: 'self_change' } },
  ],
  warnings: [],
};
const JOB = (state: 'running' | 'done', status: 'pending' | 'done') => ({
  id: 'p1', op: 'users.verification', state, total: 3,
  items: [{ index: 0, status, ...(status === 'done' ? { action: 'send' } : {}) }, { index: 1, status: 'skipped', reason: 'already_verified' }, { index: 2, status: 'refused', reason: 'self_change' }],
  counts: { pending: status === 'pending' ? 1 : 0, done: status === 'done' ? 1 : 0, skipped: 1, refused: 1, failed: 0 },
});

beforeEach(() => { h.session = { permissions: ['admin:read', 'admin:write'] }; sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SelectionBar', () => {
  it('shows only the actions the caller holds, and never a delete', () => {
    serve(() => [200, {}]);
    withQuery(<SelectionBar selected={SELECTED} onClear={() => {}} />);
    expect(text()).toContain('3 people selected');
    expect(button('Resend verification')).not.toBeNull();
    expect(button('Add to groups')).not.toBeNull();
    expect(text()).not.toMatch(/delete/i);
    cleanup();
    h.session = { permissions: ['admin:write'], effective_permissions: ['users:read', 'users:verify'] };
    withQuery(<SelectionBar selected={SELECTED} onClear={() => {}} />);
    expect(button('Resend verification')).not.toBeNull();
    expect(button('Add to groups')).toBeNull();
  });

  it('resend: previews each person, runs what the preview showed, and follows the job', async () => {
    let polls = 0;
    serve(c => {
      if (c.url.endsWith('/plan')) return [200, PLAN];
      if (c.url.endsWith('/execute')) return [202, JOB('running', 'pending')];
      polls += 1;
      return [200, JOB('done', 'done')];
    });
    withQuery(<SelectionBar selected={SELECTED} onClear={() => {}} />);
    click(button('Resend verification'));
    await flush();
    expect(calls[0]).toEqual({ method: 'POST', url: '/api/admin/bulk/users.verification/plan', body: { items: [{ user: 'u-1' }, { user: 'u-2' }, { user: 'u-3' }] } });
    expect(text()).toContain('Will run');
    expect(text()).toContain('Already verified');
    expect(text()).toContain('Your own account');
    expect(text()).toContain('ann@example.com');
    expect(text()).toContain('Nothing has changed yet');
    click(button('Send 1 link'));
    await flush();
    expect(calls[1]).toEqual({ method: 'POST', url: '/api/admin/bulk/users.verification/execute', body: { planId: 'p1', planHash: 'h1' } });
    await act(async () => { await new Promise(r => setTimeout(r, 1100)); });
    await flush();
    expect(polls).toBeGreaterThan(0);
    expect(calls.at(-1)!.url).toBe('/api/admin/bulk/jobs/p1');
    expect(text()).toContain('Finished');
    expect(text()).toContain('1 done · 1 skipped · 1 refused · 0 failed');
  });

  it('a preview that no longer holds is not run: the new one is shown', async () => {
    const fresh = { ...PLAN, planId: 'p2', planHash: 'h2', counts: { ok: 0, skip: 2, refused: 1, not_found: 0 }, items: PLAN.items.map((i, n) => (n === 0 ? { index: 0, outcome: { status: 'skip', reason: 'already_verified' } } : i)) };
    serve(c => (c.url.endsWith('/plan') ? [200, PLAN] : [409, { error: 'plan_changed', message: 'changed', plan: fresh }]));
    withQuery(<SelectionBar selected={SELECTED} onClear={() => {}} />);
    click(button('Resend verification'));
    await flush();
    click(button('Send 1 link'));
    await flush();
    expect(text()).toContain('What this would do has changed');
    expect(button('Send 0 links')!.disabled).toBe(true);
  });

  it('add to groups: pick groups, preview with them; a stale factor offers the step-up', async () => {
    serve(c => (c.url.endsWith('/plan')
      ? [200, { ...PLAN, op: 'groups.members.add', counts: { ok: 3, skip: 0, refused: 0, not_found: 0 }, items: [0, 1, 2].map(index => ({ index, outcome: { status: 'ok', action: 'add:ops' } })) }]
      : [422, { error: 'reauth_required', message: 'recent second factor' }]));
    withQuery(<SelectionBar selected={SELECTED} onClear={() => {}} />);
    click(button('Add to groups'));
    expect(button('Preview')!.disabled).toBe(true);
    click([...document.body.querySelectorAll('input[type="checkbox"]')].find(i => i.closest('label')?.textContent?.includes('ops')) ?? null);
    click(button('Preview'));
    await flush();
    expect(calls[0].body).toEqual({ items: [{ user: 'u-1', groups: ['ops'] }, { user: 'u-2', groups: ['ops'] }, { user: 'u-3', groups: ['ops'] }] });
    expect(text()).toContain('Add to ops');
    click(button('Add 3 people'));
    await flush();
    expect(text()).toContain('Confirm your own second factor first');
    expect(button('Confirm my second factor')).not.toBeNull();
  });
});

describe('InviteDialog', () => {
  it('turns a pasted list into a preview, with the invite mail as asked', async () => {
    serve(() => [200, { ...PLAN, op: 'users.invite', counts: { ok: 1, skip: 1, refused: 0, not_found: 0 }, items: [{ index: 0, outcome: { status: 'ok', action: 'create' } }, { index: 1, outcome: { status: 'skip', reason: 'already_exists' } }] }]);
    withQuery(<InviteDialog open onClose={() => {}} />);
    type(document.querySelector('#invite-addresses'), 'jane@example.com\nJohn Roe <john@example.com>\nnot-an-address');
    expect(text()).toContain('Not addresses, left out: not-an-address');
    expect(text()).toContain('2 addresses to check');
    click(button('Preview'));
    await flush();
    expect(calls[0]).toEqual({
      method: 'POST', url: '/api/admin/bulk/users.invite/plan',
      body: { items: [{ email: 'jane@example.com' }, { email: 'john@example.com', name: 'John Roe' }], params: { sendInvite: true } },
    });
    expect(text()).toContain('Create the account');
    expect(text()).toContain('Already has an account');
    expect(button('Create 1 account')).not.toBeNull();
  });

  it('without users:recovery, invites go out without a mail and it says so', async () => {
    h.session = { permissions: ['admin:write'], effective_permissions: ['users:create'] };
    serve(() => [200, PLAN]);
    withQuery(<InviteDialog open onClose={() => {}} />);
    expect(text()).toContain('sending invites needs users:recovery');
    type(document.querySelector('#invite-addresses'), 'jane@example.com');
    click(button('Preview'));
    await flush();
    expect((calls[0].body as { params: unknown }).params).toEqual({ sendInvite: false });
  });
});
