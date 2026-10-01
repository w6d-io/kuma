import { describe, it, expect } from 'vitest';
import { describeApiError, orgDirectoryNotConfigured, permissionRefusal, refusalDetail, toastFor, validationProblems } from './apiError';

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

describe('edge firewall block', () => {
  // What errorFrom throws for a 403 with an empty body — the Coraza WAF on Envoy.
  const waf = () => Object.assign(new Error('Blocked by the web firewall'), { status: 403, edgeBlocked: true, details: {} });

  it('says the firewall blocked it, not a missing role, and warns against retrying', () => {
    const v = describeApiError(waf(), { groups: [] });
    expect(v.kind).toBe('blocked');
    expect(v.title).toBe('Blocked by the web firewall');
    expect(v.detail).toMatch(/Do not retry/);
    expect(v.detail).toMatch(/4 hours/);
    expect(v.detail).not.toMatch(/roles|no groups/);
    expect(v.retryable).toBe(false);
    expect(toastFor(waf())[0]).toBe('Blocked by the web firewall');
  });

  it('keeps the role wording for a jinbe or Oathkeeper 403 that explains itself', () => {
    const jinbe = Object.assign(new Error('Forbidden'), { status: 403, code: 'forbidden', edgeBlocked: false, details: { error: 'forbidden' } });
    expect(describeApiError(jinbe, { groups: ['viewer'] }).detail).toMatch(/Your roles do not include/);
  });
});

describe('permission refusal (jinbe 403 body)', () => {
  // What errorFrom throws for jinbe's require-permission refusal.
  const refused = (body: Record<string, unknown>) =>
    Object.assign(new Error(String(body.message ?? 'Forbidden')), { status: 403, code: 'Forbidden', edgeBlocked: false, details: { error: 'Forbidden', ...body } });

  it('names the permission and the groups that grant it, and nothing else', () => {
    const e = refused({ code: 'permission_required', message: 'This needs users:reset_second_factor.', permission: 'users:reset_second_factor', grantedBy: ['staff-security', 'super_admins'], hint: 'ignored when groups are listed' });
    expect(refusalDetail(e)).toBe('You need users:reset_second_factor. Ask an administrator to add you to one of: staff-security, super_admins.');
    const v = describeApiError(e, { groups: [] });
    expect(v).toMatchObject({ kind: 'forbidden', title: 'Access denied', retryable: false });
    expect(v.detail).not.toMatch(/no groups/);
    expect(toastFor(e)).toEqual(['Access denied', { err: true, sub: refusalDetail(e) }]);
  });

  it('lists several missing permissions, says * in words, and falls back to the hint without groups', () => {
    expect(refusalDetail(refused({ code: 'grant_exceeds_own', missing: ['a:read', 'b:write', 'c:list'], grantedBy: ['ops'] })))
      .toBe('This grants what you do not hold. You need a:read, b:write and c:list. Ask an administrator to add you to one of: ops.');
    expect(refusalDetail(refused({ permission: '*', grantedBy: [], hint: 'No group grants this on its own; ask a super admin.' })))
      .toBe('You need full platform access (super admin). No group grants this on its own; ask a super admin.');
    expect(refusalDetail(refused({ permission: 'x:y', grantedBy: [] }))).toBe('You need x:y. Ask an administrator for it.');
  });

  it('is not a refusal on an older body, another status, or garbage', () => {
    expect(permissionRefusal(refused({}))).toBeNull();
    expect(permissionRefusal(Object.assign(new Error('x'), { status: 422, details: { permission: 'a' } }))).toBeNull();
    expect(permissionRefusal(refused({ permission: 3, grantedBy: 'x' }))).toBeNull();
    expect(permissionRefusal(refused({ missing: ['a', 4, ''], grantedBy: [1, 'g'] }))).toEqual({ code: undefined, permissions: ['a'], grantedBy: ['g'], hint: undefined });
  });
});

describe('validation refusals (400/422)', () => {
  const bad = (status: number, body: Record<string, unknown>) =>
    Object.assign(new Error(String(body.message ?? body.error)), { status, code: body.error, details: body });

  it('names the refused field from the Zod handler\'s details', () => {
    const e = bad(400, { error: 'Validation failed', details: [{ path: 'services.0', message: 'Invalid' }] });
    expect(toastFor(e)).toEqual(['Some values were not accepted', { err: true, sub: 'services.0: Invalid' }]);
  });

  it('lets the screen say which value a path is', () => {
    const e = bad(400, { error: 'Validation failed', details: [{ path: 'services.1', message: 'Invalid' }] });
    const picked = ['echo', 'echo-mfa'];
    const field = (f: string) => { const m = /^services\.(\d+)$/.exec(f); return m ? `Site ${picked[Number(m[1])]}` : undefined; };
    expect(toastFor(e, { field })[1].sub).toBe('Site echo-mfa: Invalid');
  });

  it('reads Zod issues, settings problems and bundle failures alike', () => {
    expect(validationProblems(bad(400, { error: 'invalid_request', issues: [{ path: ['spec', 'hosts', 0], message: 'Required' }] })))
      .toEqual([{ field: 'spec.hosts.0', message: 'Required' }]);
    expect(validationProblems(bad(400, { error: 'invalid_settings', problems: [{ field: 'serverUrl', message: 'https only' }] })))
      .toEqual([{ field: 'serverUrl', message: 'https only' }]);
    expect(validationProblems(bad(422, { error: 'invalid_binding', problems: ['ops: global has no roles'] })))
      .toEqual([{ field: '', message: 'ops: global has no roles' }]);
    expect(validationProblems(bad(400, { error: 'Bad Request', failures: [{ id: 'r1', reason: 'no permission' }] })))
      .toEqual([{ field: 'r1', message: 'no permission' }]);
  });

  it('shows four, then how many more', () => {
    const details = Array.from({ length: 6 }, (_, i) => ({ path: `services.${i}`, message: 'Invalid' }));
    expect(describeApiError(bad(400, { error: 'Validation failed', details })).detail).toMatch(/services\.3: Invalid · and 2 more$/);
  });

  it('keeps a bare 400 to its message', () => {
    expect(toastFor(err(400, 'Say why.'))).toEqual(['Say why.', { err: true }]);
  });
});
