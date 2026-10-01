import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bounce = vi.hoisted(() => vi.fn(() => true));
vi.mock('./stepUp', () => ({ bounceToStepUp: bounce }));

import { rememberResume, stepUpAndAskToRedo, stepUpAndResume, stepUpOnRefusal, takeRedo, takeResume } from './resume';

beforeEach(() => { sessionStorage.clear(); bounce.mockClear(); });
afterEach(() => { sessionStorage.clear(); });

describe('resume after a step-up', () => {
  it('keeps what the action needs across the round trip, and gives it back once', () => {
    expect(stepUpAndResume('site-apply:echo', { version: 17 })).toBe(true);
    expect(bounce).toHaveBeenCalledTimes(1);
    expect(takeResume('site-apply:echo')).toEqual({ version: 17 });
    expect(takeResume('site-apply:echo')).toBeNull();
  });

  it('is per action: another screen does not pick it up', () => {
    rememberResume('site-apply:echo', { version: 3 });
    expect(takeResume('site-apply:other')).toBeNull();
    expect(takeResume('site-apply:echo')).toEqual({ version: 3 });
  });

  it('forgets an intent older than ten minutes', () => {
    rememberResume('zone-edit', { name: 'dev' }, 1_000);
    expect(takeResume('zone-edit', 1_000 + 11 * 60_000)).toBeNull();
  });

  it('does not loop: refused again right after resuming, it does not bounce a second time', () => {
    rememberResume('gateway-apply', { note: '' }, 1_000);
    takeResume('gateway-apply', 2_000);
    expect(rememberResume('gateway-apply', { note: '' }, 3_000)).toBe(false);
    expect(rememberResume('gateway-apply', { note: '' }, 2_000 + 61_000)).toBe(true);
  });

  it('asks to redo what cannot be re-run by itself, once', () => {
    expect(stepUpAndAskToRedo('Delete echo again.')).toBe(true);
    expect(takeRedo()).toBe('Delete echo again.');
    expect(takeRedo()).toBeNull();
  });
});

describe('stepUpOnRefusal', () => {
  const reauth = Object.assign(new Error('x'), { status: 422, code: 'reauth_required' });

  it('leaves any other error to the caller', () => {
    const toast = vi.fn();
    expect(stepUpOnRefusal(Object.assign(new Error('no'), { status: 403 }), toast, { redo: 'again' })).toBe(false);
    expect(toast).not.toHaveBeenCalled();
    expect(bounce).not.toHaveBeenCalled();
  });

  it('remembers the action and bounces, saying it is saved by itself on the way back', () => {
    const toast = vi.fn();
    expect(stepUpOnRefusal(reauth, toast, { resume: 'org-sites', data: { organizationId: 'o1', services: ['echo'] } })).toBe(true);
    expect(bounce).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][1].sub).toContain('saved by itself');
    expect(takeResume('org-sites')).toEqual({ organizationId: 'o1', services: ['echo'] });
  });

  it('asks to redo what the screen cannot replay', () => {
    const toast = vi.fn();
    expect(stepUpOnRefusal(reauth, toast, { redo: 'Delete the group again.' })).toBe(true);
    expect(takeRedo()).toBe('Delete the group again.');
    expect(toast.mock.calls[0][1].sub).toContain('do it again');
  });

  it('says to re-verify by hand when the bounce cannot go', () => {
    bounce.mockReturnValueOnce(false);
    const toast = vi.fn();
    expect(stepUpOnRefusal(reauth, toast, { redo: 'x' })).toBe(true);
    expect(toast.mock.calls[0][1].sub).toContain('then try again');
  });
});
