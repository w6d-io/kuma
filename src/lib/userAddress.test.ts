import { describe, expect, it } from 'vitest';
import type { KratosIdentity } from '../api/client';
import { emailChangeFailure, emailChangeResult, signInAddress, verificationFailure } from './userAddress';
import { mayUse } from '../policy/model';

const identity = (email: string, addresses?: { value: string; verified: boolean }[]) =>
  ({ id: 'u-1', traits: { email }, verifiable_addresses: addresses }) as unknown as KratosIdentity;

describe('signInAddress', () => {
  it('reads whether the sign-in address is verified, whatever its case', () => {
    expect(signInAddress(identity('Bob@Example.com', [{ value: 'bob@example.com', verified: false }]))).toEqual({ value: 'Bob@Example.com', verified: false });
    expect(signInAddress(identity('bob@example.com', [{ value: 'bob@example.com', verified: true }]))?.verified).toBe(true);
  });

  it('says nothing when nothing says', () => {
    expect(signInAddress(identity('bob@example.com'))).toBeNull();
    expect(signInAddress(identity('bob@example.com', [{ value: 'other@example.com', verified: true }]))).toBeNull();
    expect(signInAddress(undefined)).toBeNull();
  });
});

describe('emailChangeFailure', () => {
  it('offers the step-up for a stale second factor, and nothing else does', () => {
    expect(emailChangeFailure({ status: 422, code: 'reauth_required' }).stepUp).toBe(true);
    expect(emailChangeFailure({ status: 422, code: 'step_up_unavailable' }).stepUp).toBeUndefined();
  });

  it('puts the address refusals under the field, without naming an account', () => {
    const taken = emailChangeFailure({ status: 409, code: 'address_unavailable', message: 'x' });
    expect(taken).toMatchObject({ field: true, detail: 'This address cannot be used. Choose another one.' });
    expect(emailChangeFailure({ status: 400, code: 'address_unchanged' }).field).toBe(true);
  });

  it('names own address and outranked, and a bare 403 names the permission', () => {
    expect(emailChangeFailure({ status: 403, code: 'own_address' }).title).toBe('Not your own');
    expect(emailChangeFailure({ status: 403, code: 'outranked', message: 'holds more' }).detail).toBe('holds more');
    expect(emailChangeFailure({ status: 403 }).detail).toContain('users:update_email');
  });
});

describe('emailChangeResult', () => {
  const base = { id: 'u-1', email: 'new@example.com', verified: false, oldAddressNotice: { delivered: false, recorded: true, channel: 'audit' } };
  it('says the link went and where the old-address notice is', () => {
    const r = emailChangeResult({ ...base, verificationSent: true });
    expect(r.verificationTone).toBe('success');
    expect(r.verification).toContain('new@example.com');
    expect(r.notice).toContain('audit trail');
  });

  it('says when no link went, and why', () => {
    expect(emailChangeResult({ ...base, verificationSent: false, verificationError: 'verification_link_unavailable' }).verification).toContain('by code only');
    expect(emailChangeResult({ ...base, verificationSent: false, verificationError: 'send_failed' }).verification).toContain('Resend verification email');
    expect(emailChangeResult({ ...base, verificationSent: true, oldAddressNotice: { delivered: false, recorded: false } }).notice).toContain('could not be recorded');
  });
});

describe('verificationFailure', () => {
  it('reads each refusal of the resend', () => {
    expect(verificationFailure({ status: 429, retryAfter: 600, message: 'Too many verification links were sent to this user recently.' }))
      .toEqual({ kind: 'rate_limited', retryAfterSeconds: 600, you: false });
    expect(verificationFailure({ status: 429, message: 'You sent too many verification links in the last hour.' }))
      .toMatchObject({ you: true, retryAfterSeconds: null });
    expect(verificationFailure({ status: 409, code: 'already_verified' })).toEqual({ kind: 'already_verified' });
    expect(verificationFailure({ status: 409, code: 'verification_link_unavailable' })).toEqual({ kind: 'unavailable' });
    expect(verificationFailure({ status: 422, code: 'unknown_address' })).toEqual({ kind: 'unknown_address' });
    expect(verificationFailure({ status: 500, message: 'boom' })).toEqual({ kind: 'failed', message: 'boom' });
  });
});

describe('mayUse', () => {
  it('trusts jinbe\'s expansion when it gives one', () => {
    expect(mayUse({ permissions: ['admin:write'], effective_permissions: ['users:verify'] }, 'users:verify')).toBe(true);
    expect(mayUse({ permissions: ['admin:write'], effective_permissions: ['users:verify'] }, 'users:update_email')).toBe(false);
  });

  it('on an older jinbe, the permission itself or admin:write', () => {
    expect(mayUse({ permissions: ['admin:write'] }, 'users:update_email')).toBe(true);
    expect(mayUse({ permissions: ['users:verify'] }, 'users:verify')).toBe(true);
    expect(mayUse({ permissions: ['users:read'] }, 'users:verify')).toBe(false);
    expect(mayUse(undefined, 'users:verify')).toBe(false);
  });
});
