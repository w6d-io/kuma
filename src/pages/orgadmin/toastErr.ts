import { bounceToStepUp } from '../../lib/stepUp';
import { toastFor } from '../../lib/apiError';

export type PushToast = (msg: string, opts?: { err?: boolean; sub?: string; ttl?: number }) => void;
type ApiErr = Error & { code?: string; status?: number; details?: { hint?: string } };

// Map jinbe's delegation error codes to friendly toasts (mirrors useApplyChange).
export function makeToastErr(pushToast: PushToast) {
  return (err: unknown) => {
    const e = err as ApiErr;
    if (e.code === 'mfa_required') {
      pushToast('MFA required · target user has no second factor', { err: true, sub: e.details?.hint || e.message });
      return;
    }
    if (e.code === 'privilege_escalation_blocked') {
      pushToast('Not allowed · that group is outside your delegation', { err: true, sub: e.details?.hint || e.message });
      return;
    }
    // R2 step-up: re-verify a recent second factor, then return to retry.
    if (e.code === 'reauth_required') {
      pushToast('Two-factor re-verification required', { err: true, sub: 'You will be sent to re-verify your second factor, then back here to retry. This is not a sign-out.' });
      bounceToStepUp();
      return;
    }
    if (e.status === 403) {
      pushToast('Not authorized for this organization', { err: true, sub: e.message });
      return;
    }
    pushToast(...toastFor(e));
  };
}
