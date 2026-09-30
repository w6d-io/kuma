import { useCallback, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { findingsOf, notAvailable, type SiteError } from '../../api/sites';
import type { Finding } from '../../lib/sites/types';
import { stepUpAndAskToRedo, stepUpAndResume } from '../../lib/resume';
import { EDGE_BLOCKED, edgeBlocked, refusalDetail } from '../../lib/apiError';

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
    case 'unconfirmed_findings': return 'Not published: fix the security errors and acknowledge the findings, then publish again.';
    case 'system_site': return 'System sites are managed by the platform chart.';
  }
  if (e.status === 503) return 'Checks are unavailable (gatekit or Kubernetes did not answer), so nothing was changed.';
  if (edgeBlocked(err)) return `${EDGE_BLOCKED.title}. ${EDGE_BLOCKED.detail}`;
  if (e.status === 403) return refusalDetail(err) ?? 'Your roles do not allow this. Changing what the gateway serves needs a super admin.';
  return e.message || 'The request failed.';
}

/**
 * What to do after a step-up. `resume`: the screen runs it again by itself on the way back (see
 * lib/resume.ts, and the screen's useResume for the same action); `confirmAgain` when the screen
 * reopens its confirmation instead (a delete). Without either, the page it comes back
 * to asks the operator to redo `label` — never a silent "you will come back here".
 */
/** Publishing a saved version, remembered across the step-up (ReviewTab resumes it; EditAddress too). */
export const publishAction = (name: string) => `site-apply:${name}`;

export type AfterStepUp = { resume: string; data: unknown; confirmAgain?: boolean } | { redo: string };

/**
 * `onFindings`: a publish refused for security findings nobody acknowledged (422
 * unconfirmed_findings) goes to the screen's findings dialog instead of a toast.
 */
export function useSiteAction() {
  const { pushToast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>, success?: string, after?: AfterStepUp, onFindings?: (findings: Finding[]) => void): Promise<T | undefined> => {
    setBusy(label);
    try {
      const out = await fn();
      if (success) pushToast(success);
      return out;
    } catch (err) {
      const e = err as SiteError;
      const auto = !!after && 'resume' in after;
      const findings = onFindings && findingsOf(err);
      if (findings) { onFindings(findings); return undefined; }
      if (e.code === 'reauth_required' && (after && 'resume' in after ? stepUpAndResume(after.resume, after.data) : stepUpAndAskToRedo(after?.redo ?? `press ${label} again.`))) {
        pushToast('Confirm it’s you', {
          err: true,
          sub: !auto
            ? `Nothing was done yet. Taking you to prove your second factor; back here, press ${label} again.`
            : after && 'confirmAgain' in after && after.confirmAgain
              ? `Nothing was done yet. Taking you to prove your second factor; back here, confirm ${label.toLowerCase()} once more.`
              : `Nothing was done yet. Taking you to prove your second factor; back here, ${label.toLowerCase()} runs again by itself.`,
          ttl: 4000,
        });
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
