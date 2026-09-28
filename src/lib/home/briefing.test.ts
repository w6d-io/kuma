import { describe, expect, it } from 'vitest';
import { ageOf, deltaOf, healthRows, personaOf, summaryClauses, visibleActions, wafSummary } from './briefing';
import type { HealthComponent } from '../../api/home';
import { homeHref, homeSelfHref } from './href';
import { parseHash } from '../route';
import { parseSitesHash } from '../sites/route';
import { parseEventHash } from '../audit/format';
import { allUnavailableHome, health, mixedHome, noRightsHome, orgAdminHome, platformHome, supportHome } from './fixtures';
import { withForbidden } from '../../api/home';
import { onTheWire } from './fixtures';

const NOW = Date.parse('2026-09-26T14:00:00Z');

describe('homeHref', () => {
  it('turns every server page name into an address the router opens on that page', () => {
    const cases: Array<[Parameters<typeof homeHref>[0], string]> = [
      [{ page: 'access-review', params: { filter: 'no-mfa' } }, 'accessreview'],
      [{ page: 'recertification', params: { view: 'inbox' } }, 'recertification'],
      [{ page: 'users', params: { filter: 'unassigned' } }, 'users'],
      [{ page: 'api-keys', params: { org: 'acme' } }, 'apikeys'],
      [{ page: 'gateway', anchor: 'engines' }, 'gateway'],
      [{ page: 'audit', params: { event: 'auth.login.failed', window: '24h' } }, 'audit'],
      [{ page: 'sites', params: { view: 'requests', id: 'r1' } }, 'sites'],
    ];
    for (const [target, page] of cases) expect(parseHash(homeHref(target)).page).toBe(page);
  });

  it('keeps the filter a target carries', () => {
    expect(parseHash(homeHref({ page: 'access-review', params: { filter: 'no-mfa' } })).query).toEqual({ filter: 'no-mfa' });
    expect(parseHash(homeHref({ page: 'audit', params: { event: 'auth.login.failed', window: '7d' } })).query).toEqual({ event: 'auth.login.failed', range: '7d' });
  });

  it('opens a site on the right tab, and the requests list', () => {
    expect(parseSitesHash(homeHref({ page: 'sites', params: { name: 'expenses', tab: 'drift' } }))).toMatchObject({ view: 'site', name: 'expenses', tab: 'status' });
    expect(parseSitesHash(homeHref({ page: 'sites', params: { name: 'fleet', tab: 'draft' } }))).toMatchObject({ view: 'site', tab: 'review' });
    expect(parseSitesHash(homeHref({ page: 'sites', params: { view: 'requests', id: 'r1' } }))).toMatchObject({ view: 'list', query: { view: 'requests', id: 'r1' } });
    expect(parseSitesHash(homeHref({ page: 'sites', params: { view: 'migration' } }))).toMatchObject({ view: 'migrate' });
  });

  it('links a change to its audit event', () => {
    expect(parseEventHash(homeHref({ page: 'audit', params: { eventId: 'e1', ts: '2026-09-26T13:40:00Z' } }))).toEqual({ id: 'e1', ts: '2026-09-26T13:40:00Z' });
  });

  it('lands an unknown page on Home, never a broken hash', () => {
    expect(homeHref({ page: 'nowhere' })).toBe('#/dashboard');
  });

  it("writes Home's own address with the defaults left out", () => {
    expect(homeSelfHref('24h', null)).toBe('#/dashboard');
    expect(homeSelfHref('7d', 'acme')).toBe('#/dashboard?window=7d&org=acme');
  });
});

describe('personaOf', () => {
  it('reads the persona from the scope and the modules left', () => {
    expect(personaOf(platformHome(NOW))).toBe('platform');
    expect(personaOf(orgAdminHome(NOW))).toBe('org_admin');
    expect(personaOf(supportHome(NOW))).toBe('support');
    expect(personaOf(noRightsHome(NOW))).toBe('none');
  });
});

describe('the response on the wire', () => {
  it('reads an omitted module as forbidden', () => {
    const full = withForbidden(onTheWire(supportHome(NOW)));
    expect(full.modules.health.status).toBe('forbidden');
    expect(full.modules.people.status).toBe('ok');
  });
});

describe('healthRows', () => {
  it('lists the strip in request order and merges the audit log, worst state winning', () => {
    const rows = healthRows(health(NOW).components);
    expect(rows.map((r) => r.label)).toEqual(['Gateway', 'Gateway rules', 'Policy engine', 'Policy sync', 'Sign-in', 'Console API', 'Data store', 'Audit log', 'Certificates']);
    expect(rows.find((r) => r.key === 'audit')).toMatchObject({ state: 'degraded', summary: 'archive 3 min behind' });
  });
  it('does not let an archive that is not deployed here win the audit row: it is noted, the store is the state', () => {
    const comps = health(NOW).components.map((c) => (c.id === 'audit_archive' ? { ...c, state: 'not_deployed' as const, summary: 'no archiver configured' } : c));
    const audit = healthRows(comps).find((r) => r.key === 'audit')!;
    expect(audit).toMatchObject({ state: 'ok', summary: 'reachable', notes: ['Archive: no archiver configured'] });
  });

  it('keeps the policy engine ok when OPAL manages it', () => {
    const comps = health(NOW).components.map((c) => (c.id === 'opa' ? { ...c, summary: 'reachable (OPAL-managed)' } : c));
    expect(healthRows(comps).find((r) => r.key === 'opa')).toMatchObject({ state: 'ok', summary: 'reachable (OPAL-managed)' });
  });
});

describe('wafSummary', () => {
  const waf = (metrics?: Record<string, number>, summary = '1/5 sites behind the WAF'): HealthComponent => ({ id: 'waf', state: 'degraded', summary, ...(metrics ? { metrics } : {}) });
  it('counts the sites not behind the WAF, and their hosts when fewer', () => {
    expect(wafSummary(waf({ total: 7, waf: 3, unknown: 0, unprotected: 4, unprotectedHosts: 3 }))).toBe('4 sites (3 hosts) not behind the WAF');
    expect(wafSummary(waf({ total: 2, waf: 1, unknown: 0, unprotected: 1, unprotectedHosts: 1 }))).toBe('1 site not behind the WAF');
  });
  it('says all are behind, none are live, or how many are unknown', () => {
    expect(wafSummary(waf({ total: 3, waf: 3, unknown: 0, unprotected: 0, unprotectedHosts: 0 }))).toBe('all 3 sites behind the WAF');
    expect(wafSummary(waf({ total: 0, waf: 0, unknown: 0, unprotected: 0, unprotectedHosts: 0 }))).toBe('no live sites');
    expect(wafSummary(waf({ total: 4, waf: 2, unknown: 1, unprotected: 1, unprotectedHosts: 1 }))).toBe('1 site not behind the WAF · 1 site unknown');
  });
  it('keeps the server’s words from an older jinbe without counts', () => {
    expect(wafSummary(waf(undefined))).toBe('1/5 sites behind the WAF');
  });
});

describe('summaryClauses', () => {
  it('says what needs you, platform health and sign-ins, in that order', () => {
    const res = platformHome(NOW);
    expect(summaryClauses(res, 'platform').map((c) => c.text)).toEqual(['6 things need you', '1 system degraded', '384 sign-ins in the last 24 h']);
  });

  it('puts a component that is down above everything else', () => {
    const c = summaryClauses(mixedHome(NOW), 'platform');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ tone: 'danger', text: "Policy sync is down — access changes aren't reaching the gateway." });
  });

  it('never says "Nothing needs you" when a source could not be checked', () => {
    const res = mixedHome(NOW);
    res.modules.health.data!.components = health(NOW).components;
    expect(summaryClauses(res, 'platform')[0].text).toBe('Nothing needs you in what we could check');
  });

  it('leaves out what it could not load rather than guessing', () => {
    expect(summaryClauses(allUnavailableHome(NOW), 'platform')).toEqual([]);
  });

  it('speaks to support and org admins about their own work', () => {
    expect(summaryClauses(supportHome(NOW), 'support').map((c) => c.text)).toEqual(['312 active sessions', '6 recertifications waiting on you']);
    expect(summaryClauses(orgAdminHome(NOW, 'acme'), 'org_admin', 'Acme').map((c) => c.text)).toEqual(['Acme', '23 members', '1 thing needs you']);
  });
});

describe('visibleActions', () => {
  it('keeps enabled and step-up actions, drops refused ones, in priority order, six at most', () => {
    const items = platformHome(NOW).modules.actions.data!.items;
    expect(visibleActions(items).map((a) => a.id)).toEqual(['review_requests', 'new_site', 'invite_user', 'grant_access', 'check_access', 'find_user']);
    expect(visibleActions([{ id: 'open_gateway', enabled: false, reason: 'mfa_required' }, { id: 'new_site', enabled: false, reason: 'no_permission' }]).map((a) => a.id)).toEqual(['open_gateway']);
    expect(visibleActions([{ id: 'review_requests', enabled: true, count: 0 }])).toEqual([]);
  });
});

describe('numbers', () => {
  it('states a change against the previous window, in words for a reader', () => {
    expect(deltaOf(342, 372, '24h')).toEqual({ text: '−8% vs previous 24 h', aria: 'down 8 percent from the previous 24 h' });
    expect(deltaOf(10, 0, '24h')).toBeNull();
  });

  it('says how long ago, short', () => {
    expect(ageOf(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe('12 min');
    expect(ageOf(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2 d');
    expect(ageOf(null, NOW)).toBe('—');
  });
});
