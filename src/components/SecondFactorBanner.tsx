import { useEffect, useState } from 'react';
import { useSecondFactorStatus } from '../api/hooks';
import { I } from './ui';
import { TWO_STEP_EVENT, twoStepHere } from '../lib/stepUp';
import { ENROL_TITLE, secondFactorPrompt } from '../lib/secondFactor';

/**
 * Under the top bar of every page:
 *   - an account whose role requires two-step sign-in and has no second factor sees a persistent
 *     banner with a one-click link to set one up (it returns to this page). It goes once they have one.
 *   - an account that has one but signed in without it sees nothing until an action needs it; then
 *     the console leaves for the gate (api/client.ts) and this says why: "Confirm your second factor".
 */
export function SecondFactorBanner() {
  const { data } = useSecondFactorStatus();
  const [leaving, setLeaving] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setLeaving((e as CustomEvent<{ to: string }>).detail?.to ?? '');
    window.addEventListener(TWO_STEP_EVENT, on);
    return () => window.removeEventListener(TWO_STEP_EVENT, on);
  }, []);

  const prompt = secondFactorPrompt(data);
  if (prompt === 'enrol') {
    const href = twoStepHere();
    return (
      <div className="viewer-banner two-step-banner" role="alert">
        <span aria-hidden="true">{I.shield}</span>
        <span className="flex-1 min-w-0">{ENROL_TITLE}</span>
        {href && <a className="two-step-banner-link" href={href}>Set it up now →</a>}
      </div>
    );
  }
  if (leaving !== null) {
    return (
      <div className="viewer-banner two-step-banner is-soft" role="status">
        <span aria-hidden="true">{I.shield}</span>
        <span className="flex-1 min-w-0">Confirm your second factor to continue — taking you to the sign-in page, then back here.</span>
        {leaving && <a className="two-step-banner-link" href={leaving}>Go now →</a>}
      </div>
    );
  }
  return null;
}
