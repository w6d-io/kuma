import { describe, it, expect } from 'vitest';
import { mayBounceToTwoStep, stepUpUrl, twoStepUrl } from './stepUp';

describe('stepUpUrl', () => {
  it('asks for the level AND for the factor to be proven again', () => {
    // Without `refresh` Kratos answers that aal2 is already held and never re-asks, so a stale
    // factor can never be renewed — the loop this address exists to break.
    const url = stepUpUrl('auth.example.net', 'https://auth.example.net/admin/users');
    expect(url).toContain('aal=aal2');
    expect(url).toContain('refresh=true');
  });

  it('comes back to where the change was attempted', () => {
    expect(stepUpUrl('auth.example.net', 'https://auth.example.net/admin/users?q=a&b=c')).toBe(
      'https://auth.example.net/login?aal=aal2&refresh=true' +
      '&return_to=https%3A%2F%2Fauth.example.net%2Fadmin%2Fusers%3Fq%3Da%26b%3Dc',
    );
  });
});

describe('twoStepUrl', () => {
  it('goes to the sign-in site\'s two-step gate and comes back here', () => {
    expect(twoStepUrl('auth.example.net', 'https://kuma.example.net/users?q=a')).toBe(
      'https://auth.example.net/two-step?return_to=https%3A%2F%2Fkuma.example.net%2Fusers%3Fq%3Da',
    );
  });
});

describe('mayBounceToTwoStep', () => {
  it('bounces at most twice a minute, so a gate that cannot help never loops', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    let t = 5_000_000;
    const now = () => t;
    expect(mayBounceToTwoStep(s, now)).toBe(true);
    expect(mayBounceToTwoStep(s, now)).toBe(true);
    expect(mayBounceToTwoStep(s, now)).toBe(false);
    t += 61_000;
    expect(mayBounceToTwoStep(s, now)).toBe(true);
    expect(mayBounceToTwoStep(null, now)).toBe(true);
  });
});
