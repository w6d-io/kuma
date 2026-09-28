import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, render } from './ui/testing';

const h = vi.hoisted(() => ({ data: undefined as unknown, mutate: vi.fn(), toast: vi.fn() }));
vi.mock('../api/hooks', () => ({
  useSignInProtection: () => ({ data: h.data, isError: false }),
  useSetSignInProtection: () => ({ mutate: h.mutate, isPending: false }),
}));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pushToast: h.toast }) }));

import { SignInProtectionSettings } from './SignInProtectionSettings';

afterEach(() => { cleanup(); h.mutate.mockReset(); });

const settings = () => ({
  captcha: { flows: { registration: false, login: false, recovery: false, verification: false }, failMode: 'closed' },
  registration: { mode: 'open', allowEmails: [], allowDomains: [], denyDomains: [], blockDisposable: false },
});
const view = (provider: Record<string, unknown> = {}) => ({
  settings: settings(), defaults: settings(), disposableDomains: 80,
  provider: { provider: 'turnstile', configured: true, siteKey: '0x4AAA-site', secretSet: true, testKeys: false, problem: null, ...provider },
});

const byText = (root: HTMLElement, sel: string, text: RegExp) =>
  [...root.querySelectorAll<HTMLElement>(sel)].find((e) => text.test(e.textContent ?? ''))!;
const click = (el: HTMLElement) => act(() => { el.click(); });
function type(el: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('SignInProtectionSettings', () => {
  it('shows the provider without the secret, and a switch per flow', () => {
    h.data = view();
    const { container } = render(<SignInProtectionSettings />);
    expect(container.textContent).toContain('Cloudflare Turnstile');
    expect(container.textContent).toContain('0x4AAA-site');
    expect(container.textContent).toContain('never shown');
    expect(container.querySelectorAll('[role="switch"]').length).toBe(5); // 4 flows + disposable
    expect((byText(container, 'button', /^Save$/) as HTMLButtonElement).disabled).toBe(true);
  });

  it('no provider: flows cannot be turned on, and the page says who configures it', () => {
    h.data = view({ configured: false, siteKey: null, secretSet: false, problem: 'CAPTCHA_SECRET_KEY is not set' });
    const { container } = render(<SignInProtectionSettings />);
    expect(container.textContent).toContain('not configured');
    expect(container.textContent).toContain('CAPTCHA_SECRET_KEY is not set');
    expect(container.textContent).toContain('needs a provider');
    expect(container.querySelectorAll('[role="switch"]').length).toBe(1);
  });

  it('turning on the sign-in check with Refuse warns about lockout; saving sends the whole document', () => {
    h.data = view();
    const { container } = render(<SignInProtectionSettings />);
    click(container.querySelector<HTMLElement>('[aria-label="Bot check on sign-in"]')!);
    expect(container.textContent).toContain('A provider outage would block every sign-in');
    click(byText(container, 'button', /^Save$/));
    expect(h.mutate).toHaveBeenCalledWith(
      { ...settings(), captcha: { flows: { registration: false, login: true, recovery: false, verification: false }, failMode: 'closed' } },
      expect.anything(),
    );
  });

  it('allow-list: validated inline, Save waits for a valid list', () => {
    h.data = view();
    const { container } = render(<SignInProtectionSettings />);
    click(byText(container, 'button', /^Allow-list$/));
    const save = byText(container, 'button', /^Save$/) as HTMLButtonElement;
    expect(container.textContent).toContain('Add at least one address or domain');
    expect(save.disabled).toBe(true);
    const box = container.querySelector<HTMLTextAreaElement>('textarea')!;
    type(box, 'corp.io\nnot valid');
    expect(container.textContent).toContain('Not an email address or a domain: not valid');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    type(box, 'corp.io\nguest@gmail.com');
    expect(save.disabled).toBe(false);
    click(save);
    expect(h.mutate.mock.calls[0][0].registration).toMatchObject({ mode: 'allowlist', allowDomains: ['corp.io'], allowEmails: ['guest@gmail.com'] });
  });

  it('closed: says accounts are admin-created and hides the lists', () => {
    h.data = view();
    const { container } = render(<SignInProtectionSettings />);
    click(byText(container, 'button', /^Closed$/));
    expect(container.textContent).toContain('admin-created accounts only');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('a refused save for a stale second factor sends the operator to re-verify', () => {
    h.data = view();
    h.mutate.mockImplementation((_s, o: { onError: (e: Error & { code?: string }) => void }) => o.onError(Object.assign(new Error('x'), { code: 'reauth_required' })));
    const { container } = render(<SignInProtectionSettings />);
    click(byText(container, 'button', /^Closed$/));
    click(byText(container, 'button', /^Save$/));
    expect(h.toast).toHaveBeenCalledWith('Two-factor re-verification required', expect.objectContaining({ err: true }));
    // Remembered for the way back, where it is saved again by itself.
    expect(JSON.parse(sessionStorage.getItem('kuma:resume:sign-in-protection') ?? '{}').data.next.registration.mode).toBe('closed');
  });
});
