import { useApp } from '../contexts/AppContext';

export function useApplyChange() {
  const { pushToast, pipeline, persona, refreshAudit } = useApp();

  // `verb` is retained in the signature for call-site readability and future
  // per-verb handling; the audit record itself comes from jinbe, not the client.
  return (_verb: string, target: string, mutator?: () => void | Promise<void>) => {
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
        })
        .catch((err: Error & { code?: string; status?: number; details?: { hint?: string } }) => {
          // Special-case the MFA gate so the toast tells the operator what
          // to do instead of dumping the raw error string.
          if (err.code === 'mfa_required') {
            pushToast(
              'MFA required · target user has no second factor',
              { err: true, sub: err.details?.hint || err.message },
            );
            return;
          }
          if (err.code === 'privilege_escalation_blocked') {
            pushToast(
              'Privilege escalation blocked · super_admin required',
              { err: true, sub: err.details?.hint || err.message },
            );
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
