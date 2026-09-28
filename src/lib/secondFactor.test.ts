import { describe, it, expect } from 'vitest';
import { sameGroups, secondFactorPrompt, secondFactorWarnings } from './secondFactor';
import { describeApiError } from './apiError';

describe('secondFactorWarnings', () => {
  it('warns when nobody is required', () => {
    expect(secondFactorWarnings([], { totp: { enabled: true } })).toEqual(['nobody']);
  });
  it('warns when groups are required but no second factor can be set up', () => {
    expect(secondFactorWarnings(['super_admins'], { totp: { enabled: false }, webauthn: { enabled: false } })).toEqual(['no-method']);
    expect(secondFactorWarnings(['super_admins'], { totp: { enabled: false }, webauthn: { enabled: true } })).toEqual([]);
    expect(secondFactorWarnings(['super_admins'], { totp: { enabled: true } })).toEqual([]);
  });
  it('says nothing about methods it cannot see', () => {
    expect(secondFactorWarnings(['super_admins'], undefined)).toEqual([]);
  });
});

describe('sameGroups', () => {
  it('ignores order', () => {
    expect(sameGroups(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameGroups(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('describeApiError · second_factor_required', () => {
  it('reads as a two-step requirement, not a missing permission', () => {
    const v = describeApiError(Object.assign(new Error('x'), { status: 422, code: 'second_factor_required' }));
    expect(v.title).toBe('Two-step sign-in required');
    expect(v.retryable).toBe(false);
  });
});

describe('secondFactorPrompt', () => {
  it('enrol: required and none set up — the persistent indicator', () => {
    expect(secondFactorPrompt({ secondFactorRequired: true, hasSecondFactor: false, aal: 'aal1' })).toBe('enrol');
  });
  it('confirm: set up but signed in without it — only when an action needs it', () => {
    expect(secondFactorPrompt({ secondFactorRequired: true, hasSecondFactor: true, aal: 'aal1' })).toBe('confirm');
  });
  it('nothing at aal2, when not required, or when unknown', () => {
    expect(secondFactorPrompt({ secondFactorRequired: true, hasSecondFactor: true, aal: 'aal2' })).toBeNull();
    expect(secondFactorPrompt({ secondFactorRequired: false, hasSecondFactor: false, aal: 'aal1' })).toBeNull();
    expect(secondFactorPrompt(undefined)).toBeNull();
  });
});
