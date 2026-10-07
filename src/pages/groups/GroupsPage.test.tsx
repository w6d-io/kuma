import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, type } from '../../components/ui/testing';
import { bySite, kindOf, matches, twoFactorSourceOf, twoFactorStateOf, type GroupRow } from './groupKinds';

// Groups in three tables, because each kind is changed differently: staff (built in, read-only),
// site access (roles on sites only, whatever the name) and platform access (a platform role, or none
// yet). Each row says whether members must use two-step sign-in and why; the search crosses them all.

const h = vi.hoisted(() => ({
  open: vi.fn(),
  rules: {} as Record<string, { required: boolean; source?: 'group_setting' | 'default'; defaultRequired?: boolean }>,
}));
vi.mock('../../contexts/AppContext', () => ({
  useApp: () => ({
    state: {
      groups: {
        'staff-developers': { jinbe: ['developer'] },
        super_admins: { jinbe: ['super_admin'] },
        'echo-users': { echo: ['reader'] },
        enrollment_users: { 'enrollment-service': ['user'] },
        'shop-and-echo': { shop: ['viewer'], echo: ['reader'] },
        'billing-admins': { jinbe: ['viewer'], billing: ['admin'] },
        drafts: {},
      },
      groupsMeta: { 'staff-developers': { system: true, description: 'Builds sites and their access' }, super_admins: { system: true, description: 'Everything' } },
      services: [], roles: {},
    },
    pageParam: null,
    setPage: h.open,
  }),
}));
vi.mock('../../api/hooks', () => ({ useStats: () => ({ data: { perGroup: { 'echo-users': 3 } } }), useSession: () => ({ data: { permissions: [] } }) }));
vi.mock('../../api/rbacWrites', () => ({ useRbacUsers: () => ({ data: undefined }) }));
vi.mock('../../api/twoFactor', () => ({ useGroupSecondFactors: () => (g: string) => h.rules[g] }));
vi.mock('./GroupEditor', () => ({ GroupEditor: () => null }));

import { GroupsPage } from './GroupsPage';

const tableOf = (label: string) => document.querySelector(`table[aria-label="${label}"]`) as HTMLTableElement;
const namesIn = (label: string) => [...tableOf(label).querySelectorAll('tbody tr.row-click .mono')].map((n) => n.textContent);
async function settle() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

beforeEach(() => {
  h.open.mockReset();
  h.rules = {
    'staff-developers': { required: true, source: 'group_setting', defaultRequired: true },
    super_admins: { required: true },
    'echo-users': { required: false, source: 'default', defaultRequired: false },
    enrollment_users: { required: true, source: 'group_setting', defaultRequired: false },
    'billing-admins': { required: true, source: 'default', defaultRequired: true },
  };
});
afterEach(cleanup);

describe('kinds and two-step rules', () => {
  it('staff from the built-in flag; site access whatever the name; a platform role makes it platform access', () => {
    expect(kindOf({ jinbe: ['developer'] }, { system: true })).toBe('staff');
    expect(kindOf({ 'enrollment-service': ['user'] }, undefined)).toBe('site')
    expect(kindOf({ jinbe: ['viewer'], billing: ['admin'] }, undefined)).toBe('platform');
    expect(kindOf({ kuma: ['x'] }, undefined)).toBe('platform')
    expect(kindOf({}, undefined)).toBe('empty');
    expect(kindOf({ echo: [] }, undefined)).toBe('empty')
  });

  it('locked for staff, required, optional, unknown — and default vs set by a super admin', () => {
    expect(twoFactorStateOf('staff', { required: true })).toBe('locked');
    expect(twoFactorStateOf('site', { required: true })).toBe('required')
    expect(twoFactorStateOf('site', { required: false, enrolBeforeJoining: true })).toBe('required');
    expect(twoFactorStateOf('site', { required: false })).toBe('optional')
    expect(twoFactorStateOf('site', undefined)).toBe('unknown');
    expect(twoFactorSourceOf({ required: true, source: 'group_setting', defaultRequired: false })).toBe('set')
    expect(twoFactorSourceOf({ required: true, source: 'group_setting', defaultRequired: true })).toBe('default');
    expect(twoFactorSourceOf({ required: false, source: 'default' })).toBe('default')
    expect(twoFactorSourceOf({ required: false })).toBeNull();
  });

  it('search matches a name, a site, a role or a description; site rows group per site, several sites last', () => {
    const row = (name: string, def: Record<string, string[]>): GroupRow => ({ name, def, apps: Object.keys(def).sort(), kind: 'site', members: 0, twoFactor: 'optional', twoFactorSource: null });
    expect(matches({ ...row('echo-users', { echo: ['reader'] }) }, 'READER')).toBe(true);
    expect(matches({ ...row('x', {}), description: 'Builds sites' }, 'builds')).toBe(true)
    expect(matches(row('echo-users', { echo: ['reader'] }), 'billing')).toBe(false);
    expect(bySite([row('b', { shop: ['v'], echo: ['r'] }), row('z', { echo: ['r'] }), row('a', { echo: ['r'] })]).map((s) => [s.site, s.rows.map((r) => r.name)]))
      .toEqual([['echo', ['a', 'z']], [null, ['b']]])
  });
});

describe('the Groups page', () => {
  it('puts each group in its own table, site access under its site with a link to its Users tab', async () => {
    render(<GroupsPage />);
    await settle();
    expect(namesIn('Staff groups')).toEqual(['staff-developers', 'super_admins']);
    expect(namesIn('Site access groups')).toEqual(['echo-users', 'enrollment_users', 'shop-and-echo']);
    expect(namesIn('Platform access groups')).toEqual(['billing-admins', 'drafts']);
    const heads = [...tableOf('Site access groups').querySelectorAll('.groups-site-head')].map((r) => r.textContent);
    expect(heads[0]).toContain('echo');
    expect(heads.at(-1)).toContain('Several sites');
    expect(tableOf('Site access groups').querySelector('a[href="#/sites/echo/users"]')).not.toBeNull();
    // Staff rows say why they are read-only, and what the role does.
    expect(tableOf('Staff groups').textContent).toContain('built in');
    expect(tableOf('Staff groups').textContent).toContain('Builds sites and their access');
    expect(tableOf('Platform access groups').textContent).toContain('no role yet');
  });

  it('marks two-step sign-in per row: locked for staff, required with why, optional in plain words', async () => {
    render(<GroupsPage />);
    await settle();
    const staff = tableOf('Staff groups').querySelector('tbody tr')!;
    expect(staff.textContent).toContain('2FA required');
    expect(staff.textContent).toContain('locked');
    const rowNamed = (label: string, name: string) => [...tableOf(label).querySelectorAll('tbody tr.row-click')].find((r) => r.textContent?.includes(name))!;
    expect(rowNamed('Site access groups', 'enrollment_users').querySelector('[title*="Turned on by a super admin"]')).not.toBeNull();
    const echo = rowNamed('Site access groups', 'echo-users');
    expect(echo.textContent).toContain('Optional');
    expect(echo.querySelector('[title*="site\'s own two-step setting decides"]')).not.toBeNull();
    expect(echo.textContent).toContain('3');
    expect(rowNamed('Platform access groups', 'billing-admins').querySelector('[title*="On by default"]')).not.toBeNull();
  });

  it('the search crosses every table, and an empty table says nothing of its kind matches', async () => {
    render(<GroupsPage />);
    await settle();
    type(document.querySelector('input[aria-label="Find a group"]'), 'reader');
    await settle();
    expect(namesIn('Site access groups')).toEqual(['echo-users', 'shop-and-echo']);
    expect(namesIn('Staff groups')).toEqual([]);
    expect(tableOf('Staff groups').textContent).toContain('No group of this kind matches.');
  });

  it('opening a row opens that group', async () => {
    render(<GroupsPage />);
    await settle();
    (tableOf('Site access groups').querySelector('tr.row-click') as HTMLElement).click();
    expect(h.open).toHaveBeenCalledWith('groups', 'echo-users');
  });
});
