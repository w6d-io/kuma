import { describe, it, expect } from 'vitest';
import { choiceKey, choiceOf, draftsFrom, expiresInWords, expiryFrom, expiryTone, grantLabel, matchesFilter, type Grant } from './grants';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('picked choices', () => {
  it('round-trip through one string, a name with separators included', () => {
    const c = { service: 'payroll', kind: 'role' as const, name: 'editor' };
    expect(choiceOf(choiceKey(c))).toEqual(c);
    expect(choiceOf('x|bogus|y')).toBeNull();
  });

  it('become drafts carrying one reason and one expiry, both optional', () => {
    const keys = [choiceKey({ service: 'jinbe', kind: 'permission', name: 'users:read' }), choiceKey({ service: 'payroll', kind: 'role', name: 'viewer' })];
    expect(draftsFrom(keys, '  ', null)).toEqual([
      { service: 'jinbe', kind: 'permission', name: 'users:read' },
      { service: 'payroll', kind: 'role', name: 'viewer' },
    ]);
    expect(draftsFrom(keys.slice(0, 1), ' OPS-1 ', '2026-10-02T00:00:00.000Z')).toEqual([
      { service: 'jinbe', kind: 'permission', name: 'users:read', reason: 'OPS-1', expiresAt: '2026-10-02T00:00:00.000Z' },
    ]);
  });

  it('read in a few words', () => {
    expect(grantLabel({ service: 'jinbe', kind: 'permission', name: 'users:read' })).toBe('users:read');
    expect(grantLabel({ service: 'payroll', kind: 'role', name: 'editor' })).toBe('role editor on payroll');
  });
});

describe('expiry', () => {
  it('turns the presets into an end', () => {
    expect(expiryFrom('never', '', NOW)).toEqual({ expiresAt: null, invalid: false });
    expect(Date.parse(expiryFrom('1d', '', NOW).expiresAt!)).toBe(NOW + DAY);
    expect(Date.parse(expiryFrom('1w', '', NOW).expiresAt!)).toBe(NOW + 7 * DAY);
    expect(new Date(expiryFrom('1m', '', NOW).expiresAt!).getUTCMonth()).toBe(10);
  });

  it('takes a custom date as the end of that day, and refuses one in the past', () => {
    const r = expiryFrom('custom', '2026-12-24', NOW);
    expect(r.invalid).toBe(false);
    expect(new Date(r.expiresAt!).getDate()).toBe(24);
    expect(expiryFrom('custom', '2026-01-01', NOW)).toEqual({ expiresAt: null, invalid: true });
    expect(expiryFrom('custom', '', NOW).invalid).toBe(true);
  });

  it('counts down in words with a tone', () => {
    expect(expiresInWords(null, NOW)).toBe('no expiry');
    expect(expiresInWords(new Date(NOW + 30 * 60_000).toISOString(), NOW)).toBe('expires in 30 min');
    expect(expiresInWords(new Date(NOW + 5 * HOUR).toISOString(), NOW)).toBe('expires in 5 h');
    expect(expiresInWords(new Date(NOW + 3 * DAY).toISOString(), NOW)).toBe('expires in 3 days');
    expect(expiresInWords(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe('expired 2 days ago');
    expect(expiryTone(null, NOW)).toBe('never');
    expect(expiryTone(new Date(NOW + HOUR).toISOString(), NOW)).toBe('soon');
    expect(expiryTone(new Date(NOW + 3 * DAY).toISOString(), NOW)).toBe('ok');
    expect(expiryTone(new Date(NOW - 1).toISOString(), NOW)).toBe('expired');
  });
});

describe('review filters', () => {
  const g = (over: Partial<Grant>): Grant => ({ id: 'g', service: 'jinbe', kind: 'permission', name: 'users:read', ...over });
  it('finds what expires within a week, what expired, what never does, and what has no reason', () => {
    expect(matchesFilter(g({ expiresAt: new Date(NOW + 3 * DAY).toISOString() }), 'expiring', NOW)).toBe(true);
    expect(matchesFilter(g({ expiresAt: new Date(NOW + 30 * DAY).toISOString() }), 'expiring', NOW)).toBe(false);
    expect(matchesFilter(g({ expiresAt: new Date(NOW - DAY).toISOString() }), 'expired', NOW)).toBe(true);
    expect(matchesFilter(g({ expiresAt: null }), 'permanent', NOW)).toBe(true);
    expect(matchesFilter(g({ reason: ' ' }), 'no-reason', NOW)).toBe(true);
    expect(matchesFilter(g({ reason: 'why' }), 'no-reason', NOW)).toBe(false);
  });
});
