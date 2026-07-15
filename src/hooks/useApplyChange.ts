import { useApp } from '../contexts/AppContext';
import type { AuditEvent } from '../api/types';

export function useApplyChange() {
  const { pushToast, pipeline, setAudit, persona, isLive, refetch } = useApp();

  return (verb: string, target: string, mutator?: () => void | Promise<void>) => {
    if (persona === "viewer") {
      pushToast("Read-only persona · change blocked", { err: true });
      return false;
    }

    const result = mutator?.();

    if (result instanceof Promise) {
      // Async API call
      result
        .then(() => {
          // Live path: jinbe records the real audit event for every RBAC
          // mutation (rbac.service invalidateBundle → auditEventService.emit),
          // so refetch surfaces the authoritative row. Do NOT synthesize a
          // fake "applied" audit entry here — it lied about the backend result
          // (always "applied", fake id, who="you@console") even when jinbe
          // recorded something else (UX-1). The pipeline animation fires only
          // now, on real success.
          pipeline.run(target);
          if (isLive) refetch();
          else appendAudit(verb, target, setAudit);
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
      // Sync local state mutation
      pipeline.run(target);
      appendAudit(verb, target, setAudit);
    }

    return true;
  };
}

function appendAudit(
  verb: string,
  target: string,
  setAudit: React.Dispatch<React.SetStateAction<AuditEvent[]>>
) {
  const entry: AuditEvent = {
    id: "c_" + Math.floor(100 + Math.random() * 900),
    when: "just now",
    ts: new Date().toISOString().replace('T', ' ').slice(0, 19),
    who: "you@console",
    verb,
    target,
    status: "applied",
    category: "rbac",
  };
  setAudit(a => [entry, ...a]);
}
