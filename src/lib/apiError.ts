/**
 * What a failed request means to the person looking at the screen, decided in one place.
 *
 * Pages used to phrase their own failures, so a 403 said "Your account has no groups assigned" to
 * somebody holding three, and a 503 — the service could not work out what the caller holds — read
 * as a permission problem somebody would go and ask about. jinbe keeps the two apart on purpose
 * (see its require-admin middleware): 403 is a decision, 503 is an outage.
 */
import { secondFactorRefusalSentence } from './twoFactor';

export type ApiErrorKind = 'forbidden' | 'blocked' | 'unreachable' | 'unconfigured' | 'expired' | 'not-found' | 'invalid' | 'failed';

export interface ApiErrorView {
  kind: ApiErrorKind;
  title: string;
  detail: string;
  /** Worth offering a Retry: trying again can change the answer. */
  retryable: boolean;
}

export function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null | undefined)?.status;
  return typeof s === 'number' ? s : undefined;
}

/**
 * What each outage jinbe names in a 503 body (`{error: <code>, message}`) means. Only the OPA codes
 * blame the access engine: a Kubernetes or Loki outage read as "access engine" sent people to the
 * wrong team. Without `detail`, the server's message is the detail — it is already precise.
 */
const ENGINE = {
  title: 'Access engine unreachable',
  detail: 'The access engine (OPA) did not answer, so nothing could be checked. This is an outage, not a missing permission.',
};
const OUTAGES: Record<string, { title: string; detail?: string }> = {
  // sites/mine.ts: OPA could not say which sites the caller holds.
  policy_unavailable: ENGINE,
  // sites/kube-sites.ts KubeUnavailable — Site CRs, zones, the gateway.
  kubernetes_unavailable: { title: 'Kubernetes unreachable', detail: 'The Kubernetes API did not answer, so nothing was changed.' },
  // sites/gatekit.client.ts GatekitUnavailable — preview and apply compile every rule first.
  checks_unavailable: { title: 'Rule checks unavailable', detail: 'gatekit, which checks every gateway rule before it is written, did not answer, so nothing was changed.' },
  // sites/apply.service.ts: permissions went out, the gateway rules did not.
  rules_pending: { title: 'Gateway rules not written' },
  // audit/query: Loki refused or timed out.
  audit_store_unavailable: { title: 'Audit log unreachable', detail: 'Loki, where audit events are kept, did not answer. Nothing is lost — it could not be read right now.' },
  // routes/observability: Tempo.
  trace_store_unavailable: { title: 'Traces unreachable', detail: 'Tempo, where request traces are kept, did not answer.' },
  // services/user-groups.service.ts: the group catalogue (Redis) could not be read.
  authorization_model_unavailable: { title: 'Group catalogue unreachable' },
  // middleware/error-handler.ts KratosApiError ≥ 500.
  'Identity service unavailable': { title: 'Identity service unreachable', detail: 'Kratos, which holds accounts and sign-in, did not answer.' },
  // routes/auth-config.routes.ts: the Kratos config file.
  KratosConfigError: { title: 'Sign-in settings unavailable' },
};
// The authorization guards answer a bare `Service Unavailable` and say OPA only in the message.
const ENGINE_MESSAGE = /verify authorization|\bOPA\b/;
const BARE = /^(Service Unavailable|HTTP 503)$/;

/**
 * jinbe has no organisation database at all (`organisation_directory_unavailable`, reason
 * `not_configured`; older builds say so only in the message). Set-up, not an outage: retrying never
 * helps, and the reader needs to know what to set.
 */
export function orgDirectoryNotConfigured(err: unknown): boolean {
  if (statusOf(err) !== 503) return false;
  const e = (err ?? {}) as { code?: unknown; message?: unknown; details?: { reason?: unknown; message?: unknown } };
  if (e.details?.reason === 'not_configured') return true;
  const said = [e.message, e.details?.message].filter((m): m is string => typeof m === 'string').join(' ');
  return /No organisation (database|directory) is configured/i.test(said);
}

export const ORGS_NOT_CONFIGURED: ApiErrorView = {
  kind: 'unconfigured',
  title: "Organisations aren't configured on this deployment",
  detail:
    'jinbe keeps organisations in a Postgres database and has none. Set ORGANISATION_DATABASE_URL on jinbe ' +
    '(a postgres:// connection string, with ORGANISATION_DATABASE_CA for a private certificate authority), or ' +
    'ORGANISATION_SOURCE=claim to take organisations from the sign-in token. Everything else works without it.',
  retryable: false,
};

function unavailable(err: unknown): ApiErrorView {
  if (orgDirectoryNotConfigured(err)) return ORGS_NOT_CONFIGURED;
  const e = (err ?? {}) as { code?: unknown; message?: unknown; details?: { error?: unknown } };
  const code = typeof e.code === 'string' ? e.code : typeof e.details?.error === 'string' ? e.details.error : undefined;
  // What the server said in words: its message, or a sentence sent as the `error` itself (the
  // generic handler does that) — never a bare "Service Unavailable" or "HTTP 503".
  const known = code && Object.hasOwn(OUTAGES, code) ? OUTAGES[code] : undefined;
  const said = [e.message, code].find((m): m is string => typeof m === 'string' && !!m && !BARE.test(m) && !(m === code && known));
  const view = known ?? (said && ENGINE_MESSAGE.test(said) ? ENGINE : undefined);
  return {
    kind: 'unreachable',
    title: view?.title ?? 'Service unavailable',
    detail: view?.detail ?? said ?? 'A service this needs did not answer. Try again in a moment.',
    retryable: true,
  };
}

/**
 * A 403 from the edge WAF (Coraza on Envoy), which answers with no body at all — jinbe and
 * Oathkeeper always explain theirs (api/client.ts errorFrom). Not a role problem, and not worth a retry:
 * CrowdSec bans an address that keeps getting blocked.
 */
export function edgeBlocked(err: unknown): boolean {
  return statusOf(err) === 403 && (err as { edgeBlocked?: unknown }).edgeBlocked === true;
}

export const EDGE_BLOCKED: ApiErrorView = {
  kind: 'blocked',
  title: 'Blocked by the web firewall',
  detail:
    'The web application firewall stopped this request before it reached the service — something in it looked like an attack. ' +
    'Do not retry: repeated blocks get your IP address banned for 4 hours. Change what you sent, or ask an administrator to look at the firewall log.',
  retryable: false,
};

/**
 * What a 403 for a missing permission carries besides "no" (jinbe services/permission-refusal.ts):
 * `permission` for one, `missing` for several, `grantedBy` — the groups whose roles give it, names
 * only — and `hint`, jinbe's own sentence for who to ask. Read off the body, not the error's `code`
 * (the client keeps `error` there, which is "Forbidden" on these). Null on any other refusal.
 */
export interface PermissionRefusal {
  code?: string;
  permissions: string[];
  grantedBy: string[];
  hint?: string;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []);

export function permissionRefusal(err: unknown): PermissionRefusal | null {
  if (statusOf(err) !== 403) return null;
  const d = (err as { details?: Record<string, unknown> } | null)?.details;
  if (!d || typeof d !== 'object') return null;
  const permissions = typeof d.permission === 'string' && d.permission ? [d.permission] : strings(d.missing);
  if (permissions.length === 0 && !Array.isArray(d.grantedBy)) return null;
  return {
    code: typeof d.code === 'string' ? d.code : undefined,
    permissions,
    grantedBy: strings(d.grantedBy),
    hint: typeof d.hint === 'string' && d.hint ? d.hint : undefined,
  };
}

/** `*` is every permission at once — said as what it is, not as a symbol. */
const permissionWords = (p: string) => (p === '*' ? 'full platform access (super admin)' : p);

function listWords(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/**
 * The sentence for a permission refusal: "You need <permission>. Ask an administrator to add you to
 * one of: <groups>." Without groups, jinbe's hint says who to ask (nobody short of a super admin, or
 * it could not tell). Null when the refusal names nothing to act on.
 */
export function refusalDetail(err: unknown): string | null {
  const r = permissionRefusal(err);
  if (!r) return null;
  const need = r.permissions.length ? `You need ${listWords(r.permissions.map(permissionWords))}.` : '';
  const exceeding = r.code === 'grant_exceeds_own' ? 'This grants what you do not hold. ' : '';
  const who = r.grantedBy.length
    ? `Ask an administrator to add you to one of: ${r.grantedBy.join(', ')}.`
    : r.hint ?? 'Ask an administrator for it.';
  return `${exceeding}${need} ${who}`.trim();
}

/** One value the service refused, and why: "services.3" / "Invalid". */
export interface FieldProblem {
  field: string;
  message: string;
}

/**
 * The field-level reasons a 400/422 carries, whichever way the route spells them: the Zod handler's
 * `details: [{path, message}]` (path dotted), the sites and gateway routes' `issues` (Zod issues,
 * path an array), the settings routes' `problems: [{field, message}]` (or plain sentences), and a
 * bundle import's `failures: [{id, reason}]` — one of them, never the same refusal twice. Without
 * these the toast read "Validation failed" and nothing else, and the person could only guess which
 * value was wrong.
 */
export function validationProblems(err: unknown): FieldProblem[] {
  const status = statusOf(err);
  if (status !== 400 && status !== 422) return [];
  const body = (err as { details?: Record<string, unknown> } | null)?.details;
  if (!body || typeof body !== 'object') return [];
  const out: FieldProblem[] = [];
  const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
  const path = (v: unknown) => (Array.isArray(v) ? v.map(text).filter(Boolean).join('.') : text(v));
  // The first list that says something: the sites routes send details[] and Zod's issues[] side by side.
  for (const list of [body.details, body.issues, body.problems, body.failures]) {
    if (!Array.isArray(list) || out.length) continue;
    for (const p of list) {
      if (typeof p === 'string' && p) { out.push({ field: '', message: p }); continue; }
      if (!p || typeof p !== 'object') continue;
      const r = p as Record<string, unknown>;
      const message = text(r.message) || text(r.reason);
      if (message) out.push({ field: path(r.path ?? r.field ?? r.id), message });
    }
  }
  return out;
}

const SHOWN_PROBLEMS = 4;

/**
 * "services.3: Invalid · name: Required", at most four, then how many more. `label` renames a
 * field for the screen that knows what it holds (services.3 → the site picked fourth).
 */
export function problemsSentence(problems: FieldProblem[], label?: (field: string) => string | undefined): string {
  const said = problems.slice(0, SHOWN_PROBLEMS).map(({ field, message }) => {
    const name = (field && label?.(field)) || field;
    return name ? `${name}: ${message}` : message;
  });
  const more = problems.length - SHOWN_PROBLEMS;
  return more > 0 ? `${said.join(' · ')} · and ${more} more` : said.join(' · ');
}

export interface ApiErrorContext {
  groups?: string[];
  /** Names a refused field the way the screen shows it; the dotted path when it returns nothing. */
  field?: (field: string) => string | undefined;
}

export function describeApiError(err: unknown, ctx: ApiErrorContext = {}): ApiErrorView {
  const status = statusOf(err);
  // An account that must use two-step sign-in, below aal2 (jinbe second-factor/gate.ts). The client
  // is already sending the person to the sign-in site's two-step gate (api/client.ts).
  const code = (err as { code?: unknown } | null | undefined)?.code;
  // Which second-factor rule refused, when jinbe names it (second-factor/requirements.ts): the groups
  // that make it mandatory, the permission that needs a recent one, the site that asks for it.
  const rule = secondFactorRefusalSentence(err);
  if (code === 'second_factor_required') {
    return {
      kind: 'expired',
      title: 'Two-step sign-in required',
      detail: rule
        ? `${rule} You are being taken to set it up or confirm it, then back here.`
        : 'Your account has to use two-step sign-in. You are being taken to set it up or confirm it, then back here.',
      retryable: false,
    };
  }
  if (rule) return { kind: 'forbidden', title: 'Two-step sign-in needed', detail: rule, retryable: false };
  if (code === 'mfa_required') {
    return {
      kind: 'forbidden',
      title: 'Second factor not enrolled',
      detail: 'This person must enrol a second factor before being added to a group whose members must use two-step sign-in.',
      retryable: false,
    };
  }
  if (status === 503) return unavailable(err);
  if (status === 401) {
    return { kind: 'expired', title: 'Session expired', detail: 'Sign in again to continue.', retryable: false };
  }
  if (edgeBlocked(err)) return EDGE_BLOCKED;
  if (status === 403) {
    const refusal = refusalDetail(err);
    if (refusal) return { kind: 'forbidden', title: 'Access denied', detail: refusal, retryable: false };
    // Only claim "no groups" when the session says so. Anybody else holds something — just not
    // what this screen needs.
    const none = ctx.groups !== undefined && ctx.groups.length === 0;
    return {
      kind: 'forbidden',
      title: 'Access denied',
      detail: none
        ? 'Your account has no groups assigned — contact an administrator.'
        : 'Your roles do not include what this needs. Ask an administrator if you should have it.',
      retryable: false,
    };
  }
  if (status === 404) {
    return { kind: 'not-found', title: 'Not found', detail: 'It may have been removed.', retryable: false };
  }
  const problems = validationProblems(err);
  if (problems.length) {
    return { kind: 'invalid', title: 'Some values were not accepted', detail: problemsSentence(problems, ctx.field), retryable: false };
  }
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return {
    kind: 'failed',
    title: 'Could not load',
    detail: typeof message === 'string' && message ? message : 'The request failed.',
    retryable: true,
  };
}

/** The same wording, shaped for a toast: the title as the message, the detail underneath. */
export function toastFor(err: unknown, ctx: ApiErrorContext = {}): [string, { err: true; sub?: string }] {
  const v = describeApiError(err, ctx);
  if (v.kind === 'failed') return [v.detail, { err: true }];
  return [v.title, { err: true, sub: v.detail }];
}
