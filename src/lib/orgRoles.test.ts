import { describe, it, expect } from 'vitest';
import {
  columnsFor, toggleRole, changedMembers, sameSet, entitledSites, ownersOf, roleLabel, myOrgVisibility, readMemberInput,
} from './orgRoles';

const role = (r: string, assignable = true, permissions: string[] = []) => ({ role: r, permissions, assignable });

describe('columnsFor', () => {
  it('lists the org roles, then a held role the org no longer offers, marked retired', () => {
    const cols = columnsFor([role('jinbe:viewer'), role('jinbe:owner', false)], { u1: ['payroll:editor', 'jinbe:viewer'] });
    expect(cols.map((c) => [c.role, c.assignable, c.retired])).toEqual([
      ['jinbe:owner', false, false],
      ['jinbe:viewer', true, false],
      ['payroll:editor', false, true],
    ]);
  });
});

describe('toggleRole', () => {
  it('adds and removes one role for one member without touching the others', () => {
    const d0 = { u1: ['jinbe:viewer'], u2: ['jinbe:viewer'] };
    const d1 = toggleRole(d0, 'u1', 'jinbe:auditor');
    expect(d1.u1).toEqual(['jinbe:viewer', 'jinbe:auditor']);
    expect(d1.u2).toBe(d0.u2);
    expect(toggleRole(d1, 'u1', 'jinbe:viewer').u1).toEqual(['jinbe:auditor']);
    expect(toggleRole({}, 'u3', 'jinbe:viewer')).toEqual({ u3: ['jinbe:viewer'] });
  });
});

describe('changedMembers and sameSet', () => {
  it('names only the members whose set differs, order aside', () => {
    expect(changedMembers({ u1: ['a', 'b'], u2: ['a'] }, { u1: ['b', 'a'], u2: [], u3: [] })).toEqual(['u2']);
  });

  it('compares as sets', () => {
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSet(['a'], undefined)).toBe(false);
    expect(sameSet([], undefined)).toBe(true);
  });
});

describe('entitledSites, ownersOf, roleLabel', () => {
  it('reads the sites from the org roles, never jinbe', () => {
    expect(entitledSites([role('jinbe:owner'), role('payroll:editor'), role('payroll:viewer'), role('crm:agent')])).toEqual(['crm', 'payroll']);
  });

  it('finds the owners among the members', () => {
    expect(ownersOf({ u2: ['jinbe:owner'], u1: ['jinbe:viewer'], u3: ['jinbe:owner', 'x:y'] })).toEqual(['u2', 'u3']);
  });

  it('labels a site role with its site and jinbe roles plainly', () => {
    expect(roleLabel('payroll:editor')).toEqual({ name: 'editor', site: 'payroll' });
    expect(roleLabel('jinbe:owner')).toEqual({ name: 'owner', site: null });
  });
});

describe('myOrgVisibility', () => {
  it('hides the page from somebody holding nothing in any org', () => {
    expect(myOrgVisibility({ administered: [], mayReadAll: false })).toEqual({ show: false, pickAny: false });
  });

  it('shows it limited to the orgs where they hold something', () => {
    expect(myOrgVisibility({ administered: ['o1'], mayReadAll: false })).toEqual({ show: true, pickAny: false });
  });

  it('shows every org to somebody who may list them all', () => {
    expect(myOrgVisibility({ administered: [], mayReadAll: true })).toEqual({ show: true, pickAny: true });
  });
});

describe('readMemberInput', () => {
  it('reads a user id as an id and an address as an email', () => {
    expect(readMemberInput(' 90C4FFA7-3ac2-4fbc-a0a4-5b66870a74b8 ')).toEqual({ kind: 'id', id: '90c4ffa7-3ac2-4fbc-a0a4-5b66870a74b8' });
    expect(readMemberInput('Bob@Example.com')).toEqual({ kind: 'email', email: 'bob@example.com' });
  });

  it('refuses anything else', () => {
    expect(readMemberInput('bob')).toEqual({ kind: 'invalid' });
    expect(readMemberInput('')).toEqual({ kind: 'invalid' });
  });
});
