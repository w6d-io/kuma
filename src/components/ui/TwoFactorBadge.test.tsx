import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from './testing';
import { TwoFactorBadge } from './TwoFactorBadge';
import { siteNotEnforced } from '../../lib/twoFactor';

afterEach(cleanup);

// jinbe's `secondFactor.enforced: false`: the badge turns to danger everywhere it is shown, and the
// list says which gate in words.
describe('2FA set but not enforced', () => {
  const sf = { scope: 'all' as const, routes: [], enforced: false, notEnforcedOn: ['web'], summary: "Two-step sign-in is set but NOT enforced: gate 'web' never asks the policy." };
  it('the badge is danger and says so, with jinbe’s sentence on hover', () => {
    render(<TwoFactorBadge kind="site" site={sf} />);
    const badge = document.querySelector('[title]')!;
    expect(badge.textContent).toContain('2FA NOT enforced');
    expect(badge.getAttribute('title')).toBe(sf.summary);
  });
  it('names the gate; says nothing when enforced or when no bar is set', () => {
    expect(siteNotEnforced(sf)).toBe('2FA set but NOT enforced (gate web never checks 2FA or permissions)');
    expect(siteNotEnforced({ ...sf, enforced: true })).toBeNull();
    expect(siteNotEnforced({ ...sf, scope: 'none' })).toBeNull();
  });
});
