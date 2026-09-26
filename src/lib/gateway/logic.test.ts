import { describe, it, expect } from 'vitest';
import {
  parseGatewayHash, gatewayHref, rowsOf, secretState, vaultRefProblem, configProblems, disableBlockers, secretKeys, kindOfHandler,
} from './logic';
import { CATALOG, handlerInfo } from './catalog';
import type { GatewayState } from './types';

describe('address', () => {
  it('reads the list, a kind filter and one handler', () => {
    expect(parseGatewayHash('#/gateway')).toEqual({ kind: null, name: null, query: {} });
    expect(parseGatewayHash('#/gateway?kind=mutators')).toMatchObject({ kind: 'mutators', name: null });
    expect(parseGatewayHash('#/gateway/authenticators/jwt?level=expert')).toEqual({ kind: 'authenticators', name: 'jwt', query: { level: 'expert' } });
    expect(parseGatewayHash('#/gateway/nope/jwt')).toMatchObject({ kind: null, name: null });
  });
  it('writes links that read back', () => {
    expect(gatewayHref()).toBe('#/gateway');
    expect(gatewayHref('errors')).toBe('#/gateway?kind=errors');
    const h = gatewayHref('mutators', 'hydrator', { level: 'advanced' });
    expect(h).toBe('#/gateway/mutators/hydrator?level=advanced');
    expect(parseGatewayHash(h)).toMatchObject({ kind: 'mutators', name: 'hydrator' });
  });
});

describe('rowsOf', () => {
  const state: GatewayState = {
    version: 3, etag: 'e',
    handlers: { authenticators: [{ name: 'cookie_session', enabled: true, config: {}, usedBy: [{ site: 'payroll', gates: ['browser'] }] }, { name: 'custom_x', enabled: true, config: {}, usedBy: [] }], authorizers: [], mutators: [], errors: [] },
  };
  it('lists every catalog handler, off when the server does not report it, plus unknown server ones', () => {
    const rows = rowsOf(state, 'authenticators');
    expect(rows.find((r) => r.name === 'cookie_session')).toMatchObject({ enabled: true, known: true });
    expect(rows.find((r) => r.name === 'jwt')).toMatchObject({ enabled: false, known: false });
    expect(rows.find((r) => r.name === 'custom_x')?.info.summary).toMatch(/JSON/);
    expect(rows).toHaveLength(CATALOG.authenticators.length + 1);
  });
  it('covers hydrator and every error handler', () => {
    expect(rowsOf(undefined, 'mutators').map((r) => r.name)).toContain('hydrator');
    expect(rowsOf(undefined, 'errors').map((r) => r.name)).toEqual(['json', 'redirect', 'www_authenticate']);
  });
  it('names the sites that block disabling', () => {
    expect(disableBlockers(rowsOf(state, 'authenticators')[0])).toEqual(['payroll']);
  });
});

describe('secrets', () => {
  it('tells masked, Vault and plaintext apart', () => {
    expect(secretState({ masked: true })).toBe('masked');
    expect(secretState({ vault: 'kv/a#b' })).toBe('vault');
    expect(secretState('hunter2')).toBe('plaintext');
    expect(secretState(undefined)).toBe('empty');
  });
  it('checks the Vault reference shape', () => {
    expect(vaultRefProblem('kv/auth/hydrator#password')).toBeNull();
    expect(vaultRefProblem('hydrator')).toMatch(/kv\//);
    expect(vaultRefProblem('')).toMatch(/Vault path/);
  });
  it('knows the catalog secret fields', () => {
    const row = { info: handlerInfo('mutators', 'hydrator'), secrets: [] };
    expect(secretKeys(row)).toEqual(['api.auth.basic.password']);
  });
});

describe('configProblems', () => {
  const hydrator = { info: handlerInfo('mutators', 'hydrator') };
  it('requires the global-required fields only when enabling', () => {
    expect(configProblems(hydrator, {}, true).map((p) => p.key)).toContain('api.url');
    expect(configProblems(hydrator, {}, false)).toEqual([]);
  });
  it('refuses a typed secret and a bad duration', () => {
    const p = configProblems(hydrator, { api: { url: 'http://x', auth: { basic: { password: 'hunter2' } } }, cache: { ttl: '1 minute' } }, true);
    expect(p.map((x) => x.key)).toEqual(['api.auth.basic.password', 'cache.ttl']);
    expect(p.every((x) => x.blocking)).toBe(true);
  });
  it('accepts a Vault reference and a masked value', () => {
    expect(configProblems(hydrator, { api: { url: 'http://x', auth: { basic: { password: { vault: 'kv/auth/h#pw' } } } } }, true)).toEqual([]);
    expect(configProblems(hydrator, { api: { url: 'http://x', auth: { basic: { password: { masked: true } } } } }, true)).toEqual([]);
  });
});

describe('kindOfHandler', () => {
  it('finds the kind for a handler name', () => {
    expect(kindOfHandler('jwt')).toBe('authenticators');
    expect(kindOfHandler('hydrator')).toBe('mutators');
    expect(kindOfHandler('www_authenticate')).toBe('errors');
    expect(kindOfHandler('nope')).toBeNull();
  });
});
