import { describe, it, expect } from 'vitest';
import { stepUpUrl } from './stepUp';

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
