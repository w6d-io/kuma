import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render, type } from '../../components/ui/testing';
import { takeResume } from '../../lib/resume';

const h = vi.hoisted(() => ({
  session: { permissions: ['admin:read', 'admin:write'] } as { permissions: string[]; effective_permissions?: string[] },
  identity: null as unknown,
  persona: 'admin',
  toasts: [] as unknown[],
}));
vi.mock('../../auth/session', () => ({ bearerToken: async () => null }));
vi.mock('../../lib/stepUp', async (orig) => ({ ...(await orig<typeof import('../../lib/stepUp')>()), bounceToStepUp: () => true }));
vi.mock('../../contexts/AppContext', () => ({
  useApp: () => ({ persona: h.persona, pushToast: (...a: unknown[]) => h.toasts.push(a), apiSendRecoveryEmail: async () => {} }),
}));
vi.mock('../../api/hooks', () => ({
  useSession: () => ({ data: h.session }),
  useUserIdentity: () => ({ data: h.identity, isLoading: false, isError: false }),
}));

import { ChangeEmailDialog } from './ChangeEmailDialog';
import { UserProfileTab } from './UserProfileTab';
import type { User } from '../../api/types';

const USER = { id: 'u-1', email: 'bob@example.com' };

type Call = { method: string; url: string; body?: unknown };
let calls: Call[] = [];
type Reply = [number, unknown, Record<string, string>?];
function serve(handler: (c: Call) => Reply) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const [status, body, headers] = handler(c);
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }));
}
async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const text = () => document.body.textContent ?? '';
const button = (label: string) => [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === label) ?? null;
const identity = (verified: boolean) => ({
  id: 'u-1', traits: { email: 'bob@example.com', name: 'Bob' }, verifiable_addresses: [{ value: 'bob@example.com', verified, via: 'email' }],
});

beforeEach(() => {
  h.session = { permissions: ['admin:read', 'admin:write'] };
  h.identity = identity(true);
  h.persona = 'admin';
  h.toasts = [];
  sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ChangeEmailDialog', () => {
  const onChanged = vi.fn();
  const mount = (resumed?: string) => render(<ChangeEmailDialog open user={USER} resumed={resumed} onClose={() => {}} onChanged={onChanged} />);
  beforeEach(() => onChanged.mockReset());

  it('explains the unverified address and the old-address notice before anything is sent', () => {
    serve(() => [200, {}]);
    mount();
    expect(text()).toContain('It starts unverified');
    expect(text()).toContain('recorded in the audit trail, not emailed from here');
    expect(button('Change email')!.disabled).toBe(true);
    type(document.querySelector('#change-email-new'), 'Bob@Example.com');
    expect(button('Change email')!.disabled).toBe(true);
    expect(text()).toContain('That is already their address.');
    expect(calls).toHaveLength(0);
  });

  it('changes through its own call, and says the link went and where the notice is', async () => {
    serve(() => [200, { id: 'u-1', email: 'new@example.com', verified: false, verificationSent: true, oldAddressNotice: { delivered: false, recorded: true, channel: 'audit' } }]);
    mount();
    type(document.querySelector('#change-email-new'), ' new@example.com ');
    click(button('Change email'));
    await flush();
    expect(calls).toEqual([{ method: 'POST', url: '/api/admin/users/u-1/email', body: { email: 'new@example.com' } }]);
    expect(text()).toContain('Sign-in address changed');
    expect(text()).toContain('A link to confirm it went to new@example.com');
    expect(text()).toContain('recorded in the audit trail as a notice owed to the old address');
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.com' }));
  });

  it('a stale second factor: keeps the address across the step-up, to propose it again', async () => {
    serve(() => [422, { error: 'reauth_required', message: 'recent second factor' }]);
    mount();
    type(document.querySelector('#change-email-new'), 'new@example.com');
    click(button('Change email'));
    await flush();
    expect(text()).toContain('Confirm your own second factor first');
    click(button('Confirm my second factor'));
    expect(text()).toContain('Taking you to confirm it');
    expect(takeResume('user-email:u-1')).toEqual({ email: 'new@example.com' });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('back from the step-up: the address is in the form and nothing was changed', () => {
    serve(() => [200, {}]);
    mount('new@example.com');
    expect(text()).toContain('Second factor verified · nothing changed yet');
    expect((document.querySelector('#change-email-new') as HTMLInputElement).value).toBe('new@example.com');
    expect(calls).toHaveLength(0);
  });

  it('a taken address is refused under the field, without naming anybody', async () => {
    serve(() => [409, { error: 'address_unavailable', message: 'This address cannot be used. Choose another one.' }]);
    mount();
    type(document.querySelector('#change-email-new'), 'taken@example.com');
    click(button('Change email'));
    await flush();
    expect(text()).toContain('This address cannot be used. Choose another one.');
    expect(button('Change email')).not.toBeNull();
  });

  it('says why for their own account and for a stronger one', async () => {
    serve(() => [403, { error: 'outranked', message: 'This user holds administrative rights you do not.' }]);
    mount();
    type(document.querySelector('#change-email-new'), 'x@example.com');
    click(button('Change email'));
    await flush();
    expect(text()).toContain('They hold more than you');
    expect(text()).toContain('This user holds administrative rights you do not.');
  });
});

describe('UserProfileTab', () => {
  const user = { id: 'u-1', email: 'bob@example.com', name: 'Bob', groups: [], active: true } as unknown as User;
  const mount = (props: Partial<Parameters<typeof UserProfileTab>[0]> = {}) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}><UserProfileTab user={user} {...props} /></QueryClientProvider>);
  };

  it('the address is read-only, and saving sends the name alone', async () => {
    serve(() => [200, identity(true)]);
    mount();
    const email = document.querySelector('#profile-email') as HTMLInputElement;
    expect(email.readOnly).toBe(true);
    expect(text()).toContain('verified');
    type(document.querySelector('#profile-name'), 'Robert');
    click(button('Save profile'));
    await flush();
    expect(calls).toEqual([{ method: 'PUT', url: '/api/admin/users/u-1', body: { traits: { name: 'Robert' } } }]);
  });

  it('Change email opens the dialog; without users:update_email there is no such action', () => {
    serve(() => [200, {}]);
    mount();
    click(button('Change email'));
    expect(text()).toContain('Change the sign-in address of bob@example.com?');
    cleanup();
    h.session = { permissions: ['admin:write'], effective_permissions: ['users:read', 'users:update'] };
    mount();
    expect(button('Change email')).toBeNull();
  });

  it('back from a step-up, opens the dialog on the carried address', () => {
    serve(() => [200, {}]);
    mount({ resumedEmail: 'new@example.com' });
    expect((document.querySelector('#change-email-new') as HTMLInputElement).value).toBe('new@example.com');
  });

  it('an unverified address offers the resend; a verified one does not', () => {
    serve(() => [202, { sent: true }]);
    mount();
    expect(button('Resend verification email')).toBeNull();
    cleanup();
    h.identity = identity(false);
    mount();
    expect(text()).toContain('unverified');
    expect(button('Resend verification email')).not.toBeNull();
  });

  it('resends, and says so', async () => {
    h.identity = identity(false);
    serve(() => [202, { sent: true }]);
    mount();
    click(button('Resend verification email'));
    await flush();
    expect(calls).toEqual([{ method: 'POST', url: '/api/admin/users/u-1/verification', body: {} }]);
    expect(text()).toContain('Verification email sent');
  });

  it('rate-limited: nothing sent, and how long to wait', async () => {
    h.identity = identity(false);
    serve(() => [429, { error: 'rate_limited', message: 'Too many verification links were sent to this user recently. Try again later.', retryAfter: 540 }, { 'Retry-After': '540' }]);
    mount();
    click(button('Resend verification email'));
    await flush();
    expect(text()).toContain('Too many links for this person');
    expect(text()).toContain('Try again in 9 minutes');
  });

  it('Kratos not set up to verify by link: names the settings', async () => {
    h.identity = identity(false);
    serve(() => [409, { error: 'verification_link_unavailable', message: 'code only' }]);
    mount();
    click(button('Resend verification email'));
    await flush();
    expect(text()).toContain('selfservice.flows.verification.use: link');
  });

  it('without users:verify there is no resend', () => {
    h.identity = identity(false);
    h.session = { permissions: ['users:read'] };
    serve(() => [200, {}]);
    mount();
    expect(button('Resend verification email')).toBeNull();
  });
});
