import { describe, it, expect } from 'vitest';
import { summarizeArtefact, ruleStem, riskLine, checkCounts, intentChanges } from './diffWords';
import { buildSite } from './templates';

describe('summarizeArtefact', () => {
  it('counts route map rows by method and path, in words', () => {
    const s = summarizeArtefact({
      kind: 'routeMap', id: 'payroll', fields: [],
      before: [{ method: 'GET', path: '/a' }, { method: 'GET', path: '/old' }, { method: 'POST', path: '/x', permission: 'x:create' }],
      after: [{ method: 'GET', path: '/a' }, { method: 'GET', path: '/assets/:any*' }, { method: 'POST', path: '/x', permission: 'x:update', org_param: 'orgId' }],
    });
    expect(s.label).toBe('Routes (policy)');
    expect(s.line).toBe('+1 · −1 · 1 changed');
    expect(s.items).toContainEqual({ sign: '+', text: 'GET /assets/* → signed-in' });
    expect(s.items).toContainEqual({ sign: '~', text: 'POST /x: x:create → x:update · org from :orgId' });
    expect(s.items).toContainEqual({ sign: '−', text: 'GET /old' });
  });
  it('pairs a renamed rule by its stem', () => {
    expect(ruleStem('site-payroll-api-0123456789')).toBe('site-payroll-api');
    const s = summarizeArtefact({
      kind: 'rules', id: 'payroll', fields: [],
      before: { 'site-payroll-api-0123456789': { a: 1 } },
      after: { 'site-payroll-api-abcdefabcd': { a: 2 }, 'site-payroll-public-1111111111': {} },
    });
    expect(s.items).toContainEqual({ sign: '~', text: 'site-payroll-api (rule renamed: its templates or pattern changed)' });
    expect(s.items).toContainEqual({ sign: '+', text: 'site-payroll-public' });
  });
  it('lists permissions a role gains or loses', () => {
    const s = summarizeArtefact({ kind: 'roles', id: 'p', fields: [], before: { editor: ['a:read'] }, after: { editor: ['a:read', 'r:execute'] } });
    expect(s.items).toEqual([{ sign: '~', text: 'editor +r:execute' }]);
  });
  it('treats a first apply as all additions', () => {
    const s = summarizeArtefact({ kind: 'orgServiceMap', id: 'p', fields: [], before: null, after: { acme: ['p'] } });
    expect(s.line).toBe('+1');
  });
});

describe('risk and checks', () => {
  it('says why the level is what it is', () => {
    expect(riskLine({ level: 'low', flags: [] })).toMatch(/^Low/);
    expect(riskLine({ level: 'high', flags: [{ code: 'opened_to_public', level: 'high', message: '/x becomes public' }] })).toBe('High — /x becomes public');
  });
  it('counts blocking and warnings', () => {
    expect(checkCounts([{ level: 'error', code: 'a', message: '' }, { level: 'warn', code: 'b', message: '' }, { level: 'warn', code: 'c', message: '' }])).toEqual({ errors: 1, warnings: 2 });
  });
});

describe('intentChanges', () => {
  const base = buildSite('app', { name: 'p', displayName: 'P', host: 'p.dev.stairling.com', service: 's', namespace: 'n', port: 80 });
  it('names the areas a draft touches', () => {
    expect(intentChanges(base, base)).toEqual([]);
    expect(intentChanges(base, { ...base, orgs: ['x'], routes: { ...base.routes, items: [] } })).toEqual(['routes', 'access']);
    expect(intentChanges(null, base)).toEqual(['new site']);
  });
});
