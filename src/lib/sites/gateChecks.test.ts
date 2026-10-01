import { describe, it, expect } from 'vitest';
import { gateChecks, moveHandler, explicitErrors, patternShape, siteGateChecks, mergeChecks } from './gateChecks';
import type { Gate } from './types';

const g = (over: Partial<Gate>): Gate => ({ id: 'b', label: 'B', authenticators: [{ handler: 'cookie_session' }], authorizer: 'policy', mutators: [{ handler: 'header' }], errors: 'website', ...over });
const codes = (gate: Gate) => gateChecks(gate).map((c) => c.code);

describe('gateChecks', () => {
  it('passes a template gate', () => {
    expect(gateChecks(g({}))).toEqual([]);
  });
  it('noop only last or alone, and never with the policy', () => {
    expect(codes(g({ authenticators: [{ handler: 'noop' }, { handler: 'cookie_session' }] }))).toContain('noop_not_last');
    expect(codes(g({ authenticators: [{ handler: 'noop' }] }))).toContain('noop_with_policy');
  });
  it('hydrator before header; noop mutator warns on a signed-in gate', () => {
    expect(codes(g({ mutators: [{ handler: 'header' }, { handler: 'hydrator' }] }))).toContain('hydrator_order');
    expect(codes(g({ mutators: [{ handler: 'noop' }] }))).toContain('gate_passes_no_identity');
  });
  it('refuses secrets anywhere in a config', () => {
    const c = gateChecks(g({ authenticators: [{ handler: 'cookie_session', config: { additional_headers: { Authorization: 'Bearer abcdefgh' } } }] }));
    expect(c[0]).toMatchObject({ level: 'error', code: 'secret_in_rule' });
  });
  it('a gate nobody can sign in through is an error', () => {
    expect(gateChecks(g({ authenticators: [] }))[0]).toMatchObject({ level: 'error', code: 'gate_without_authenticator' });
  });
  it('a session token read from Authorization warns unless introspection runs first', () => {
    const bare = { handler: 'bearer_token' };
    expect(gateChecks(g({ authenticators: [{ handler: 'cookie_session' }, bare] }))).toEqual([expect.objectContaining({ level: 'warn', code: 'bare_bearer_token' })]);
    expect(gateChecks(g({ authenticators: [bare, { handler: 'oauth2_introspection' }] }))).toEqual([expect.objectContaining({ level: 'error', code: 'bearer_before_oauth2' })]);
    expect(codes(g({ authenticators: [{ handler: 'oauth2_introspection' }, bare] }))).not.toContain('bare_bearer_token');
    expect(codes(g({ authenticators: [{ handler: 'bearer_token', config: { token_from: { header: 'X-Session-Token' } } }] }))).toEqual([]);
  });
  it('a Cookie header on the identity headers is refused (jinbe would replace it)', () => {
    expect(gateChecks(g({ mutators: [{ handler: 'header', config: { headers: { COOKIE: 'a=b' } } }] }))).toEqual([expect.objectContaining({ level: 'error', code: 'cookie_header_reserved' })]);
    expect(codes(g({ mutators: [{ handler: 'header', config: { headers: { 'X-Org': '{{ print .Subject }}' } } }] }))).toEqual([]);
  });
  it('jwt scopes need a strategy', () => {
    expect(codes(g({ authenticators: [{ handler: 'jwt', config: { required_scope: ['a'] } }] }))).toContain('jwt_scope');
  });
});

describe('siteGateChecks', () => {
  it('names the gate when there are several, and does not repeat a server check', () => {
    const site = { gates: [g({ id: 'a', label: 'A', authenticators: [] }), g({})] } as never;
    const local = siteGateChecks(site);
    expect(local).toEqual([expect.objectContaining({ code: 'gate_without_authenticator', path: 'gates.0.authenticators', message: expect.stringMatching(/^A: /) })]);
    expect(mergeChecks([{ level: 'error', code: 'gate_without_authenticator', message: 'x', path: 'gates.0.authenticators' }], local)).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('moves within bounds', () => {
    expect(moveHandler(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveHandler(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
  it('writes out error presets', () => {
    expect(explicitErrors('website').map((h) => h.handler)).toEqual(['redirect', 'json']);
    expect(explicitErrors('platform')).toEqual([]);
  });
});

describe('patternShape', () => {
  it('accepts a generated-looking pattern', () => {
    expect(patternShape('<https?>://p.dev.example.com/api<(/.*)?>')).toBeNull();
  });
  it('refuses unbalanced, nested, ** and look-behind', () => {
    expect(patternShape('<https?>://p/<a')).toMatch(/not closed/);
    expect(patternShape('<https?>://p/<<a>>')).toMatch(/inside/);
    expect(patternShape('https://p/**')).toMatch(/\*\*/);
    expect(patternShape('https://p/<(?<=x)>')).toMatch(/look-behind/);
  });
});
