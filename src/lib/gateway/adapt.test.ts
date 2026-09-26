import { describe, it, expect } from 'vitest';
import { stateFromWire, specFor, previewFromWire, rolloutFromWire, secretFromWire, secretToWire, type WireState } from './adapt';

const WIRE: WireState = {
  managed: true, etag: 'rv:12', errorFallback: ['redirect', 'json'],
  handlers: [
    { kind: 'authenticator', name: 'cookie_session', enabled: true, config: { check_session_url: 'http://k/whoami' }, inUse: ['rule/kuma-api', 'payroll'],
      fields: [{ key: 'check_session_url', label: 'Session check', type: 'url', required: true }] },
    { kind: 'mutator', name: 'hydrator', enabled: true, config: { api: { url: 'http://e', auth: { basic: { password: '***' } } } }, inUse: [],
      fields: [{ key: 'api.url', label: 'URL', type: 'url', required: true }, { key: 'api.auth.basic.password', label: 'Password', type: 'string', secret: true }] },
    { kind: 'authenticator', name: 'jwt', enabled: false, config: {}, locked: 'needs a key set', defaults: { jwks_urls: ['http://h/jwks'] } },
  ],
  status: { generation: 12, observedGeneration: 12, lastRollout: { phase: 'Complete', reason: 'Ready', message: 'live on 2/2 pods' } },
};

describe('stateFromWire', () => {
  const s = stateFromWire(WIRE);
  it('groups by plural kind and reads platform use apart from sites', () => {
    const cs = s.adapted.authenticators.find((h) => h.name === 'cookie_session')!;
    expect(cs.usedBy).toEqual([{ site: 'payroll', gates: [] }]);
    expect(cs.platform).toBe(true);
    expect(cs.platformRules).toEqual(['kuma-api']);
    expect(cs.info.fields[0]).toMatchObject({ key: 'check_session_url', required: true, level: 'B', type: 'url' });
  });
  it('turns masked secrets into objects and keeps locked/defaults', () => {
    const h = s.adapted.mutators[0];
    expect(h.config).toEqual({ api: { url: 'http://e', auth: { basic: { password: { masked: true } } } } });
    expect(h.info.fields.find((f) => f.key === 'api.auth.basic.password')?.type).toBe('secret');
    expect(s.adapted.authenticators.find((h) => h.name === 'jwt')).toMatchObject({ locked: 'needs a key set', defaults: { jwks_urls: ['http://h/jwks'] } });
    expect(s.rollout?.state).toBe('succeeded');
  });
});

describe('secrets on the wire', () => {
  it('round-trips masked values only (secrets are set by the platform)', () => {
    expect(secretFromWire('***')).toEqual({ masked: true });
    expect(secretToWire({ masked: true })).toBe('***');
    expect(secretFromWire('plain')).toBe('plain');
  });
});

describe('specFor', () => {
  const s = stateFromWire(WIRE);
  it('sends every enabled handler, masked secrets back as "***", and the fallback', () => {
    const body = specFor(s, [{ kind: 'mutators', name: 'hydrator', enabled: true, config: { api: { url: 'http://f', auth: { basic: { password: { masked: true } } } } } }]);
    expect(body.spec.errorFallback).toEqual(['redirect', 'json']);
    expect(body.spec.authenticators.cookie_session).toEqual({ enabled: true, config: { check_session_url: 'http://k/whoami' } });
    expect(body.spec.mutators.hydrator.config).toEqual({ api: { url: 'http://f', auth: { basic: { password: '***' } } } });
    expect(body.spec.authenticators.jwt).toBeUndefined();
  });
  it('leaves a disabled handler out and adds an enabled one', () => {
    const body = specFor(s, [{ kind: 'mutators', name: 'hydrator', enabled: false }, { kind: 'authenticators', name: 'jwt', enabled: true, config: { jwks_urls: ['x'] } }]);
    expect(body.spec.mutators.hydrator).toBeUndefined();
    expect(body.spec.authenticators.jwt).toEqual({ enabled: true, config: { jwks_urls: ['x'] } });
    expect(specFor(s, []).spec.mutators.hydrator.config).toMatchObject({ api: { auth: { basic: { password: '***' } } } });
  });
});

describe('previewFromWire', () => {
  it('splits risk (warnings), blocking uses, checks and the restart', () => {
    const p = previewFromWire({ ok: false, managed: true, etag: 'rv:12', changes: [{ kind: 'authorizer', handler: 'allow', change: 'enabled' }], issues: [
      { severity: 'warn', code: 'risk_allow_all', message: 'allow lets everyone in' },
      { severity: 'error', code: 'handler_in_use', message: 'used by payroll', kind: 'authenticator', handler: 'jwt' },
      { severity: 'error', code: 'field_required', message: 'remote is required' },
      { severity: 'info', code: 'rolling_restart', message: 'oathkeeper restarts' },
    ] });
    expect(p.risk.level).toBe('high');
    expect(p.blocked).toEqual([{ kind: 'authenticators', name: 'jwt', sites: [], message: 'used by payroll' }]);
    expect(p.checks).toEqual([{ level: 'error', code: 'field_required', message: 'remote is required' }]);
    expect(p.restart).toMatchObject({ components: ['oathkeeper'], message: 'oathkeeper restarts' });
    expect(p.changes[0]).toMatchObject({ kind: 'authorizers', name: 'allow', fields: [{ path: 'enabled', before: false, after: true }] });
  });
});

describe('rolloutFromWire', () => {
  it('turns the operator phase into stages', () => {
    const r = rolloutFromWire({ managed: true, settled: false, generation: 13, observedGeneration: 13, rollout: { phase: 'Progressing', reason: 'RollingOut', message: '1/2 pods updated' } })!;
    expect(r.state).toBe('running');
    expect(r.stages.map((s) => s.state)).toEqual(['done', 'done', 'running', 'pending']);
    expect(r.stages[2].detail).toBe('1/2 pods updated');
    const p = rolloutFromWire({ managed: true, settled: false, generation: 13, observedGeneration: 13, rollout: { phase: 'Progressing', pods: { updated: 2, ready: 1, total: 3 } } })!;
    expect(p.stages[2].detail).toBe('2/3 pods updated');
    expect(p.stages[3].detail).toBe('1/3 pods ready');
  });
  it('marks what is live on every pod', () => {
    const s = stateFromWire({ ...WIRE, status: { ...WIRE.status, liveEnabled: { authenticators: ['cookie_session'], mutators: [] } } });
    expect(s.adapted.authenticators.find((h) => h.name === 'cookie_session')?.live).toBe(true);
    expect(s.adapted.mutators[0].live).toBe(false);
    expect(stateFromWire(WIRE).adapted.mutators[0].live).toBeUndefined();
  });
  it('is pending until the operator catches up, and says why it failed or rolled back', () => {
    expect(rolloutFromWire({ managed: true, settled: false, generation: 14, observedGeneration: 13, rollout: { phase: 'Complete' } })!.stages[0].state).toBe('running');
    const f = rolloutFromWire({ managed: true, settled: true, generation: 13, observedGeneration: 13, rollout: { phase: 'Failed', reason: 'HandlerInUse', message: 'jwt used by shop' } })!;
    expect(f.state).toBe('failed');
    expect(f.stages[1]).toMatchObject({ state: 'failed', detail: 'A handler is still in use: jwt used by shop' });
    const rb = rolloutFromWire({ managed: true, settled: true, generation: 13, observedGeneration: 13, rollout: { phase: 'RolledBack', message: 'not ready after 5m' } })!;
    expect(rb.state).toBe('rolled-back');
    expect(rb.stages[2].detail).toMatch(/previous one was restored/);
    expect(rolloutFromWire({ managed: false, settled: true, generation: null, observedGeneration: null, rollout: null })).toBeNull();
  });
});
