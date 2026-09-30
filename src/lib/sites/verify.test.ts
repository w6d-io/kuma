import { describe, it, expect } from 'vitest';
import { findingsBlocker, groupFindings, mergeFindings, unacknowledged } from './verify';
import type { Finding } from './types';

const f = (code: string, level: Finding['level'], message = code): Finding => ({ code, level, message, fix: '' });

describe('findings', () => {
  it('groups confirm findings by code: one acknowledgement covers the code', () => {
    const g = groupFindings([f('public_route', 'confirm', 'a'), f('public_route', 'confirm', 'b'), f('waf_off', 'warn'), f('noop_with_policy', 'error')]);
    expect(g.confirm).toEqual([{ code: 'public_route', items: [expect.objectContaining({ message: 'a' }), expect.objectContaining({ message: 'b' })] }]);
    expect(g.errors).toHaveLength(1);
    expect(g.warnings).toHaveLength(1);
  });
  it('says what is left: errors first, then codes to acknowledge', () => {
    const list = [f('public_route', 'confirm'), f('wildcard_role', 'confirm')];
    expect(unacknowledged(list, new Set(['public_route']))).toEqual(['wildcard_role']);
    expect(findingsBlocker(list, new Set(['public_route']))).toBe('Acknowledge 1 finding first.');
    expect(findingsBlocker(list, new Set(['public_route', 'wildcard_role']))).toBeNull();
    expect(findingsBlocker([...list, f('bearer_before_oauth2', 'error')], new Set(['public_route', 'wildcard_role']))).toMatch(/1 security error/);
  });
  it('merges without repeating a finding', () => {
    expect(mergeFindings([f('a', 'confirm')], [f('a', 'confirm'), f('b', 'warn')]).map((x) => x.code)).toEqual(['a', 'b']);
  });
});
