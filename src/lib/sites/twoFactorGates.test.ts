import { describe, it, expect } from 'vitest';
import { bypassSentence, gateSkipsTwoFactor, twoFactorBypass } from './twoFactorGates';
import type { Gate, Site } from './types';

const gate = (over: Partial<Gate> = {}): Gate => ({ id: 'web', label: 'web', authenticators: [{ handler: 'cookie_session' }], authorizer: 'policy', mutators: [{ handler: 'header' }], errors: 'website', ...over });
const allow = { handler: 'allow' };
const site = (scope: 'none' | 'writes' | 'all' | 'routes', gates: Gate[], over: Partial<Site> = {}) => ({
  login: { twoFactor: { scope, clients: 'exempt' as const }, reach: 'granted' as const },
  gates,
  routes: { items: [], catchAll: { gate: 'web', access: { kind: 'signed-in' as const } } },
  ...over,
});

describe('twoFactorBypass', () => {
  it('a 2FA site whose signed-in catch-all goes through an allow gate is not enforced', () => {
    const b = twoFactorBypass(site('all', [gate({ authorizer: allow })]));
    expect(b).toEqual([{ gate: 'web', label: 'web', reason: 'allow' }]);
    expect(bypassSentence(b)).toBe('2FA set but NOT enforced (gate web lets every signed-in person in)');
  });
  it('nothing to say without 2FA, with the policy, or when the allow gate serves only public routes', () => {
    expect(twoFactorBypass(site('none', [gate({ authorizer: allow })]))).toEqual([]);
    expect(twoFactorBypass(site('all', [gate()]))).toEqual([]);
    expect(twoFactorBypass(site('all', [gate(), gate({ id: 'open', label: 'open', authorizer: allow })], {
      routes: { items: [{ id: 'h', methods: ['GET'], path: '/health', gate: 'open', access: { kind: 'public' } }], catchAll: { gate: 'web', access: { kind: 'signed-in' } } },
    }))).toEqual([]);
  });
  it('the Gates tab warns on any signed-in gate that skips the policy, not on an anonymous one or Nobody', () => {
    const s = site('writes', []);
    expect(gateSkipsTwoFactor(s, gate({ authorizer: allow }))).toMatch(/lets every signed-in person in/);
    expect(gateSkipsTwoFactor(s, gate({ authorizer: { handler: 'remote' } }))).toMatch(/does not ask the policy engine/);
    expect(gateSkipsTwoFactor(s, gate({ authenticators: [{ handler: 'noop' }], authorizer: allow }))).toBeNull();
    expect(gateSkipsTwoFactor(s, gate({ authorizer: { handler: 'deny' } }))).toBeNull();
  });
});
