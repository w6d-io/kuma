import { useOwnSecondFactor } from '../api/twoFactor';
import { Callout, I, TwoFactorBadge } from './ui';
import { ownStatus } from '../lib/twoFactor';
import { twoStepHere } from '../lib/stepUp';

const TONE = { ok: 'success', info: 'info', warning: 'warning', danger: 'danger' } as const;

/**
 * Your own two-step sign-in, said plainly: whether it is required for you and because of which
 * groups, whether you enrolled, whether this session used it, and whether your protected permissions
 * need it proven again now. Absent on a jinbe that does not describe it.
 */
export function OwnSecondFactor() {
  const { data } = useOwnSecondFactor();
  if (!data) return null;
  const s = ownStatus(data);
  const href = twoStepHere();
  const act = data.enrolled === false ? 'Set it up now →' : data.currentAal && data.currentAal !== 'aal2' ? 'Confirm it now →' : null;
  return (
    <Callout
      tone={TONE[s.tone]}
      icon={I.shield}
      title={<span className="row gap-8 items-center wrap">{s.title}{data.required && <TwoFactorBadge kind="required" title={`Required by ${data.requiredBecause.join(', ')}`} />}</span>}
      actions={act && href ? <a className="btn sm" href={href}>{act}</a> : undefined}
    >
      <ul className="site-list m-0">
        {s.lines.map((l) => <li key={l} className="small">{l}</li>)}
      </ul>
    </Callout>
  );
}
