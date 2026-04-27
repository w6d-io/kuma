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
          pipeline.run(target);
          appendAudit(verb, target, setAudit);
          if (isLive) refetch();
        })
        .catch((err: Error) => {
          pushToast(`Failed: ${err.message}`, { err: true });
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
