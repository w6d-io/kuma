import { describe, it, expect } from 'vitest';
import { gateChecks, moveHandler, explicitErrors, patternShape } from './gateChecks';
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
    expect(codes(g({ mutators: [{ handler: 'noop' }] }))).toContain('noop_mutator');
  });
  it('refuses secrets anywhere in a config', () => {
    const c = gateChecks(g({ authenticators: [{ handler: 'cookie_session', config: { additional_headers: { Authorization: 'Bearer abcdefgh' } } }] }));
    expect(c[0]).toMatchObject({ level: 'error', code: 'secret_in_rule' });
  });
  it('jwt scopes need a strategy', () => {
    expect(codes(g({ authenticators: [{ handler: 'jwt', config: { required_scope: ['a'] } }] }))).toContain('jwt_scope');
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
    expect(patternShape('<https?>://p.dev.stairling.com/api<(/.*)?>')).toBeNull();
  });
  it('refuses unbalanced, nested, ** and look-behind', () => {
    expect(patternShape('<https?>://p/<a')).toMatch(/not closed/);
    expect(patternShape('<https?>://p/<<a>>')).toMatch(/inside/);
    expect(patternShape('https://p/**')).toMatch(/\*\*/);
    expect(patternShape('https://p/<(?<=x)>')).toMatch(/look-behind/);
  });
});
