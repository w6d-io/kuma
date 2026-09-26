import { describe, expect, it } from 'vitest';
import type { AuditEventV1 } from '../../api/audit';
import {
  actorLabel, eventHash, eventPhrase, eventSummary, groupByDay, parseEventHash, resultTone, routeOf, shortId,
  traceLink, whyDeniedHash,
} from './format';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const ev = (over: Partial<AuditEventV1> = {}): AuditEventV1 => ({
  event_id: '0192-a', ts: '2026-09-25T11:00:00Z', event: 'access.denied', category: 'access', action: 'deny',
  result: 'denied', actor: { type: 'user', id: '3f2a9c10-1111-2222-3333-444455556666' }, ...over,
});

describe('actorLabel', () => {
  const actor = { type: 'user', id: '3f2a9c10-1111-2222-3333-444455556666' };
  it('is pseudonymous until the id is looked up', () => {
    expect(actorLabel(actor)).toEqual({ kind: 'user', primary: 'user · 3f2a9c10' });
  });
  it('shows the name and email once revealed', () => {
    expect(actorLabel(actor, { name: 'Alice', email: 'a@x.io' })).toEqual({ kind: 'user', primary: 'Alice', secondary: 'a@x.io' });
    expect(actorLabel(actor, { email: 'a@x.io' })).toEqual({ kind: 'user', primary: 'a@x.io', secondary: undefined });
  });
  it('reads a lookup that found nobody as a deleted user', () => {
    expect(actorLabel(actor, 'missing').primary).toBe('deleted user · 3f2a9c10');
  });
  it('names system and anonymous actors', () => {
    expect(actorLabel({ type: 'system' }).kind).toBe('system');
    expect(actorLabel({ type: 'user', id: null }).kind).toBe('anonymous');
  });
  it('shortens ids', () => {
    expect(shortId(null)).toBe('—');
  });
});

describe('event text', () => {
  it('phrases catalog keys', () => {
    expect(eventPhrase('org.grants.changed')).toBe('changed grants');
    expect(eventPhrase('rbac.group.created')).toBe('group created');
    expect(eventPhrase('config.auth_methods.changed')).toBe('auth methods changed');
  });
  it('summarises by changes, then route, then target', () => {
    expect(eventSummary(ev({ changes: { summary: 'kuma:editor added' } }))).toBe('kuma:editor added');
    expect(eventSummary(ev({ target: { type: 'route', id: 'PUT /organizations/x/grants' } }))).toBe('PUT /organizations/x/grants');
    expect(eventSummary(ev({ target: { type: 'user', id: '3f2a9c10-9999' } }))).toBe('user · 3f2a9c10');
    expect(eventSummary(ev({ target: { type: 'group', id: 'devs' } }))).toBe('group · devs');
  });
  it('tones results', () => {
    expect(resultTone('success')).toBe('success');
    expect(resultTone('denied')).toBe('danger');
  });
  it('parses a route only when the target is one', () => {
    expect(routeOf(ev({ target: { type: 'route', id: 'GET /api/x' } }))).toEqual({ method: 'GET', path: '/api/x' });
    expect(routeOf(ev({ target: { type: 'user', id: 'x' } }))).toBeNull();
  });
});

describe('groupByDay', () => {
  it('files events under Today, Yesterday and a date', () => {
    const groups = groupByDay([
      ev({ ts: '2026-09-25T11:00:00Z' }), ev({ ts: '2026-09-25T10:00:00Z' }),
      ev({ ts: '2026-09-24T11:00:00Z' }), ev({ ts: '2026-09-20T11:00:00Z' }),
    ], NOW);
    expect(groups.map((g) => [g.label, g.events.length])).toEqual([
      ['Today', 2], ['Yesterday', 1], [expect.stringContaining('20'), 1],
    ]);
  });
});

describe('traceLink', () => {
  const tid = '4bf92f3577b34da6a3ce929d0e0e4736';
  it('links to Explore with the trace id only', () => {
    const l = traceLink({ trace_id: tid, ts: '2026-09-25T11:00:00Z' }, 'https://grafana.x/', NOW);
    expect(l.kind).toBe('link');
    const url = (l as { url: string }).url;
    expect(url.startsWith('https://grafana.x/explore?')).toBe(true);
    expect(decodeURIComponent(url)).toContain(tid);
    expect(url).not.toMatch(/%40|@|var-actor|sessionId/);
  });
  it('says expired after 7 days', () => {
    expect(traceLink({ trace_id: tid, ts: '2026-09-17T11:00:00Z' }, 'https://g', NOW)).toEqual({ kind: 'expired' });
  });
  it('offers nothing without a trace id or a Grafana base', () => {
    expect(traceLink({ trace_id: null, ts: '2026-09-25T11:00:00Z' }, 'https://g', NOW).kind).toBe('none');
    expect(traceLink({ trace_id: tid, ts: '2026-09-25T11:00:00Z' }, '${GRAFANA_URL}', NOW).kind).toBe('none');
    expect(traceLink({ trace_id: 'not-hex', ts: '2026-09-25T11:00:00Z' }, 'https://g', NOW).kind).toBe('none');
  });
});

describe('links', () => {
  it('prefills the access checker from a denied route', () => {
    const e = ev({ target: { type: 'route', id: 'PUT /api/orgs/1' }, site: 'kuma' });
    expect(whyDeniedHash(e, 'a@x.io')).toBe('#/access-check?email=a%40x.io&method=PUT&path=%2Fapi%2Forgs%2F1&app=kuma');
    expect(whyDeniedHash(ev({ target: { type: 'user', id: 'u' } }), 'a@x.io')).toBeNull();
  });
  it('round-trips an event address, encoded or not', () => {
    const h = eventHash({ event_id: '0192-a', ts: '2026-09-25T11:00:00Z' });
    expect(parseEventHash(h)).toEqual({ id: '0192-a', ts: '2026-09-25T11:00:00Z' });
    expect(parseEventHash('#/audit/event%2F0192-a')).toEqual({ id: '0192-a', ts: undefined });
    expect(parseEventHash('#/audit?range=7d')).toBeNull();
  });
});
