import { describe, it, expect } from 'vitest';
import { parseSitesHash, sitesHref } from './route';

describe('parseSitesHash', () => {
  it('reads the list, with a filter', () => {
    expect(parseSitesHash('#/sites')).toEqual({ view: 'list', query: {} });
    expect(parseSitesHash('#/sites?filter=paused')).toEqual({ view: 'list', query: { filter: 'paused' } });
  });
  it('reads the wizard step, defaulting to address', () => {
    expect(parseSitesHash('#/sites/new')).toMatchObject({ view: 'new', step: 'address' });
    expect(parseSitesHash('#/sites/new?step=review')).toMatchObject({ view: 'new', step: 'review' });
    expect(parseSitesHash('#/sites/new?step=bogus')).toMatchObject({ view: 'new', step: 'address' });
  });
  it('reads the migration under both names', () => {
    expect(parseSitesHash('#/sites/migrate?step=parity')).toMatchObject({ view: 'migrate', step: 'parity' });
    expect(parseSitesHash('#/sites/migration')).toMatchObject({ view: 'migrate', step: null });
  });
  it('reads a site, its tab and its query', () => {
    expect(parseSitesHash('#/sites/payroll')).toEqual({ view: 'site', name: 'payroll', tab: 'overview', query: {} });
    expect(parseSitesHash('#/sites/payroll/routes?route=r12&test=GET%20/api/x')).toEqual({
      view: 'site', name: 'payroll', tab: 'routes', query: { route: 'r12', test: 'GET /api/x' },
    });
    expect(parseSitesHash('#/sites/payroll/nope')).toMatchObject({ tab: 'overview' });
  });
  it('survives a malformed escape', () => {
    expect(parseSitesHash('#/sites/%E0%A4%A')).toMatchObject({ view: 'list' });
  });
});

describe('sitesHref', () => {
  it('writes the short forms and round-trips', () => {
    expect(sitesHref({ view: 'list' })).toBe('#/sites');
    expect(sitesHref({ view: 'new' })).toBe('#/sites/new');
    expect(sitesHref({ view: 'new', step: 'kind' })).toBe('#/sites/new?step=kind');
    expect(sitesHref({ view: 'site', name: 'payroll' })).toBe('#/sites/payroll');
    const href = sitesHref({ view: 'site', name: 'payroll', tab: 'gates', query: { gate: 'browser', level: undefined } });
    expect(href).toBe('#/sites/payroll/gates?gate=browser');
    expect(parseSitesHash(href)).toMatchObject({ name: 'payroll', tab: 'gates', query: { gate: 'browser' } });
  });
});
