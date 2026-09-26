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

describe('the living style guide', () => {
  it('is addressable as #/design and written back the same way', () => {
    expect(parseHash('#/design')).toEqual({ page: 'design', param: null });
    expect(formatHash('design')).toBe('/design');
  });
});

describe('old links from before the new navigation', () => {
  it('sends the retired simulator to the access checker', () => {
    expect(parseHash('#/simulator')).toEqual({ page: 'accesscheck', param: null });
  });

  it('sends services to sites, keeping the site named', () => {
    expect(parseHash('#/services/payroll')).toEqual({ page: 'sites', param: 'payroll' });
  });

  it('sends routes to the permissions view of the site', () => {
    expect(parseHash('#/routes/jinbe')).toEqual({ page: 'roles', param: 'jinbe', query: { tab: 'permissions' } });
  });

  it('lets an explicit query win over the redirect default', () => {
    expect(parseHash('#/routes/jinbe?tab=roles').query).toEqual({ tab: 'roles' });
  });

  it('sends the old gateway rules, APIs and enforced screens to gateway handlers', () => {
    expect(parseHash('#/rules')).toEqual({ page: 'gateway', param: null });
    expect(parseHash('#/apis')).toEqual({ page: 'gateway', param: null });
    expect(parseHash('#/enforced')).toEqual({ page: 'gateway', param: null });
  });

  it('opens roles by site and writes it back the same way', () => {
    expect(parseHash('#/roles/kuma?tab=permissions')).toEqual({ page: 'roles', param: 'kuma', query: { tab: 'permissions' } });
    expect(formatHash('roles', 'kuma', { tab: 'permissions' })).toBe('/roles/kuma?tab=permissions');
  });
});

describe('pages that read deeper segments themselves', () => {
  it('keeps sites, gateway and audit on their page with the second segment as param', () => {
    expect(parseHash('#/sites/payroll/routes?route=r1')).toEqual({ page: 'sites', param: 'payroll', query: { route: 'r1' } });
    expect(parseHash('#/sites/new?step=kind')).toEqual({ page: 'sites', param: 'new', query: { step: 'kind' } });
    expect(parseHash('#/gateway/authenticators/jwt?level=expert')).toEqual({ page: 'gateway', param: 'authenticators', query: { level: 'expert' } });
    expect(parseHash('#/audit/event/e1?ts=x')).toEqual({ page: 'audit', param: 'event', query: { ts: 'x' } });
  });
});
