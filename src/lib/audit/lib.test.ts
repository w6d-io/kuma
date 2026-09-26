import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEventV1 } from '../../api/audit';
import { DEFAULT_VIEWS, fromServer, addLocalView, matchView, readLocalViews, writeLocalViews } from './savedViews';
import { LIVE_MAX_MS, liveExpired, mergeLive, parseTailMessage } from './live';
import { bucketMs, summaryWindow, toBars } from './histogram';
import { exportReadyMessage, isTerminal, pollDelay } from './exportJob';

const ev = (id: string, ts: string) => ({ event_id: id, ts, event: 'x.y', category: 'c', action: 'a', result: 'success', actor: { type: 'system' } }) as AuditEventV1;

afterEach(() => {
  localStorage.clear();
});

describe('saved views', () => {
  it('ships the five defaults', () => {
    expect(DEFAULT_VIEWS.map((v) => v.name)).toEqual(['High-risk changes', 'Denied access', 'Logins failed', 'API keys', 'Grants this week']);
  });
  it('adds, replaces by name and persists local views', () => {
    let views = addLocalView([], ' Mine ', { result: 'denied' }, 1);
    views = addLocalView(views, 'Mine', { result: 'failure' }, 2);
    expect(views).toEqual([{ id: 'local:2', name: 'Mine', params: { result: 'failure' }, origin: 'local' }]);
    writeLocalViews([...DEFAULT_VIEWS, ...views]);
    expect(readLocalViews()).toEqual(views);
    expect(addLocalView(views, '  ', {})).toBe(views);
  });
  it('survives garbage in storage', () => {
    localStorage.setItem('kuma.audit.views', '{nope');
    expect(readLocalViews()).toEqual([]);
  });
  it('reads a server query, and marks another owner\'s view', () => {
    expect(fromServer({ id: 's1', name: 'Mine', filters: { event: ['org.*'], result: 'denied' }, shared: true, mine: false }))
      .toEqual({ id: 's1', name: 'Mine', params: { event: 'org.*', result: 'denied' }, origin: 'server', shared: true, mine: false });
  });
  it('matches the current params to a view, ignoring the range', () => {
    expect(matchView(DEFAULT_VIEWS, { result: 'denied', range: '24h' })?.name).toBe('Denied access');
    expect(matchView(DEFAULT_VIEWS, { result: 'denied', site: 'kuma' })).toBeUndefined();
  });
});

describe('live tail', () => {
  it('merges newest first without duplicates, capped', () => {
    const a = [ev('1', '2026-09-25T10:00:00Z')];
    const merged = mergeLive(a, [ev('2', '2026-09-25T11:00:00Z'), ev('1', '2026-09-25T10:00:00Z'), ev('2', '2026-09-25T11:00:00Z')]);
    expect(merged.map((e) => e.event_id)).toEqual(['2', '1']);
    expect(mergeLive(a, [])).toBe(a);
    expect(mergeLive([], [ev('1', '2026-09-25T10:00:00Z'), ev('2', '2026-09-25T11:00:00Z')], 1).map((e) => e.event_id)).toEqual(['2']);
  });
  it('parses single, batched and bad SSE payloads', () => {
    expect(parseTailMessage(JSON.stringify(ev('1', 't')))).toHaveLength(1);
    expect(parseTailMessage(JSON.stringify({ events: [ev('1', 't'), { nope: 1 }] }))).toHaveLength(1);
    expect(parseTailMessage('ping')).toEqual([]);
  });
  it('stops after 15 minutes', () => {
    expect(liveExpired(0, LIVE_MAX_MS - 1)).toBe(false);
    expect(liveExpired(0, LIVE_MAX_MS)).toBe(true);
  });
});

describe('histogram', () => {
  it('scales to the tallest bucket and keeps small buckets visible', () => {
    const bars = toBars([{ t: 'a', total: 100, failed: 10 }, { t: 'b', total: 1 }, { t: 'c', total: 0 }], 40);
    expect(bars.map((b) => [b.h, b.hf])).toEqual([[40, 4], [1, 0], [0, 0]]);
  });
  it('derives the bucket width and the summary window', () => {
    expect(bucketMs([{ t: '2026-09-25T10:00:00Z' }, { t: '2026-09-25T10:15:00Z' }])).toBe(900_000);
    expect(bucketMs([])).toBe(3_600_000);
    expect(summaryWindow('7d')).toBe('7d');
    expect(summaryWindow('custom')).toBeNull();
  });
});

describe('export job', () => {
  it('backs off to 5 s and knows when it is done', () => {
    expect([0, 1, 2, 3, 9].map(pollDelay)).toEqual([1000, 2000, 4000, 5000, 5000]);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('failed')).toBe(true);
  });
  it('words the ready toast', () => {
    expect(exportReadyMessage({ id: '1', status: 'done', rows: 12480, sha256: 'abcdef0123456789' })).toBe('Export ready — 12 480 rows · sha256 abcdef012345…');
  });
});
