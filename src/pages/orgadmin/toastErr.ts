import { stepUpAndAskToRedo } from '../../lib/resume';
import { edgeBlocked, refusalDetail, toastFor } from '../../lib/apiError';

export type PushToast = (msg: string, opts?: { err?: boolean; sub?: string; ttl?: number }) => void;
type ApiErr = Error & { code?: string; status?: number; details?: { hint?: string; code?: string } };

// Map jinbe's refusal codes to friendly toasts (mirrors useApplyChange).
export function makeToastErr(pushToast: PushToast) {
  return (err: unknown) => {
    const e = err as ApiErr;
    if (e.code === 'mfa_required') {
      pushToast('MFA required · target user has no second factor', { err: true, sub: e.details?.hint || e.message });
      return;
    }
    if (e.details?.code === 'grant_exceeds_own') {
      pushToast('Not allowed · that grants what you do not hold', { err: true, sub: e.details?.hint || e.message });
      return;
    }
    // R2 step-up: re-verify a recent second factor, then return to retry.
    if (e.code === 'reauth_required') {
      // The form is gone after the round trip, so the page it comes back to asks for the change again.
      pushToast('Two-factor re-verification required', { err: true, sub: 'Nothing was saved. You will be sent to re-verify your second factor, then back here to make the change again. This is not a sign-out.' });
      stepUpAndAskToRedo('Make the member change again: nothing was saved before the check.');
      return;
    }
    if (e.status === 403 && !edgeBlocked(e)) {
      pushToast('Not authorized for this organization', { err: true, sub: refusalDetail(e) ?? e.message });
      return;
    }
    pushToast(...toastFor(e));
  };
}
