import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, render } from './ui/testing';
import { TWO_STEP_EVENT } from '../lib/stepUp';

const status = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('../api/hooks', () => ({ useSecondFactorStatus: () => ({ data: status.data }) }));
const own = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('../api/twoFactor', () => ({ useOwnSecondFactor: () => ({ data: own.data }) }));

import { SecondFactorBanner } from './SecondFactorBanner';

afterEach(() => { cleanup(); own.data = undefined; delete (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__; });

describe('SecondFactorBanner', () => {
  it('required and none set up: persistent banner with a one-click link that comes back here', () => {
    (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__ = 'auth.example.net';
    status.data = { secondFactorRequired: true, hasSecondFactor: false, methods: [], aal: 'aal1' };
    const { container } = render(<SecondFactorBanner />);
    expect(container.textContent).toContain('Two-step sign-in is required for your role — set it up now');
    const a = container.querySelector('a')!;
    expect(a.getAttribute('href')).toBe(`https://auth.example.net/two-step?return_to=${encodeURIComponent(window.location.href)}`);
  });

  it('names the groups that make it required, when jinbe says', () => {
    status.data = { secondFactorRequired: true, hasSecondFactor: false, methods: [], aal: 'aal1' };
    own.data = { required: true, requiredBecause: ['ops', 'super_admins'], enrolled: false, currentAal: 'aal1', factorAgeMin: null, stepUpFresh: false, stepUpPermissions: [] };
    const { container } = render(<SecondFactorBanner />);
    expect(container.textContent).toContain('required for you as a member of ops, super_admins');
  });

  it('has a factor at aal1: nothing until an action needs it, then "Confirm your second factor"', () => {
    status.data = { secondFactorRequired: true, hasSecondFactor: true, methods: ['totp'], aal: 'aal1' };
    const { container } = render(<SecondFactorBanner />);
    expect(container.textContent).toBe('');
    act(() => { window.dispatchEvent(new CustomEvent(TWO_STEP_EVENT, { detail: { to: 'https://auth.example.net/two-step?return_to=x' } })); });
    expect(container.textContent).toContain('Confirm your second factor');
    expect(container.querySelector('a')!.getAttribute('href')).toBe('https://auth.example.net/two-step?return_to=x');
  });

  it('gone once they have a second factor (or the role does not require one)', () => {
    status.data = { secondFactorRequired: true, hasSecondFactor: true, methods: ['totp'], aal: 'aal2' };
    expect(render(<SecondFactorBanner />).container.textContent).toBe('');
    cleanup();
    status.data = { secondFactorRequired: false, hasSecondFactor: false, methods: [], aal: 'aal1' };
    expect(render(<SecondFactorBanner />).container.textContent).toBe('');
  });
});
