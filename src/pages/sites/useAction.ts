import { useCallback, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { notAvailable, type SiteError } from '../../api/sites';
import { bounceToStepUp } from '../../lib/stepUp';

/**
 * Run a gateway-changing action (apply, rollback, pause, delete…) with the site-ux §10.7 wording for
 * its failures: a missing second factor sends the operator to prove it and come back; a route the
 * server does not have yet says so; anything else is the server's own sentence.
 */
export function describeSiteError(err: unknown): string {
  const e = err as SiteError;
  if (notAvailable(err)) return 'Not available on this server yet.';
  switch (e.code) {
    case 'reauth_required': return 'Confirm it’s you to apply changes.';
    case 'step_up_unavailable': return 'This needs a second factor proven in a browser session.';
    case 'stale_version':
    case 'conflict':
    case 'version_mismatch': return 'Someone saved a newer version while you were editing. Reload and rebase your draft.';
    case 'checks_failed': return `Checks refused it: ${e.message}`;
    case 'invalid_site': return 'This version cannot be saved as it is — see the checks.';
    case 'rules_pending': return e.message;
    case 'system_site': return 'System sites are managed by the platform chart.';
  }
  if (e.status === 503) return 'Checks are unavailable (gatekit or Kubernetes did not answer), so nothing was changed.';
  if (e.status === 403) return 'Your roles do not allow this. Changing what the gateway serves needs a super admin.';
  return e.message || 'The request failed.';
}

export function useSiteAction() {
  const { pushToast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(label);
    try {
      const out = await fn();
      if (success) pushToast(success);
      return out;
    } catch (err) {
      const e = err as SiteError;
      if (e.code === 'reauth_required' && bounceToStepUp()) {
        pushToast('Confirm it’s you', { err: true, sub: 'Taking you to prove your second factor; you will come back here.', ttl: 4000 });
      } else {
        pushToast(`${label} failed`, { err: true, sub: describeSiteError(err), ttl: 6000 });
      }
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [pushToast]);
  return { run, busy };
}
