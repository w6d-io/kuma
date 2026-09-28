/**
 * What a failed request means to the person looking at the screen, decided in one place.
 *
 * Pages used to phrase their own failures, so a 403 said "Your account has no groups assigned" to
 * somebody holding three, and a 503 — the service could not work out what the caller holds — read
 * as a permission problem somebody would go and ask about. jinbe keeps the two apart on purpose
 * (see its require-admin middleware): 403 is a decision, 503 is an outage.
 */
export type ApiErrorKind = 'forbidden' | 'unreachable' | 'expired' | 'not-found' | 'failed';

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

function unavailable(err: unknown): ApiErrorView {
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

export function describeApiError(err: unknown, ctx: { groups?: string[] } = {}): ApiErrorView {
  const status = statusOf(err);
  // An account that must use two-step sign-in, below aal2 (jinbe second-factor/gate.ts). The client
  // is already sending the person to the sign-in site's two-step gate (api/client.ts).
  if ((err as { code?: unknown } | null | undefined)?.code === 'second_factor_required') {
    return {
      kind: 'expired',
      title: 'Two-step sign-in required',
      detail: 'Your account has to use two-step sign-in. You are being taken to set it up or confirm it, then back here.',
      retryable: false,
    };
  }
  if (status === 503) return unavailable(err);
  if (status === 401) {
    return { kind: 'expired', title: 'Session expired', detail: 'Sign in again to continue.', retryable: false };
  }
  if (status === 403) {
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
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return {
    kind: 'failed',
    title: 'Could not load',
    detail: typeof message === 'string' && message ? message : 'The request failed.',
    retryable: true,
  };
}

/** The same wording, shaped for a toast: the title as the message, the detail underneath. */
export function toastFor(err: unknown, ctx: { groups?: string[] } = {}): [string, { err: true; sub?: string }] {
  const v = describeApiError(err, ctx);
  if (v.kind === 'failed') return [v.detail, { err: true }];
  return [v.title, { err: true, sub: v.detail }];
}
