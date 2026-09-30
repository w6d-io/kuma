import { afterEach, describe, expect, it } from 'vitest';
import { askedByMe, deletionTrail, expiryState, rememberLifetime, rememberedLifetime, remaining, ttlChoices, ttlWords } from './lifecycle';
import type { DeletionRequest, EphemeralView } from './types';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const eph = (over: Partial<EphemeralView> = {}): EphemeralView => ({
  ttlSec: 86_400, expiresAt: new Date(NOW + 3 * 3_600_000 + 20 * 60_000).toISOString(), remainingSec: 0, expired: false, setBy: 'a@x', ...over,
});
const req = (over: Partial<DeletionRequest> = {}): DeletionRequest => ({
  id: 'r1', site: 'demo', requestedBy: 'ann@x', requestedAt: '2026-09-30T10:00:00Z', state: 'pending', ...over,
});

afterEach(() => sessionStorage.clear());

describe('ephemeral sites', () => {
  it('words a TTL and offers only what the platform allows, its default included', () => {
    expect([3600, 7200, 43_200, 86_400, 259_200].map(ttlWords)).toEqual(['1 hour', '2 hours', '12 hours', '1 day', '3 days']);
    expect(ttlChoices()).toEqual([3600, 14_400, 43_200, 86_400, 259_200, 604_800]);
    expect(ttlChoices({ minSec: 7200, maxSec: 86_400, defaultSec: 7200 })).toEqual([7200, 14_400, 43_200, 86_400]);
  });

  it('counts down from expiresAt, soon under an hour, expired when paused or past', () => {
    expect(expiryState(eph(), NOW)).toMatchObject({ tone: 'ok', label: '3 h 20 min left' });
    expect(expiryState(eph({ expiresAt: new Date(NOW + 30 * 60_000).toISOString() }), NOW)).toMatchObject({ tone: 'soon', label: '30 min left' });
    expect(expiryState(eph({ expiresAt: new Date(NOW - 1000).toISOString() }), NOW).tone).toBe('expired');
    const expired = expiryState(eph({ expired: true }), NOW);
    expect(expired).toMatchObject({ tone: 'expired', label: 'Expired' });
    expect(expired.detail).toMatch(/Paused.*Extend it, then resume/);
    expect(remaining(2 * 86_400_000 + 4 * 3_600_000)).toBe('2 days 4 h');
    expect(remaining(86_400_000)).toBe('1 day');
  });

  it('keeps the lifetime chosen in the wizard until the first save', () => {
    rememberLifetime('demo', 43_200);
    expect(rememberedLifetime('demo')).toBe(43_200);
    rememberLifetime('demo', null);
    expect(rememberedLifetime('demo')).toBeNull();
    expect(rememberedLifetime('other')).toBeNull();
  });
});

describe('deletion requests', () => {
  it('trails a request from the ask to its decision', () => {
    expect(deletionTrail(req({ reason: 'demo over', requestedVia: 'key1' })).map((t) => [t.label, t.state])).toEqual([
      ['Asked by ann@x through a key', 'done'],
      ['Waiting for someone else holding sites:delete', 'pending'],
    ]);
    const rejected = deletionTrail(req({ state: 'rejected', decidedBy: 'bob@x', decidedAt: '2026-09-30T11:00:00Z', decisionReason: 'still used' }));
    expect(rejected[1]).toMatchObject({ label: 'Rejected by bob@x', state: 'failed', detail: '“still used”' });
    expect(deletionTrail(req({ state: 'approved', decidedBy: 'bob@x' }))[1]).toMatchObject({ label: 'Approved and deleted by bob@x', state: 'done' });
  });

  it('knows the requester: jinbe’s word first, the address otherwise', () => {
    expect(askedByMe(req({ requestedByYou: true }), { email: 'someone@else' })).toBe(true);
    expect(askedByMe(req({ requestedByYou: false }), { email: 'ann@x' })).toBe(false);
    expect(askedByMe(req(), { email: 'ann@x' })).toBe(true);
    expect(askedByMe(req(), { email: null })).toBe(false);
  });
});
