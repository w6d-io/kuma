import { describe, expect, it } from 'vitest';
import { blockedForEnrolment, ownStatus, secondFactorRefusalSentence, siteScopeLabel, stepUpTitle, type UserSecondFactor } from './twoFactor';
import { describeApiError } from './apiError';

const me = (over: Partial<UserSecondFactor> = {}): UserSecondFactor => ({
  required: false, requiredBecause: [], enrolled: true, methods: ['totp'], currentAal: 'aal2', factorAgeMin: 3, stepUpFresh: true, stepUpPermissions: [], ...over,
});
const refusal = (status: number, body: Record<string, unknown>) =>
  Object.assign(new Error(String(body.message ?? 'x')), { status, code: body.error, details: body });

describe('two-step sign-in rules, in words', () => {
  it('says a site’s bar in a few words, nothing when it asks for none', () => {
    expect(siteScopeLabel({ scope: 'all', routes: [] })).toBe('2FA on every request');
    expect(siteScopeLabel({ scope: 'writes', routes: [] })).toBe('2FA for changes');
    expect(siteScopeLabel({ scope: 'writes', routes: ['a', 'b'] })).toBe('2FA for changes + 2 routes');
    expect(siteScopeLabel({ scope: 'routes', routes: ['a'] })).toBe('2FA on 1 route');
    expect(siteScopeLabel({ scope: 'none', routes: [] })).toBeNull();
    expect(siteScopeLabel(undefined)).toBeNull();
  });

  it('blocks a group for somebody who never enrolled when its members must use 2FA (or it needs enrolment)', () => {
    expect(blockedForEnrolment({ required: true }, false)).toBe(true);
    expect(blockedForEnrolment({ required: false, enrolBeforeJoining: true }, false)).toBe(true);
    expect(blockedForEnrolment({ required: false, enrolBeforeJoining: false }, false)).toBe(false);
    expect(blockedForEnrolment({ required: true }, true)).toBe(false);
    expect(blockedForEnrolment({ required: true }, undefined)).toBe(false);
  });

  it('describes the step-up with the key stand-in and four-eyes', () => {
    expect(stepUpTitle({ maxAgeMin: 15, viaPersonalKey: { maxAgeDays: 30 }, fourEyes: 'prod' }))
      .toBe('Needs a second factor proven in the last 15 minutes. A personal key created after a second factor stands in for 30 days. In production a second person approves.');
  });

  it('tells you where it is required for you and why, and whether a recent factor is needed now', () => {
    const none = ownStatus(me({ enrolled: false, currentAal: 'aal1', methods: [] }));
    expect(none.title).toBe('Two-step sign-in optional for you');
    const missing = ownStatus(me({ required: true, requiredBecause: ['ops'], enrolled: false, currentAal: 'aal1' }));
    expect(missing).toMatchObject({ tone: 'danger', title: 'Two-step sign-in required — not set up' });
    expect(missing.lines[0]).toBe('Required for you as a member of ops.');
    const stale = ownStatus(me({ required: true, requiredBecause: ['ops'], stepUpFresh: false, factorAgeMin: 40, stepUpPermissions: ['sites:apply', 'users:update_email'] }));
    expect(stale.tone).toBe('ok');
    expect(stale.lines).toContain('This session used it 40 min ago.');
    expect(stale.lines).toContain('2 of your permissions need it proven in the last 15 minutes: you are asked to confirm it when you use them.');
    expect(ownStatus(me({ required: true, requiredBecause: ['ops'], currentAal: 'aal1' })).tone).toBe('warning');
  });

  it('names the rule in a refusal: the groups, the permission, the site', () => {
    expect(secondFactorRefusalSentence(refusal(422, { error: 'second_factor_required', secondFactor: { rule: 'group_sign_in', requiredBecause: ['ops'] } })))
      .toBe('Your account must use two-step sign-in as a member of ops. Sign in with your second factor, then retry.');
    expect(secondFactorRefusalSentence(refusal(422, { error: 'reauth_required', permission: 'sites:apply', secondFactor: { rule: 'step_up', maxAgeMin: 15 } })))
      .toBe('sites:apply needs a second factor proven in the last 15 minutes. Confirm it, then retry.');
    expect(secondFactorRefusalSentence(refusal(422, { error: 'second_factor_required', secondFactor: { rule: 'site_login' } }))).toMatch(/This site asks/);
    expect(secondFactorRefusalSentence(refusal(403, { error: 'Forbidden' }))).toBeNull();
  });

  it('carries the rule into the shared error wording', () => {
    const e = refusal(422, { error: 'second_factor_required', secondFactor: { rule: 'group_sign_in', requiredBecause: ['ops'] } });
    expect(describeApiError(e).detail).toMatch(/^Your account must use two-step sign-in as a member of ops\./);
    const stepUp = refusal(422, { error: 'step_up_unavailable', permission: 'groups:write', secondFactor: { rule: 'step_up', maxAgeMin: 15 } });
    expect(describeApiError(stepUp)).toMatchObject({ title: 'Two-step sign-in needed', detail: expect.stringContaining('groups:write needs a second factor') });
    expect(describeApiError(refusal(422, { error: 'mfa_required' })).title).toBe('Second factor not enrolled');
  });
});
