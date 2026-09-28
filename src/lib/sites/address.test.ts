import { describe, expect, it } from 'vitest';
import { addressOf, formOf, formProblems, groupChecks, linksToMove, movedUrl, withAddress } from './address';
import type { Site } from './types';

const site = (login?: Site['login']): Site => ({
  name: 'echo', displayName: 'Echo', address: { host: 'echo-sandbox.dev.example.com' },
  upstream: { service: 'echo', namespace: 'echo', port: 8080 }, exposure: { mode: 'zone' },
  gates: [], routes: { items: [], catchAll: { gate: 'web', access: { kind: 'signed-in' } } },
  roles: 'standard', groups: { platform: {}, orgGrantable: {} }, orgs: [], ...(login ? { login } : {}),
} as Site);
const login = (defaultReturnUrl?: string, postLogoutUrl?: string): Site['login'] => ({ twoFactor: { scope: 'none', clients: 'exempt' }, reach: 'granted', defaultReturnUrl, postLogoutUrl });

describe('address form', () => {
  it('splits a host on the most specific zone, and back', () => {
    expect(formOf({ host: 'pay.authdev.dev.example.com', pathPrefix: '/v2' }, ['dev.example.com', 'authdev.dev.example.com'])).toEqual({ label: 'pay', zone: 'authdev.dev.example.com', pathPrefix: '/v2' });
    expect(formOf({ host: 'echo.example.org' }, [])).toEqual({ label: 'echo', zone: 'example.org', pathPrefix: '' });
    expect(addressOf({ label: 'x', zone: 'dev.example.com', pathPrefix: '' })).toEqual({ host: 'x.dev.example.com' });
  });

  it('checks the format of each part, as jinbe', () => {
    expect(formProblems({ label: 'ok-1', zone: 'dev.example.com', pathPrefix: '/pay' })).toEqual({});
    expect(Object.keys(formProblems({ label: 'a.b', zone: '', pathPrefix: '/p/:id' }))).toEqual(['label', 'zone', 'pathPrefix']);
  });
});

describe('links on the old address', () => {
  it('moves the landing page and sign-out link to the same path under the new address', () => {
    const s = site(login('https://echo-sandbox.dev.example.com/home?t=1', 'https://elsewhere.test/bye'));
    const to = { host: 'something-else.dev.example.com' };
    expect(linksToMove(s, to)).toEqual([{ field: 'defaultReturnUrl', label: 'Landing page after sign-in', from: 'https://echo-sandbox.dev.example.com/home?t=1', to: 'https://something-else.dev.example.com/home?t=1' }]);
    expect(withAddress(s, to, true).login?.defaultReturnUrl).toBe('https://something-else.dev.example.com/home?t=1');
    expect(withAddress(s, to, true).login?.postLogoutUrl).toBe('https://elsewhere.test/bye');
    expect(withAddress(s, to, false).login?.defaultReturnUrl).toBe('https://echo-sandbox.dev.example.com/home?t=1');
    expect(withAddress(s, to, false).address).toEqual(to);
  });

  it('a prefix move keeps what follows the prefix', () => {
    expect(movedUrl('https://h.dev.example.com/pay/home', { host: 'h.dev.example.com', pathPrefix: '/pay' }, { host: 'h.dev.example.com', pathPrefix: '/payroll' })).toBe('https://h.dev.example.com/payroll/home');
    expect(movedUrl('not a url', { host: 'a' }, { host: 'b' })).toBeNull();
  });
});

it('groups checks by severity, the address change first among warnings', () => {
  const g = groupChecks([
    { level: 'warn', code: 'no_sso', message: 'a' },
    { level: 'error', code: 'host_taken', message: 'b' },
    { level: 'warn', code: 'address_changed', message: 'c' },
  ]);
  expect(g.blocking.map((c) => c.code)).toEqual(['host_taken']);
  expect(g.warnings.map((c) => c.code)).toEqual(['address_changed', 'no_sso']);
});
