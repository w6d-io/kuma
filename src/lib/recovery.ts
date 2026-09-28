import type { SecondFactorMethod } from '../api/recovery';
import { EDGE_BLOCKED, edgeBlocked } from './apiError';

/**
 * What the sign-in link and the two-step removal can answer, in the words the drawer shows.
 * Kept apart from the dialogs so every outcome is decided (and tested) in one place.
 */

/**
 * How long the link works: Kratos' `selfservice.methods.link.config.lifespan`, 1h by default and
 * not overridden by the chart. After sending, the dialog shows the real end jinbe answers with.
 */
export const LINK_LIFESPAN = 'an hour';

/** The Kratos settings that make recovery send a link rather than a bare code. */
export const LINK_RECOVERY_SETTINGS = [
  'selfservice.flows.recovery.use: link',
  'selfservice.methods.link.enabled: true',
] as const;

/**
 * Where the link leaves them once they are in: the sign-in site's two-step gate, with no onward
 * address so it ends on its own "where to?" page. Kratos opens their account settings first; the
 * gate afterwards has an account that must use two-step sign-in set a factor up (or prove it) before
 * going anywhere — the step a sign-in link alone would skip, since it only proves the mailbox.
 */
export function linkReturnTo(): string | undefined {
  const authDomain = (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__;
  return authDomain ? `https://${authDomain}/two-step` : undefined;
}

export const FACTOR_LABELS: Record<SecondFactorMethod, string> = {
  totp: 'Authenticator app',
  webauthn: 'Security keys',
  lookup_secret: 'Backup codes',
};

export function factorList(methods: readonly SecondFactorMethod[]): string {
  return methods.map(m => FACTOR_LABELS[m] ?? m).join(', ');
}

type ApiError = { status?: number; code?: string; message?: string; retryAfter?: number };

export type LinkOutcome =
  | { kind: 'sent'; expiresAt: string | null }
  | { kind: 'rate_limited'; retryAfterSeconds: number | null }
  | { kind: 'unavailable' }
  | { kind: 'no_address' }
  | { kind: 'return_to_refused' }
  | { kind: 'failed'; message: string };

/** The outcome of a failed send, from jinbe's answer (routes/user-management.routes.ts). */
export function linkFailure(err: unknown): LinkOutcome {
  const e = (err ?? {}) as ApiError;
  if (e.status === 429) return { kind: 'rate_limited', retryAfterSeconds: e.retryAfter ?? null };
  if (e.status === 409 && e.code === 'login_link_unavailable') return { kind: 'unavailable' };
  if (e.status === 422) return { kind: 'no_address' };
  if (e.status === 400 && /return_to/.test(e.message ?? '')) return { kind: 'return_to_refused' };
  return { kind: 'failed', message: e.message || 'The link could not be sent.' };
}

/** "10 minutes", "45 seconds" — how long until the limit lets another link through. */
export function formatWait(seconds: number | null): string {
  if (!seconds || seconds <= 0) return 'a few minutes';
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Why a removal was refused, when jinbe says something the generic error text would blur. */
export function resetFailure(err: unknown): { title: string; detail: string; stepUp?: boolean } {
  const e = (err ?? {}) as ApiError;
  switch (e.code) {
    case 'reauth_required':
      return {
        title: 'Confirm your own second factor first',
        detail: 'Removing somebody\'s two-step sign-in needs yours proven in the last 15 minutes. You will be sent to confirm it, then back here.',
        stepUp: true,
      };
    case 'step_up_unavailable':
      return { title: 'Not possible with this sign-in', detail: 'Sign in to the console in a browser and try again there.' };
    case 'own_second_factor':
      return { title: 'Not your own', detail: 'Remove your own two-step sign-in from your account settings.' };
    case 'outranked':
      return { title: 'They hold more than you', detail: e.message ?? 'Only somebody holding their administrative rights can do this.' };
    case 'no_second_factor':
      return { title: 'Nothing to remove', detail: 'They have no two-step sign-in any more.' };
    case 'reset_incomplete':
      return { title: 'Stopped part-way', detail: `${e.message ?? 'Kratos refused part of the removal.'} Check their sign-in methods and try again.` };
  }
  if (edgeBlocked(err)) return { title: EDGE_BLOCKED.title, detail: EDGE_BLOCKED.detail };
  if (e.status === 403) return { title: 'Access denied', detail: 'This needs users:reset_second_factor (admin:write).' };
  return { title: 'Could not remove it', detail: e.message || 'The request failed.' };
}
