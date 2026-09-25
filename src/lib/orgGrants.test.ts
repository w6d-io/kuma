import { describe, it, expect } from 'vitest';
import { columnsFor, toggleGrant, changedMembers, sameGroups, myOrgVisibility, readMemberInput } from './orgGrants';

describe('columnsFor', () => {
  it('lists what may be granted, then what is held but may not be, marked', () => {
    expect(columnsFor(['viewers', 'editors'], { 'a@x': ['legacy', 'viewers'] })).toEqual([
      { name: 'editors', grantable: true },
      { name: 'viewers', grantable: true },
      { name: 'legacy', grantable: false },
    ]);
  });
});

describe('toggleGrant', () => {
  it('adds and removes one group for one person without touching the others', () => {
    const d0 = { 'a@x': ['viewers'], 'b@x': ['viewers'] };
    const d1 = toggleGrant(d0, 'a@x', 'editors');
    expect(d1['a@x']).toEqual(['viewers', 'editors']);
    expect(d1['b@x']).toBe(d0['b@x']);
    expect(toggleGrant(d1, 'a@x', 'viewers')['a@x']).toEqual(['editors']);
    expect(toggleGrant({}, 'c@x', 'viewers')).toEqual({ 'c@x': ['viewers'] });
  });
});

describe('changedMembers', () => {
  it('names only the people whose set differs, order aside', () => {
    const saved = { 'a@x': ['v', 'e'], 'b@x': ['v'] };
    const draft = { 'a@x': ['e', 'v'], 'b@x': [], 'c@x': [] };
    expect(changedMembers(saved, draft)).toEqual(['b@x']);
  });
});

describe('sameGroups', () => {
  it('compares as sets', () => {
    expect(sameGroups(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameGroups(['a'], undefined)).toBe(false);
    expect(sameGroups([], undefined)).toBe(true);
  });
});

describe('myOrgVisibility', () => {
  it('hides the page from somebody who administers nothing', () => {
    expect(myOrgVisibility({ administered: [], mayReadAll: false })).toEqual({ show: false, pickAny: false });
  });

  it('shows it to an org admin, limited to their orgs', () => {
    expect(myOrgVisibility({ administered: ['o1'], mayReadAll: false })).toEqual({ show: true, pickAny: false });
  });

  it('shows every org to somebody who may read them all', () => {
    expect(myOrgVisibility({ administered: [], mayReadAll: true })).toEqual({ show: true, pickAny: true });
  });
});

describe('readMemberInput', () => {
  it('reads a user id as an id and an address as an email', () => {
    expect(readMemberInput(' 90C4FFA7-3ac2-4fbc-a0a4-5b66870a74b8 ')).toEqual({ kind: 'id', id: '90c4ffa7-3ac2-4fbc-a0a4-5b66870a74b8' });
    expect(readMemberInput('Bob@Acme.io')).toEqual({ kind: 'email', email: 'bob@acme.io' });
  });

  it('refuses anything else', () => {
    expect(readMemberInput('bob')).toEqual({ kind: 'invalid' });
    expect(readMemberInput('')).toEqual({ kind: 'invalid' });
  });
});
