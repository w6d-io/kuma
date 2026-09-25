import { describe, it, expect } from 'vitest';
import { parseHash, formatHash } from './route';

describe('parseHash', () => {
  it('reads a bare page as before', () => {
    expect(parseHash('#/groups')).toEqual({ page: 'groups', param: null });
  });

  it('reads a person link onto the users page', () => {
    expect(parseHash('#/people/abc-123')).toEqual({ page: 'users', param: 'abc-123' });
  });

  it('still accepts the internal id', () => {
    expect(parseHash('#/users/abc')).toEqual({ page: 'users', param: 'abc' });
  });

  it('reads an organisation link', () => {
    expect(parseHash('#/organizations/0b6c')).toEqual({ page: 'organizations', param: '0b6c' });
  });

  it('falls back to the overview for an unknown page', () => {
    expect(parseHash('#/nope/1')).toEqual({ page: 'dashboard', param: null });
    expect(parseHash('')).toEqual({ page: 'dashboard', param: null });
  });

  it('survives a malformed escape', () => {
    expect(parseHash('#/people/%E0%A4%A')).toEqual({ page: 'users', param: null });
  });
});

describe('formatHash', () => {
  it('writes people links with the public name', () => {
    expect(formatHash('users', 'abc')).toBe('/people/abc');
    expect(formatHash('users')).toBe('/users');
  });

  it('round-trips an id that needs escaping', () => {
    const h = formatHash('organizations', 'a/b c');
    expect(parseHash(`#${h}`)).toEqual({ page: 'organizations', param: 'a/b c' });
  });
});

describe('query on the hash', () => {
  it('reads the access checker link with its query', () => {
    expect(parseHash('#/access-check?email=a%40b.c&method=GET&path=%2Fapi%2Fx')).toEqual({
      page: 'accesscheck',
      param: null,
      query: { email: 'a@b.c', method: 'GET', path: '/api/x' },
    });
  });

  it('keeps a param and a query apart', () => {
    expect(parseHash('#/orgadmin/o1?x=1')).toEqual({ page: 'orgadmin', param: 'o1', query: { x: '1' } });
  });

  it('writes the public name and the query, dropping empty values', () => {
    const h = formatHash('accesscheck', null, { email: 'a@b.c', method: 'GET', path: '/api/x', app: '' });
    expect(h).toBe('/access-check?email=a%40b.c&method=GET&path=%2Fapi%2Fx');
    expect(parseHash(`#${h}`).query).toEqual({ email: 'a@b.c', method: 'GET', path: '/api/x' });
  });

  it('writes no query mark when there is nothing to carry', () => {
    expect(formatHash('accesscheck', null, {})).toBe('/access-check');
  });
});
