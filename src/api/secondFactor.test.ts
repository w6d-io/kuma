import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// An administrative call refused because the account must use two-step sign-in sends the person to
// the sign-in site's gate — from jinbe's own answer, or, when the gateway refused first with a
// bodiless 403, after asking jinbe once whether that is the reason.

const bounce = vi.hoisted(() => vi.fn(() => true));
vi.mock('../lib/stepUp', () => ({ bounceToTwoStep: bounce }));
vi.mock('../auth/session', () => ({ bearerToken: async () => null }));

import { noticeSecondFactor, request, resetSecondFactorProbe } from './client';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  bounce.mockClear();
  resetSecondFactorProbe();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('second_factor_required', () => {
  it('jinbe\'s 422 second_factor_required → the gate, and the call still fails', async () => {
    fetchMock.mockResolvedValueOnce(json(422, { error: 'second_factor_required', message: 'Your account must use two-step sign-in.' }));
    await expect(request('/admin/users')).rejects.toMatchObject({ status: 422, code: 'second_factor_required' });
    expect(bounce).toHaveBeenCalledTimes(1);
  });

  it('a bodiless gateway 403 → asks jinbe once; goes only when two-step is the reason', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { secondFactorRequired: true, hasSecondFactor: false, methods: [], aal: 'aal1' }));
    noticeSecondFactor(403, undefined);
    noticeSecondFactor(403, undefined);
    await flush(); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/public\/second-factor$/);
    expect(bounce).toHaveBeenCalledTimes(1);
  });

  it('a plain 403 stays a 403: not required, or already at aal2', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { secondFactorRequired: false, hasSecondFactor: false, methods: [], aal: 'aal1' }));
    noticeSecondFactor(403, undefined);
    await flush(); await flush();
    resetSecondFactorProbe();
    fetchMock.mockResolvedValueOnce(json(200, { secondFactorRequired: true, hasSecondFactor: true, methods: ['totp'], aal: 'aal2' }));
    noticeSecondFactor(403, undefined);
    await flush(); await flush();
    expect(bounce).not.toHaveBeenCalled();
  });

  it('jinbe\'s own 403 (a string code) is a permission decision, never probed', () => {
    noticeSecondFactor(403, 'Forbidden');
    noticeSecondFactor(500, undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
