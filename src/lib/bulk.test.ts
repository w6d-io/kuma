import { describe, expect, it } from 'vitest';
import { actionText, bulkFailure, jobItemView, outcomeView, parseInvites, reasonText, warningText } from './bulk';

describe('parseInvites', () => {
  it('reads lines, commas and names, lower-cases, and counts an address once', () => {
    const r = parseInvites('jane@example.com\nJohn Roe <John@Example.com>, "Ann Lee" <ann@example.com>; jane@example.com\n\n');
    expect(r.invites).toEqual([
      { email: 'jane@example.com' },
      { email: 'john@example.com', name: 'John Roe' },
      { email: 'ann@example.com', name: 'Ann Lee' },
    ]);
    expect(r.invalid).toEqual([]);
    expect(r.tooMany).toBe(false);
  });

  it('keeps what is not an address apart', () => {
    expect(parseInvites('nope\nbob@example.com\nalso not').invalid).toEqual(['nope', 'also not']);
  });

  it('takes 200 at most and says so', () => {
    const r = parseInvites(Array.from({ length: 205 }, (_, i) => `u${i}@example.com`).join('\n'));
    expect(r.invites).toHaveLength(200);
    expect(r.tooMany).toBe(true);
  });
});

describe('reasons and actions', () => {
  it('reads jinbe\'s codes', () => {
    expect(reasonText('missing:users:recovery')).toBe('Needs users:recovery');
    expect(reasonText('group_not_in_model:ops')).toBe('No group named ops');
    expect(reasonText('rate_limited:caller')).toBe('You reached 30 links this hour');
    expect(reasonText('rate_limited:target')).toBe('Three links in 15 minutes already');
    expect(reasonText('invalid:email:Invalid email')).toBe('Not valid: Invalid email');
    expect(reasonText('self_change')).toContain('Your own account');
    expect(reasonText('something_new')).toBe('something_new');
    expect(actionText('add:ops,billing')).toBe('Add to ops, billing');
    expect(actionText('create:invite_failed')).toContain('invite email not sent');
  });

  it('labels planned and run items', () => {
    expect(outcomeView({ status: 'ok', action: 'send' })).toEqual({ tone: 'success', label: 'will run', detail: 'Send the link' });
    expect(outcomeView({ status: 'not_found' }).detail).toBe('No such user');
    expect(outcomeView({ status: 'skip', reason: 'already_verified' }).detail).toBe('Already verified');
    expect(jobItemView({ status: 'failed', reason: 'rate_limited:target' }).tone).toBe('danger');
    expect(jobItemView({ status: 'done', action: 'create' }).detail).toBe('Create the account');
    expect(warningText('caller_limit: at most 30 verification links per hour')).toContain('at most 30');
  });
});

describe('bulkFailure', () => {
  it('carries the new plan when the old one no longer holds', () => {
    const plan = { planId: 'p2' };
    expect(bulkFailure({ status: 409, code: 'plan_changed', details: { plan } }).plan).toBe(plan);
  });

  it('offers to preview again for an expired plan, and the step-up for a stale factor', () => {
    expect(bulkFailure({ status: 409, code: 'plan_hash_mismatch' }).replan).toBe(true);
    expect(bulkFailure({ status: 404, code: 'plan_not_found' }).replan).toBe(true);
    expect(bulkFailure({ status: 422, code: 'reauth_required' }).stepUp).toBe(true);
    expect(bulkFailure({ status: 500, message: 'boom' })).toEqual({ title: 'Nothing ran', detail: 'boom' });
  });
});
