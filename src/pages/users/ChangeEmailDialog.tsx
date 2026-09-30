import { useEffect, useState } from 'react';
import { accountsApi, type EmailChange } from '../../api/accounts';
import { Button, Callout, Dialog, Field, Input } from '../../components/ui';
import { I } from '../../components/ui/Icons';
import { emailError } from '../../lib/profile';
import { stepUpAndResume } from '../../lib/resume';
import { emailChangeFailure, emailChangeResult, emailResumeAction, type EmailChangeFailure, type EmailResume } from '../../lib/userAddress';

type Phase =
  | { kind: 'form' }
  | { kind: 'saving' }
  | { kind: 'done'; result: EmailChange }
  | { kind: 'error'; failure: EmailChangeFailure };

/**
 * "Change email": the sign-in address has its own call, never the profile save. The new address
 * starts unverified and is sent a link; the old one is owed a notice, which jinbe records in the
 * audit trail. It needs the caller's own second factor proven recently: refused for want of it, the
 * address is kept across the step-up and PROPOSED again on the way back — never written unasked.
 */
export function ChangeEmailDialog({ open, user, resumed, onClose, onChanged }: {
  open: boolean;
  user: { id: string; email: string };
  /** The address carried back from a step-up: seeds the form and says nothing was changed yet. */
  resumed?: string;
  onClose: () => void;
  onChanged: (result: EmailChange) => void;
}) {
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [bounce, setBounce] = useState<'going' | 'failed' | null>(null);
  useEffect(() => {
    if (open) { setEmail(resumed ?? ''); setPhase({ kind: 'form' }); setBounce(null); }
  }, [open, resumed]);

  const typed = email.trim();
  const invalid = typed ? emailError(typed) : null;
  const same = typed.toLowerCase() === user.email.trim().toLowerCase();
  const fieldError = phase.kind === 'error' && phase.failure.field ? phase.failure.detail : invalid ?? (same ? 'That is already their address.' : undefined);

  const submit = async () => {
    if (!typed || invalid || same) return;
    setPhase({ kind: 'saving' });
    try {
      const result = await accountsApi.changeEmail(user.id, typed);
      setPhase({ kind: 'done', result });
      onChanged(result);
    } catch (err) {
      setPhase({ kind: 'error', failure: emailChangeFailure(err) });
    }
  };

  const stepUp = () => {
    const going = stepUpAndResume(emailResumeAction(user.id), { email: typed } satisfies EmailResume);
    setBounce(going ? 'going' : 'failed');
  };

  const editing = phase.kind !== 'done';
  const footer = editing
    ? <>
        <Button onClick={onClose} disabled={phase.kind === 'saving'}>Cancel</Button>
        {phase.kind === 'error' && phase.failure.stepUp
          ? <Button variant="primary" onClick={stepUp} disabled={bounce === 'going'}>Confirm my second factor</Button>
          : <Button variant="primary" onClick={submit} disabled={!typed || !!invalid || same} loading={phase.kind === 'saving'}>
              {phase.kind === 'saving' ? 'Changing…' : 'Change email'}
            </Button>}
      </>
    : <Button variant="primary" onClick={onClose}>Done</Button>;

  return (
    <Dialog open={open} onClose={onClose} title={`Change the sign-in address of ${user.email}?`} footer={footer}>
      {editing && (
        <div className="stack gap-12">
          {resumed && phase.kind === 'form' && (
            <Callout tone="success" icon={I.check} title="Second factor verified · nothing changed yet">
              <div className="small muted">The address you entered is back. Check it and use Change email.</div>
            </Callout>
          )}
          <div className="confirm-body">
            They sign in with the new address from now on. It starts <strong>unverified</strong>: a link to confirm it
            goes to the new address. The old address, <span className="mono">{user.email}</span>, is owed a notice —
            it is recorded in the audit trail, not emailed from here.
          </div>
          <Field label="New address" required error={fieldError}>
            <Input id="change-email-new" mono type="text" inputMode="email" autoComplete="off" data-1p-ignore data-lpignore="true"
              placeholder="user@example.com" value={email}
              onChange={e => { setEmail(e.target.value); if (phase.kind === 'error') setPhase({ kind: 'form' }); }} />
          </Field>
          <div className="small muted">Needs your own second factor proven in the last 15 minutes.</div>
          {phase.kind === 'error' && !phase.failure.field && (
            <Callout tone={phase.failure.stepUp ? 'warning' : 'danger'} icon={phase.failure.stepUp ? I.lock : I.alert} title={phase.failure.title}>
              {phase.failure.detail}
              {phase.failure.stepUp && (bounce === 'going'
                ? ' Taking you to confirm it; back here the address is in the form again, ready to change. This is not a sign-out.'
                : bounce === 'failed'
                  ? ' The console could not send you to confirm it: re-verify your second factor, then change it again.'
                  : ' You will be sent to confirm it, then back here with the address in the form.')}
            </Callout>
          )}
        </div>
      )}
      {phase.kind === 'done' && <ChangeResult result={phase.result} />}
    </Dialog>
  );
}

function ChangeResult({ result }: { result: EmailChange }) {
  const { verification, verificationTone, notice } = emailChangeResult(result);
  return (
    <div className="stack gap-12">
      <Callout tone="success" icon={I.check} title="Sign-in address changed">
        They now sign in with <span className="mono">{result.email}</span>.
      </Callout>
      <Callout tone={verificationTone} icon={verificationTone === 'success' ? I.info : I.alert} title="Unverified until they confirm it">
        {verification}
      </Callout>
      <div className="small muted">{notice}</div>
    </div>
  );
}
