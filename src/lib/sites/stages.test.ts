import { describe, it, expect } from 'vitest';
import { fromProgress, derivedStages, settled, applyFinished } from './stages';
import type { SiteK8sStatus } from './types';

describe('fromProgress', () => {
  it('orders stages canonically, times them, and reads skipped as done', () => {
    const v = fromProgress({ stages: [
      { id: 'rules-loaded', state: 'running' },
      { id: 'saved', state: 'done', startedAt: '2026-09-25T10:00:00.000Z', endedAt: '2026-09-25T10:00:00.100Z' },
      { id: 'ingress', label: 'Ingress', state: 'skipped' },
      { id: 'extra', state: 'pending' },
    ] });
    expect(v.map((s) => s.id)).toEqual(['saved', 'rules-loaded', 'ingress', 'extra']);
    expect(v[0].meta).toBe('0.1 s');
    expect(v[2]).toMatchObject({ label: 'Ingress', state: 'done', detail: 'not needed' });
  });
  it('says why a failed apply did not go live, and knows when it is finished', () => {
    const p = { state: 'rolled-back' as const, code: 'rules_not_loaded', stages: [{ id: 'saved', state: 'done' as const }] };
    expect(fromProgress(p).at(-1)).toMatchObject({ label: 'Rolled back', state: 'failed' });
    expect(fromProgress(p).at(-1)?.detail).toMatch(/previous version/);
    expect(applyFinished(p)).toBe(true);
    expect(applyFinished({ state: 'running', stages: [] })).toBe(false);
  });
});

describe('derivedStages', () => {
  it('shows the apply call running, then done without status', () => {
    expect(derivedStages({ applying: true, applied: false })[1].state).toBe('running');
    const v = derivedStages({ applying: false, applied: true, statusUnavailable: true });
    expect(v.find((s) => s.id === 'rules')?.detail).toMatch(/Not observable/);
    expect(settled(v)).toBe(true);
  });
  it('reports a failure in words', () => {
    const v = derivedStages({ applying: false, applied: false, failure: 'checks failed' });
    expect(v.at(-1)).toMatchObject({ state: 'failed', detail: 'checks failed' });
  });
  it('follows the Site status through the operator and the gateway', () => {
    const st: SiteK8sStatus = {
      generation: 8, observedGeneration: 8,
      conditions: [{ type: 'Validated', status: 'True' }, { type: 'RulesLoaded', status: 'True' }, { type: 'CertificateReady', status: 'True', reason: 'NotRequired' }],
      children: [{ kind: 'Rule', name: 'r', conditions: [], loadedOn: [{ pod: 'a', loaded: true }] }],
    };
    const v = derivedStages({ applying: false, applied: true, status: st });
    expect(v.find((s) => s.id === 'accepted')?.state).toBe('done');
    expect(v.find((s) => s.id === 'rules')?.state).toBe('done');
    expect(v.find((s) => s.id === 'https')?.detail).toMatch(/wildcard/);
    const pending = derivedStages({ applying: false, applied: true, status: { ...st, observedGeneration: 7 } });
    expect(pending.find((s) => s.id === 'accepted')?.state).toBe('running');
    const refused = derivedStages({ applying: false, applied: true, status: { ...st, conditions: [{ type: 'Validated', status: 'False', reason: 'RuleOverlap', message: 'with portal' }] } });
    expect(refused.find((s) => s.id === 'accepted')).toMatchObject({ state: 'failed' });
  });
});
