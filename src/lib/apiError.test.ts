import { describe, it, expect } from 'vitest';
import { describeApiError, toastFor } from './apiError';

const err = (status: number, message = 'x') => Object.assign(new Error(message), { status });

describe('describeApiError', () => {
  it('names a 503 as the engine being unreachable, and offers a retry', () => {
    const v = describeApiError(err(503));
    expect(v.kind).toBe('unreachable');
    expect(v.title).toBe('Engine unreachable');
    expect(v.retryable).toBe(true);
  });

  it('does not tell somebody holding groups that they hold none', () => {
    const v = describeApiError(err(403), { groups: ['platform-viewer'] });
    expect(v.kind).toBe('forbidden');
    expect(v.detail).not.toMatch(/no groups/);
    expect(v.retryable).toBe(false);
  });

  it('says "no groups" only when the session really has none', () => {
    expect(describeApiError(err(403), { groups: [] }).detail).toMatch(/no groups assigned/);
  });

  it('does not guess "no groups" when the session is unknown', () => {
    expect(describeApiError(err(403)).detail).not.toMatch(/no groups/);
  });

  it('keeps the server message for anything else', () => {
    const v = describeApiError(err(500, 'boom'));
    expect(v.kind).toBe('failed');
    expect(v.detail).toBe('boom');
    expect(v.retryable).toBe(true);
  });

  it('treats a network failure (no status) as a retryable failure', () => {
    expect(describeApiError(new TypeError('Failed to fetch')).retryable).toBe(true);
  });
});

describe('toastFor', () => {
  it('puts a plain failure message first, and an access problem as title + detail', () => {
    expect(toastFor(err(500, 'boom'))).toEqual(['boom', { err: true }]);
    expect(toastFor(err(503))[0]).toBe('Engine unreachable');
  });
});
