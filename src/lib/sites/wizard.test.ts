import { describe, it, expect } from 'vitest';
import { addressProblems, siteFrom, INITIAL } from './wizard';

const filled = { ...INITIAL, label: 'payroll', zone: 'dev.stairling.com', service: 'payroll-ui', namespace: 'payroll', port: '8080', name: 'payroll', displayName: 'Payroll' };

describe('wizard', () => {
  it('lists what the address step still needs', () => {
    expect(addressProblems(INITIAL).length).toBeGreaterThan(0);
    expect(addressProblems(filled)).toEqual([]);
    expect(addressProblems({ ...filled, pathPrefix: 'x' })).toContain('A path prefix is literal, like /payroll.');
  });
  it('builds the intent with groups and org-grantable groups', () => {
    const s = siteFrom({ ...filled, groups: { admins: 'admin', devs: '' }, orgsOn: true, orgs: ['11111111-1111-1111-1111-111111111111'] });
    expect(s.address.host).toBe('payroll.dev.stairling.com');
    expect(s.upstream).toEqual({ service: 'payroll-ui', namespace: 'payroll', port: 8080 });
    expect(s.groups.platform).toEqual({ admins: ['admin'] });
    expect(Object.keys(s.groups.orgGrantable)).toEqual(['payroll-editors', 'payroll-viewers']);
    expect(s.orgs).toHaveLength(1);
  });
  it('drops orgs when the toggle is off', () => {
    expect(siteFrom({ ...filled, orgs: ['x'] }).orgs).toEqual([]);
    expect(siteFrom(filled).groups.orgGrantable).toEqual({});
  });
});
