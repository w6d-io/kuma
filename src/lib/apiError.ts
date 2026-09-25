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

export function describeApiError(err: unknown, ctx: { groups?: string[] } = {}): ApiErrorView {
  const status = statusOf(err);
  if (status === 503) {
    return {
      kind: 'unreachable',
      title: 'Engine unreachable',
      detail: 'The access engine did not answer, so nothing could be checked. This is an outage, not a missing permission.',
      retryable: true,
    };
  }
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
