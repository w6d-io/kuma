import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { impersonationApi, type ActiveImpersonation, type ImpersonationState } from '../api/impersonation';
import { useApp } from '../contexts/AppContext';
import { toastFor } from '../lib/apiError';
import { inForce, secondsLeft, targetLabel } from '../lib/impersonation';

export const IMPERSONATION_KEY = ['impersonation'] as const;

/**
 * Whether the caller is viewing the sites as somebody else. One query for the banner, the drawer
 * and the dialog, so all three change together: asked when the console loads, again whenever the
 * window gets the focus back (it may have been stopped, replaced or run out in another tab), and
 * once a minute. A jinbe without the feature answers 404: no data, and nothing is shown.
 */
export function useImpersonation() {
  return useQuery({
    queryKey: IMPERSONATION_KEY,
    queryFn: () => impersonationApi.state(),
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** Writes what a start or a stop answered straight into the shared state, then asks jinbe again. */
export function setActiveImpersonation(qc: QueryClient, active: ActiveImpersonation | null): void {
  qc.setQueryData<ImpersonationState>(IMPERSONATION_KEY, (prev) => ({ enabled: true, allowed: true, ...prev, active }));
  void qc.invalidateQueries({ queryKey: IMPERSONATION_KEY });
}

/**
 * The impersonation in force, with the seconds it has left — ticking once a second while there is
 * one. At zero it reads as none here at once, and jinbe is asked what is true now.
 */
export function useViewingAs(): { state: ImpersonationState | undefined; active: ActiveImpersonation | null; left: number } {
  const { data } = useImpersonation();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = data?.enabled ? data.active?.expiresAt : undefined;
  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const t = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (secondsLeft(expiresAt, at) === 0) {
        clearInterval(t);
        void qc.invalidateQueries({ queryKey: IMPERSONATION_KEY });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, qc]);
  const active = inForce(data, now);
  return { state: data, active, left: active ? secondsLeft(active.expiresAt, now) : 0 };
}

/**
 * Stop: one call, no question asked first. The banner and every "Stop impersonating" go through
 * here, so stopping looks and reads the same wherever it is clicked.
 */
export function useStopImpersonation(): { stop: () => Promise<void>; stopping: boolean } {
  const qc = useQueryClient();
  const { pushToast } = useApp();
  const [stopping, setStopping] = useState(false);
  const stop = useCallback(async () => {
    const was = qc.getQueryData<ImpersonationState>(IMPERSONATION_KEY)?.active ?? null;
    setStopping(true);
    try {
      await impersonationApi.stop();
      setActiveImpersonation(qc, null);
      pushToast(was ? `Stopped viewing as ${targetLabel(was.target)}` : 'Stopped viewing as somebody else', { sub: 'Sites open as you again.' });
    } catch (err) {
      // Not stopped: say so loudly and ask what is true, rather than hide a mode that is still on.
      const [msg, opts] = toastFor(err);
      pushToast('Could not stop viewing as — it is still on', { ...opts, sub: opts.sub ?? msg });
      void qc.invalidateQueries({ queryKey: IMPERSONATION_KEY });
    } finally {
      setStopping(false);
    }
  }, [qc, pushToast]);
  return { stop, stopping };
}
