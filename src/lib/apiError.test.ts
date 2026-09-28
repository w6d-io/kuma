import { describe, it, expect } from 'vitest';
import { describeApiError, orgDirectoryNotConfigured, toastFor } from './apiError';

const err = (status: number, message = 'x') => Object.assign(new Error(message), { status });
// What the API client throws for a 503 body `{error, message?}` (src/api/client.ts errorFrom).
const outage = (error: string, message?: string) =>
  Object.assign(new Error(message || error), { status: 503, code: error, details: { error, ...(message ? { message } : {}) } });

describe('describeApiError', () => {
  it('blames the access engine only for an OPA outage, and offers a retry', () => {
    const v = describeApiError(outage('policy_unavailable', 'Access cannot be checked right now; try again shortly'));
    expect(v.kind).toBe('unreachable');
    expect(v.title).toBe('Access engine unreachable');
    expect(v.retryable).toBe(true);
    // The guards answer a bare "Service Unavailable" and name the cause only in the message.
    expect(describeApiError(outage('Service Unavailable', 'Unable to verify authorization. Please try again later.')).title).toBe('Access engine unreachable');
    expect(describeApiError(outage('OPA could not be asked, so nobody may add members: timeout')).title).toBe('Access engine unreachable');
  });

  it('names Kubernetes, gatekit, Loki, Tempo and Kratos for what they are', () => {
    const cases: Array<[string, string | undefined, string]> = [
      ['kubernetes_unavailable', 'The Kubernetes API is unavailable, nothing was changed (get site: 500)', 'Kubernetes unreachable'],
      ['checks_unavailable', 'Checks are unavailable, nothing was changed (timed out)', 'Rule checks unavailable'],
      ['audit_store_unavailable', undefined, 'Audit log unreachable'],
      ['trace_store_unavailable', undefined, 'Traces unreachable'],
      ['Identity service unavailable', 'Kratos answered 503', 'Identity service unreachable'],
    ];
    for (const [code, message, title] of cases) {
      const v = describeApiError(outage(code, message));
      expect(v.title).toBe(title);
      expect(v.detail).not.toMatch(/access engine/i);
      expect(v.kind).toBe('unreachable');
    }
  });

  it('keeps the server message when it is the precise one', () => {
    const msg = 'Permissions were published but the gateway rules were not written; nothing new is reachable yet. Retry apply.';
    expect(describeApiError(outage('rules_pending', msg))).toMatchObject({ title: 'Gateway rules not written', detail: msg });
  });

  it('falls back to "Service unavailable" with what the server said', () => {
    expect(describeApiError(outage('Service Unavailable', 'Database connection failed'))).toMatchObject({ title: 'Service unavailable', detail: 'Database connection failed', retryable: true });
    // A plain `{error: <sentence>}` (the generic handler): the sentence is the message.
    const lock = "Could not acquire lock 'groups' within 5000ms — another operation is in progress; please retry.";
    expect(describeApiError(outage(lock)).detail).toBe(lock);
    // Nothing said at all: no "HTTP 503" or "Service Unavailable" echoed back as if it explained anything.
    const bare = describeApiError(err(503, 'HTTP 503'));
    expect(bare.title).toBe('Service unavailable');
    expect(bare.detail).not.toMatch(/HTTP 503|access engine/i);
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
    expect(toastFor(outage('kubernetes_unavailable', 'down'))[0]).toBe('Kubernetes unreachable');
  });
});

describe('no organisation database', () => {
  const unconfigured = Object.assign(new Error('No organisation database is configured: set ORGANISATION_DATABASE_URL.'), {
    status: 503,
    code: 'organisation_directory_unavailable',
    details: { error: 'organisation_directory_unavailable', reason: 'not_configured', message: 'No organisation database is configured: set ORGANISATION_DATABASE_URL.' },
  });

  it('says organisations are not configured and what to set, with no retry', () => {
    const v = describeApiError(unconfigured);
    expect(v.kind).toBe('unconfigured');
    expect(v.title).toBe("Organisations aren't configured on this deployment");
    expect(v.detail).toContain('ORGANISATION_DATABASE_URL');
    expect(v.retryable).toBe(false);
  });

  it('recognises an older jinbe that says so only in the message', () => {
    expect(orgDirectoryNotConfigured({ status: 503, code: 'Service Unavailable', message: 'No organisation directory is configured.' })).toBe(true);
  });

  it('keeps a database that is down an outage, worth retrying', () => {
    const down = { status: 503, code: 'organisation_directory_unavailable', message: 'The organisation store did not answer: ECONNREFUSED' };
    expect(orgDirectoryNotConfigured(down)).toBe(false);
    const v = describeApiError(down);
    expect(v.kind).toBe('unreachable');
    expect(v.retryable).toBe(true);
  });
});
