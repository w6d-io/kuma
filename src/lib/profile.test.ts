import { describe, it, expect } from 'vitest';
import { emailError, profileChange } from './profile';

const cur = { name: 'Ada' };

describe('profileChange', () => {
  it('is null when nothing changed', () => {
    expect(profileChange(cur, { name: ' Ada ' })).toBeNull();
  });

  it('sends the name alone — never an address', () => {
    expect(profileChange(cur, { name: 'Ada L.' })).toEqual({ traits: { name: 'Ada L.' } });
    expect(profileChange(cur, { name: 'Ada L.', email: 'ada@new.io' } as never)).toEqual({ traits: { name: 'Ada L.' } });
  });
});

describe('emailError', () => {
  it('refuses an empty or malformed email', () => {
    expect(emailError('')).toMatch(/required/);
    expect(emailError('nope')).toMatch(/not an email/);
    expect(emailError('ada@example.com')).toBeNull();
  });
});
