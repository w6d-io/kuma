import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render, type } from '../../components/ui/testing';
import { formatWait, linkFailure, resetFailure } from '../../lib/recovery';

const h = vi.hoisted(() => ({ permissions: ['users:read', 'users:send_login_link', 'users:reset_second_factor'] as string[], toasts: [] as unknown[] }));
vi.mock('../../auth/session', () => ({ bearerToken: async () => null }));
vi.mock('../../contexts/AppContext', () => ({ useApp: () => ({ pushToast: (...a: unknown[]) => h.toasts.push(a) }) }));
vi.mock('../../api/hooks', () => ({ useSession: () => ({ data: { permissions: h.permissions } }) }));

import { SendLoginLinkDialog } from './SendLoginLinkDialog';
import { RemoveSecondFactorDialog } from './RemoveSecondFactorDialog';
import { UserSignInTab } from './UserSignInTab';
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

beforeEach(() => {
  h.permissions = ['users:read', 'users:send_login_link', 'users:reset_second_factor'];
  h.toasts = [];
  (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__ = 'auth.example.com';
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('lib/recovery', () => {
  it('reads each refusal of the sign-in link', () => {
    expect(linkFailure({ status: 429, retryAfter: 600 })).toEqual({ kind: 'rate_limited', retryAfterSeconds: 600 });
    expect(linkFailure({ status: 409, code: 'login_link_unavailable' })).toEqual({ kind: 'unavailable' });
    expect(linkFailure({ status: 422 })).toEqual({ kind: 'no_address' });
    expect(linkFailure({ status: 400, message: 'return_to is not an allowed return address.' })).toEqual({ kind: 'return_to_refused' });
    expect(linkFailure({ status: 500, message: 'boom' })).toEqual({ kind: 'failed', message: 'boom' });
  });

  it('says how long to wait', () => {
    expect(formatWait(600)).toBe('10 minutes');
    expect(formatWait(61)).toBe('2 minutes');
    expect(formatWait(45)).toBe('45 seconds');
    expect(formatWait(null)).toBe('a few minutes');
  });

  it('names the removal refusals the generic error would blur', () => {
    expect(resetFailure({ status: 422, code: 'reauth_required' }).stepUp).toBe(true);
    expect(resetFailure({ status: 403, code: 'own_second_factor' }).title).toBe('Not your own');
    expect(resetFailure({ status: 403, code: 'outranked', message: 'holds more' }).detail).toBe('holds more');
    expect(resetFailure({ status: 403 }).detail).toContain('users:reset_second_factor');
  });
});

describe('SendLoginLinkDialog', () => {
  const mount = () => render(<SendLoginLinkDialog open user={USER} onClose={() => {}} />);

  it('confirms what the link does before sending anything', () => {
    serve(() => [200, {}]);
    mount();
    expect(text()).toContain('Emails bob@example.com a one-click link valid for an hour');
    expect(text()).toContain('signs them in and opens their account settings');
    expect(calls).toHaveLength(0);
  });

  it('sends with the two-step gate as the return address, and says it was sent', async () => {
    serve(() => [200, { sent: true, expiresAt: '2026-09-28T13:00:00Z' }]);
    mount();
    click(button('Send link'));
    await flush();
    expect(calls).toEqual([{ method: 'POST', url: '/api/admin/users/u-1/login-link', body: { return_to: 'https://auth.example.com/two-step' } }]);
    expect(text()).toContain('Sign-in link sent');
  });

  it('when Kratos refuses the return address, sends once more without it', async () => {
    serve(c => ((c.body as { return_to?: string }).return_to
      ? [400, { error: 'Bad Request', message: 'return_to is not an allowed return address.' }]
      : [200, { sent: true, expiresAt: null }]));
    mount();
    click(button('Send link'));
    await flush();
    expect(calls.map(c => c.body)).toEqual([{ return_to: 'https://auth.example.com/two-step' }, {}]);
    expect(text()).toContain('Sign-in link sent');
  });

  it('rate-limited: nothing sent, and how long to wait', async () => {
    serve(() => [429, { error: 'Too Many Requests' }, { 'Retry-After': '540' }]);
    mount();
    click(button('Send link'));
    await flush();
    expect(text()).toContain('Too many links for this person');
    expect(text()).toContain('Try again in 9 minutes');
  });

  it('Kratos not set up for link recovery: names the settings to change', async () => {
    serve(() => [409, { error: 'login_link_unavailable', message: 'Kratos recovers accounts by code only' }]);
    mount();
    click(button('Send link'));
    await flush();
    expect(text()).toContain('Kratos is not set up to send sign-in links');
    expect(text()).toContain('selfservice.flows.recovery.use: link');
    expect(text()).toContain('selfservice.methods.link.enabled: true');
  });

  it('no address', async () => {
    serve(() => [422, { error: 'Unprocessable Entity' }]);
    mount();
    click(button('Send link'));
    await flush();
    expect(text()).toContain('No email address');
  });
});

describe('RemoveSecondFactorDialog', () => {
  const onRemoved = vi.fn();
  const onSendLink = vi.fn();
  const mount = (required: boolean | null = true) => render(
    <RemoveSecondFactorDialog open user={USER} methods={['totp', 'lookup_secret']} required={required}
      onClose={() => {}} onRemoved={onRemoved} onSendLink={onSendLink} />,
  );
  beforeEach(() => { onRemoved.mockReset(); onSendLink.mockReset(); });

  it('lists the factors, explains the next sign-in, and will not go without a reason', () => {
    serve(() => [200, {}]);
    mount();
    expect(text()).toContain('Authenticator app');
    expect(text()).toContain('Backup codes');
    expect(text()).toContain('asked to set up a new one before going on');
    expect(button('Remove two-step sign-in')!.disabled).toBe(true);
    type(document.querySelector('#second-factor-reason'), '   ');
    expect(button('Remove two-step sign-in')!.disabled).toBe(true);
  });

  it('removes with the reason and the sign-out choice, then offers the sign-in link', async () => {
    serve(() => [200, { removed: ['totp', 'lookup_secret'], sessionsRevoked: false }]);
    mount();
    type(document.querySelector('#second-factor-reason'), ' Lost their phone ');
    click(document.querySelector('input[type="checkbox"]'));
    click(button('Remove two-step sign-in'));
    await flush();
    expect(calls).toEqual([{
      method: 'POST', url: '/api/admin/users/u-1/second-factors/reset', body: { reason: 'Lost their phone', revokeSessions: false },
    }]);
    expect(text()).toContain('Two-step sign-in removed');
    expect(onRemoved).toHaveBeenCalledWith({ removed: ['totp', 'lookup_secret'], sessionsRevoked: false });
    click(button('Also send a sign-in link'));
    expect(onSendLink).toHaveBeenCalled();
  });

  it('asks for the caller\'s own second factor when jinbe wants it recent', async () => {
    serve(() => [422, { error: 'reauth_required', message: 'recent second factor' }]);
    mount();
    type(document.querySelector('#second-factor-reason'), 'Lost phone');
    click(button('Remove two-step sign-in'));
    await flush();
    expect(text()).toContain('Confirm your own second factor first');
    expect(button('Confirm my second factor')).not.toBeNull();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('says why jinbe refused your own account', async () => {
    serve(() => [403, { error: 'own_second_factor', message: 'no' }]);
    mount();
    type(document.querySelector('#second-factor-reason'), 'x');
    click(button('Remove two-step sign-in'));
    await flush();
    expect(text()).toContain('Remove your own two-step sign-in from your account settings');
  });
});

describe('UserSignInTab', () => {
  const user = { id: 'u-1', email: 'bob@example.com', name: 'Bob', groups: [], active: true } as unknown as User;
  const mount = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}><UserSignInTab user={user} /></QueryClientProvider>);
  };

  it('offers removal only when the user has a factor', async () => {
    serve(() => [200, { methods: ['totp'], required: true }]);
    mount();
    await flush();
    expect(calls[0].url).toBe('/api/admin/users/u-1/second-factors');
    expect(text()).toContain('Authenticator app');
    expect(button('Remove two-step sign-in')).not.toBeNull();
    expect(button('Send sign-in link')).not.toBeNull();
  });

  it('no factor: no removal, and says when their role requires one', async () => {
    serve(() => [200, { methods: [], required: true }]);
    mount();
    await flush();
    expect(button('Remove two-step sign-in')).toBeNull();
    expect(text()).toContain('they will be asked to set it up at their next sign-in');
  });

  it('the support desk sends links but does not remove factors', async () => {
    h.permissions = ['users:read', 'users:send_login_link'];
    serve(() => [200, { methods: ['totp'], required: false }]);
    mount();
    await flush();
    expect(button('Remove two-step sign-in')).toBeNull();
    expect(button('Send sign-in link')).not.toBeNull();
  });

  it('opens the confirm dialogs', async () => {
    serve(() => [200, { methods: ['webauthn'], required: false }]);
    mount();
    await flush();
    click(button('Remove two-step sign-in'));
    expect(text()).toContain('Remove two-step sign-in for bob@example.com?');
    expect(text()).toContain('Security keys');
  });
});
