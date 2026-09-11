import { useApp } from '../contexts/AppContext';
import { bounceToStepUp } from '../lib/stepUp';
import { rememberPendingChange, type PendingIntent } from '../lib/pendingChange';

export function useApplyChange() {
  const { pushToast, pipeline, persona, refreshAudit } = useApp();

  // `verb` is retained in the signature for call-site readability and future
  // per-verb handling; the audit record itself comes from jinbe, not the client.
  // `resume` describes the change in a form that survives a full page load. Given, a step-up
  // refusal comes back proposing it again instead of costing the operator their selection.
  return (
    _verb: string,
    target: string,
    mutator?: () => void | Promise<void>,
    resume?: PendingIntent,
    // Runs ONLY when the write actually landed. A caller that closes its editor on the synchronous
    // return closes it on refusals too, and the operator loses what they had selected.
    onApplied?: () => void,
  ) => {
    if (persona === "viewer") {
      pushToast("Read-only persona · change blocked", { err: true });
      return false;
    }

    const result = mutator?.();

    if (result instanceof Promise) {
      // Async API call. jinbe records the authoritative audit event for every
      // RBAC mutation (rbac.service invalidateBundle → auditEventService.emit),
      // so a scoped refetch surfaces the real row — we never synthesize a fake
      // "applied" entry (UX-1). The pipeline animation fires only on real
      // success.
      result
        .then(() => {
          pipeline.run(target);
          refreshAudit();
          onApplied?.();
        })
        .catch((err: Error & { code?: string; status?: number; applied?: boolean; details?: { hint?: string } }) => {
          // A refusal leaves BOTH stores untouched — every gate runs before the first write, and the
          // service says so in `applied: false`. Without that said out loud, an operator returning
          // from a step-up sees the previous state and reads it as "some of it went through".
          const nothingApplied = err.applied === false
            ? ' Nothing was applied — the change was refused in full.'
            : '';
          // Special-case the MFA gate so the toast tells the operator what
          // to do instead of dumping the raw error string.
          if (err.code === 'mfa_required') {
            pushToast(
              'MFA required · target user has no second factor',
              { err: true, sub: (err.details?.hint || err.message) + nothingApplied },
            );
            return;
          }
          if (err.code === 'privilege_escalation_blocked') {
            pushToast(
              'Privilege escalation blocked · needs admin.membership:write',
              { err: true, sub: (err.details?.hint || err.message) + nothingApplied },
            );
            return;
          }
          // R2 step-up: the actor's second factor is absent or older than the
          // 15-minute window. Bounce through Kratos AAL2 re-verification and
          // return here so the operator can retry the change.
          // A refusal no re-verification can lift: the credential in play carries no second factor
          // this service reads. Offering the bounce here would loop with no exit.
          if (err.code === 'step_up_unavailable') {
            pushToast(
              'Second factor required · not available on this credential',
              { err: true, sub: `${err.details?.hint || err.message}${nothingApplied}` },
            );
            return;
          }
          if (err.code === 'reauth_required') {
            pushToast(
              'Two-factor re-verification required',
              { err: true, sub: `You will be sent to re-verify your second factor, then back here to retry. This is not a sign-out. ${nothingApplied}`.trim() },
            );
            if (resume) rememberPendingChange(resume);
            bounceToStepUp();
            return;
          }
          if (err.status === 404) {
            pushToast(
              'User not found',
              { err: true, sub: err.message },
            );
            return;
          }
          pushToast(`${err.message}`, { err: true });
        });
    } else {
      // Sync mutator (rare — a few UI-only paths). Just run the pipeline echo.
      pipeline.run(target);
    }

    return true;
  };
}
