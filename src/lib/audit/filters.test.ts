import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS, activeCount, clearFilters, filtersFromParams, filtersToParams, rangeProblem, resolveRange,
  toQuery, toggleFacet, zoomTo, toServerFilters, fromServerFilters, type AuditFilters,
} from './filters';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const f = (over: Partial<AuditFilters> = {}): AuditFilters => ({ ...EMPTY_FILTERS, ...over });

describe('resolveRange', () => {
  it('resolves presets relative to now', () => {
    expect(resolveRange(f({ range: '24h' }), NOW)).toEqual({ from: '2026-09-24T12:00:00.000Z', to: '2026-09-25T12:00:00.000Z' });
    expect(resolveRange(f({ range: '30d' }), NOW).from).toBe('2026-08-26T12:00:00.000Z');
  });
  it('keeps a custom range as given', () => {
    expect(resolveRange(f({ range: 'custom', from: 'a', to: 'b' }), NOW)).toEqual({ from: 'a', to: 'b' });
  });
  it('falls back to 7 days for a custom range without bounds', () => {
    expect(resolveRange(f({ range: 'custom' }), NOW).from).toBe('2026-09-18T12:00:00.000Z');
  });
});

describe('rangeProblem', () => {
  it('accepts up to 30 days', () => {
    expect(rangeProblem('2026-08-26T12:00:00Z', '2026-09-25T12:00:00Z')).toBeNull();
  });
  it('refuses more than 30 days with the §5.2 copy', () => {
    expect(rangeProblem('2026-08-01T00:00:00Z', '2026-09-25T00:00:00Z')).toMatch(/30 days or fewer/);
  });
  it('refuses an inverted or unreadable range', () => {
    expect(rangeProblem('2026-09-25T00:00:00Z', '2026-09-24T00:00:00Z')).toMatch(/after the start/);
    expect(rangeProblem('nope', '2026-09-24T00:00:00Z')).toMatch(/start and an end/);
  });
});

describe('toQuery', () => {
  it('sends only the facets that are set, and trims free text to 64 chars', () => {
    const q = toQuery(f({ result: ['denied'], q: `  ${'x'.repeat(80)} ` }), null, NOW);
    expect(q).toEqual({ from: '2026-09-18T12:00:00.000Z', to: '2026-09-25T12:00:00.000Z', result: 'denied', q: 'x'.repeat(64) });
  });
  it('drops org for an org admin (jinbe forces their scope)', () => {
    expect(toQuery(f({ org: 'acme' }), { platform: false, orgs: ['acme'] }, NOW).org).toBeUndefined();
    expect(toQuery(f({ org: 'acme' }), { platform: true, orgs: [] }, NOW).org).toBe('acme');
  });
});

describe('facets', () => {
  it('toggles a value on and off', () => {
    const on = toggleFacet(f(), 'result', 'denied');
    expect(on.result).toEqual(['denied']);
    expect(toggleFacet(on, 'result', 'denied').result).toEqual([]);
  });
  it('keeps category and result to one value (jinbe takes one), events to ten', () => {
    expect(toggleFacet(f({ result: ['denied'] }), 'result', 'failure').result).toEqual(['failure']);
    expect(toggleFacet(f({ event: ['a.b'] }), 'event', 'c.d').event).toEqual(['a.b', 'c.d']);
    const many = Array.from({ length: 10 }, (_, i) => `e.k${i}`);
    expect(toggleFacet(f({ event: many }), 'event', 'e.new').event).toHaveLength(10);
  });
  it('counts narrowing filters but not the range', () => {
    expect(activeCount(f({ range: '30d' }))).toBe(0);
    expect(activeCount(f({ event: ['a.b', 'c.d'], actor: 'u1', q: ' ' }))).toBe(3);
  });
  it('clears filters but keeps the range', () => {
    expect(clearFilters(f({ range: '24h', result: ['denied'] }))).toEqual(f({ range: '24h' }));
  });
  it('zooms to one bucket', () => {
    expect(zoomTo(f(), '2026-09-25T10:00:00Z', 3_600_000)).toMatchObject({ range: 'custom', from: '2026-09-25T10:00:00.000Z', to: '2026-09-25T11:00:00.000Z' });
    expect(zoomTo(f(), 'bad', 1)).toEqual(f());
  });
});

describe('server saved-query filters', () => {
  it('sends typed facets without the range, and reads them back', () => {
    const params = { range: '24h', event: 'org.grants.*,auth.login.failed', result: 'denied', site: 'kuma' };
    const server = toServerFilters(params);
    expect(server).toEqual({ event: ['org.grants.*', 'auth.login.failed'], result: 'denied', site: 'kuma' });
    expect(fromServerFilters(server as Record<string, unknown>)).toEqual({ event: 'org.grants.*,auth.login.failed', result: 'denied', site: 'kuma' });
    expect(fromServerFilters(null)).toEqual({});
  });
});

describe('address round-trip', () => {
  it('round-trips a full filter set', () => {
    const full = f({
      range: 'custom', from: '2026-09-20T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z',
      org: 'acme', actor: '3f2a9c10-aaaa', site: 'kuma', event: ['org.grants.*'], category: ['authz'],
      result: ['denied'], severity: 'high', trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', q: 'grant',
    });
    expect(filtersFromParams(filtersToParams(full))).toEqual(full);
  });
  it('leaves defaults out of the address', () => {
    expect(filtersToParams(f())).toEqual({});
  });
  it('drops anything malformed rather than sending it', () => {
    const got = filtersFromParams({
      range: 'forever', event: 'org.grants.*,"} |= "x,Bad Key', result: 'denied,maybe',
      actor: 'a b c', severity: 'extreme', trace_id: 'xyz',
    });
    expect(got).toEqual(f({ event: ['org.grants.*'], result: ['denied'] }));
  });
  it('rejects a custom range over 30 days', () => {
    expect(filtersFromParams({ range: 'custom', from: '2026-01-01', to: '2026-09-01' }).range).toBe('7d');
  });
});
