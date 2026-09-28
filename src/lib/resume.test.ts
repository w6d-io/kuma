import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bounce = vi.hoisted(() => vi.fn(() => true));
vi.mock('./stepUp', () => ({ bounceToStepUp: bounce }));

import { rememberResume, stepUpAndAskToRedo, stepUpAndResume, takeRedo, takeResume } from './resume';

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
