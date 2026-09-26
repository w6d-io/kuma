import { describe, expect, it } from 'vitest';
import type { AuditEventV1 } from '../../api/audit';
import { segmentOf, splitTimeline, timelineWindow } from './timeline';

const U = 'u-1';
const ev = (over: Partial<AuditEventV1>): AuditEventV1 => ({
  event_id: Math.random().toString(36), ts: '2026-09-25T11:00:00Z', event: 'x.y', category: 'authz', action: 'update',
  result: 'success', actor: { type: 'user', id: 'someone' }, ...over,
});

describe('user timeline', () => {
  it('files events by who did what to whom', () => {
    expect(segmentOf(ev({ actor: { type: 'user', id: U } }), U)).toBe('did');
    expect(segmentOf(ev({ target: { type: 'user', id: U } }), U)).toBe('done');
    expect(segmentOf(ev({ category: 'auth', actor: { type: 'user', id: U } }), U)).toBe('logins');
    expect(segmentOf(ev({ category: 'auth', target: { type: 'user', id: U } }), U)).toBe('logins');
    expect(segmentOf(ev({}), U)).toBeNull();
  });
  it('counts a self-change as something they did', () => {
    expect(segmentOf(ev({ actor: { type: 'user', id: U }, target: { type: 'user', id: U } }), U)).toBe('did');
  });
  it('splits a list', () => {
    const s = splitTimeline([ev({ actor: { type: 'user', id: U } }), ev({ target: { type: 'user', id: U } }), ev({})], U);
    expect([s.did.length, s.done.length, s.logins.length]).toEqual([1, 1, 0]);
  });
  it('steps back in 30-day windows', () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    expect(timelineWindow(0, now)).toEqual({ from: '2026-08-26T00:00:00.000Z', to: '2026-09-25T00:00:00.000Z' });
    expect(timelineWindow(1, now).to).toBe('2026-08-26T00:00:00.000Z');
  });
});
