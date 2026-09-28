import { describe, it, expect } from 'vitest';
import { describeHit, isEmail, isKratosId, linkedPerson, lookupTerm } from './personFind';

const ID = '6f1c9a52-3b0e-4d0e-9a55-0f3c2b1d7e10';

describe('isKratosId', () => {
  it('accepts a pasted id, spaces and case forgiven', () => {
    expect(isKratosId(ID)).toBe(true);
    expect(isKratosId(`  ${ID.toUpperCase()}\n`)).toBe(true);
  });
  it('refuses anything else', () => {
    expect(isKratosId('alice@example.com')).toBe(false);
    expect(isKratosId(ID.slice(0, 35))).toBe(false);
  });
});

describe('lookupTerm', () => {
  it('waits for two characters', () => {
    expect(lookupTerm('a')).toBeNull();
    expect(lookupTerm('  ')).toBeNull();
    expect(lookupTerm(' al ')).toBe('al');
  });
  it('sends an id lower-cased', () => {
    expect(lookupTerm(ID.toUpperCase())).toBe(ID);
  });
});

describe('isEmail', () => {
  it('matches the checker', () => {
    expect(isEmail('a@b')).toBe(true);
    expect(isEmail('alice@')).toBe(false);
  });
});

describe('describeHit', () => {
  it('names the person, groups and 2FA', () => {
    expect(describeHit({ id: ID, email: 'a@x.io', name: 'Alice', active: true, groups: ['ops'], organizations: [], mfa: true }))
      .toBe('Alice <a@x.io> · groups: ops · 2FA on');
  });
  it('says what is unknown by leaving it out, and says inactive and "no groups"', () => {
    expect(describeHit({ id: ID, email: 'a@x.io', name: null, active: false, groups: [], organizations: null, mfa: null }))
      .toBe('a@x.io · inactive · no groups');
  });
});

describe('linkedPerson', () => {
  it('reads ?user=<id> as an id to look up', () => {
    expect(linkedPerson({ user: ID.toUpperCase() })).toEqual({ email: '', id: ID });
  });
  it('reads ?user=<email> and the older ?email= as the address', () => {
    expect(linkedPerson({ user: 'a@x.io' })).toEqual({ email: 'a@x.io', id: null });
    expect(linkedPerson({ email: 'b@x.io' })).toEqual({ email: 'b@x.io', id: null });
    expect(linkedPerson(undefined)).toEqual({ email: '', id: null });
  });
});
