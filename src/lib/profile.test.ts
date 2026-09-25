import { describe, it, expect } from 'vitest';
import { profileChange, profileError } from './profile';

const cur = { name: 'Ada', email: 'ada@example.com' };

describe('profileChange', () => {
  it('is null when nothing changed', () => {
    expect(profileChange(cur, { name: ' Ada ', email: 'ADA@example.com' })).toBeNull();
  });

  it('sends only the field that changed', () => {
    expect(profileChange(cur, { name: 'Ada L.', email: cur.email })).toEqual({ traits: { name: 'Ada L.' } });
    expect(profileChange(cur, { name: cur.name, email: 'ada@new.io' })).toEqual({ traits: { email: 'ada@new.io' } });
  });
});

describe('profileError', () => {
  it('refuses an empty or malformed email', () => {
    expect(profileError({ name: '', email: '' })).toMatch(/required/);
    expect(profileError({ name: '', email: 'nope' })).toMatch(/not an email/);
    expect(profileError(cur)).toBeNull();
  });
});
