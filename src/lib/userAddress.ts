import type { KratosIdentity } from '../api/client';
import type { EmailChange } from '../api/accounts';
import { EDGE_BLOCKED, edgeBlocked } from './apiError';

/**
 * What the address change and the verification resend can answer, in the words the drawer shows.
 * Kept apart from the dialogs so every outcome is decided (and tested) in one place, as
 * lib/recovery.ts does for the sign-in link.
 */

type ApiError = { status?: number; code?: string; message?: string; retryAfter?: number };

/** The step-up handed back to the drawer: the address to propose again, never to write unasked. */
export const emailResumeAction = (userId: string) => `user-email:${userId}`;
export type EmailResume = { email: string };

/** The Kratos settings that make verification send a link rather than a bare code. */
export const VERIFICATION_LINK_SETTINGS = [
  'selfservice.flows.verification.use: link',
  'selfservice.methods.link.enabled: true',
] as const;

/**
 * The sign-in address and whether its owner confirmed it, from Kratos' own record. Null when nothing
 * says (an older jinbe, or a schema that does not verify the address): the screen shows nothing
 * rather than guess.
 */
export function signInAddress(identity: KratosIdentity | undefined): { value: string; verified: boolean } | null {
  const email = identity?.traits.email;
  if (!email || !identity?.verifiable_addresses) return null;
  const found = identity.verifiable_addresses.find(a => a.value.trim().toLowerCase() === email.trim().toLowerCase());
  return found ? { value: email, verified: found.verified } : null;
}

/**
 * Why a change was refused. `field` puts it under the address (choose another); `stepUp` offers to
 * confirm the caller's own second factor and come back.
 */
export type EmailChangeFailure = { title: string; detail: string; field?: boolean; stepUp?: boolean };

export function emailChangeFailure(err: unknown): EmailChangeFailure {
  const e = (err ?? {}) as ApiError;
  switch (e.code) {
    case 'reauth_required':
      return {
        title: 'Confirm your own second factor first',
        detail: 'Changing somebody\'s sign-in address needs yours proven in the last 15 minutes. Nothing was changed.',
        stepUp: true,
      };
    case 'step_up_unavailable':
      return { title: 'Not possible with this sign-in', detail: 'Sign in to the console in a browser and try again there.' };
    // Generic on purpose: jinbe does not say whether the address belongs to somebody.
    case 'address_unavailable':
      return { title: 'Address not available', detail: 'This address cannot be used. Choose another one.', field: true };
    case 'address_unchanged':
      return { title: 'Same address', detail: 'That is already their address.', field: true };
    case 'invalid_address':
      return { title: 'Not accepted', detail: 'The identity schema refused this address.', field: true };
    case 'own_address':
      return { title: 'Not your own', detail: 'Change your own address from your account settings.' };
    case 'outranked':
      return { title: 'They hold more than you', detail: e.message ?? 'Only somebody holding their administrative rights can change their address.' };
    case 'no_address':
      return { title: 'No address to change', detail: e.message ?? 'This account has no sign-in address.' };
  }
  if (edgeBlocked(err)) return { title: EDGE_BLOCKED.title, detail: EDGE_BLOCKED.detail };
  if (e.status === 403) return { title: 'Access denied', detail: 'This needs users:update_email (admin:write).' };
  if (e.status === 404) return { title: 'Not found', detail: 'This account no longer exists.' };
  return { title: 'The address was not changed', detail: e.message || 'The request failed.' };
}

/** What the answer to a change means for the new address and the old one, one line each. */
export function emailChangeResult(r: EmailChange): { verification: string; verificationTone: 'success' | 'warning'; notice: string } {
  const verification = r.verificationSent
    ? `A link to confirm it went to ${r.email}. Until they use it the address shows as unverified.`
    : r.verificationError === 'verification_link_unavailable'
      ? 'No confirmation link was sent: Kratos verifies addresses by code only. Set it to send links, then use Resend verification email.'
      : 'The confirmation link could not be sent. Use Resend verification email.';
  const notice = r.oldAddressNotice?.recorded
    ? 'The change is recorded in the audit trail as a notice owed to the old address. No email goes to it from here.'
    : 'The notice owed to the old address could not be recorded. Tell them by another channel.';
  return { verification, verificationTone: r.verificationSent ? 'success' : 'warning', notice };
}

export type VerificationOutcome =
  | { kind: 'sent' }
  | { kind: 'rate_limited'; retryAfterSeconds: number | null; you: boolean }
  | { kind: 'already_verified' }
  | { kind: 'unavailable' }
  | { kind: 'unknown_address' }
  | { kind: 'failed'; message: string };

/** The outcome of a failed resend, from jinbe's answer (routes/user-address.routes.ts). */
export function verificationFailure(err: unknown): VerificationOutcome {
  const e = (err ?? {}) as ApiError;
  // The per-caller limit (30 an hour) says "You sent"; the per-person one (3 in 15 minutes) does not.
  if (e.status === 429) return { kind: 'rate_limited', retryAfterSeconds: e.retryAfter ?? null, you: /^You /.test(e.message ?? '') };
  if (e.code === 'already_verified') return { kind: 'already_verified' };
  if (e.code === 'verification_link_unavailable') return { kind: 'unavailable' };
  if (e.code === 'unknown_address') return { kind: 'unknown_address' };
  if (edgeBlocked(err)) return { kind: 'failed', message: EDGE_BLOCKED.detail };
  if (e.status === 403) return { kind: 'failed', message: 'This needs users:verify (admin:write).' };
  return { kind: 'failed', message: e.message || 'The link could not be sent.' };
}
