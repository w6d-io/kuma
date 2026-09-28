import { useEffect, useState } from 'react';
import { recoveryApi, type SecondFactorMethod, type SecondFactorReset } from '../../api/recovery';
import { Badge, Button, Callout, Checkbox, Dialog, Field, Textarea } from '../../components/ui';
import { I } from '../../components/ui/Icons';
import { stepUpAndAskToRedo } from '../../lib/resume';
import { FACTOR_LABELS, factorList, resetFailure } from '../../lib/recovery';

type Phase =
  | { kind: 'form' }
  | { kind: 'removing' }
  | { kind: 'done'; result: SecondFactorReset }
  | { kind: 'error'; title: string; detail: string; stepUp?: boolean };

/** What happens at their next sign-in, as far as the policy could say. */
function nextSignIn(required: boolean | null): string {
  if (required === true) return 'Their role requires two-step sign-in: at their next sign-in they will be asked to set up a new one before going on.';
  if (required === false) return 'Their role does not require two-step sign-in. They can set a new one up from their account settings.';
  return 'If their role requires two-step sign-in, they will be asked to set up a new one at their next sign-in.';
}

/**
 * "Remove two-step sign-in": for somebody who lost their authenticator app or security key. Lists
 * what goes, asks why (it is written to the audit trail), and offers the sign-in link that gets
 * them back in to set a new factor up.
 */
export function RemoveSecondFactorDialog({ open, user, methods, required, onClose, onRemoved, onSendLink }: {
  open: boolean;
  user: { id: string; email: string };
  methods: SecondFactorMethod[];
  required: boolean | null;
  onClose: () => void;
  onRemoved: (result: SecondFactorReset) => void;
  onSendLink: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [reason, setReason] = useState('');
  const [revokeSessions, setRevokeSessions] = useState(true);
  useEffect(() => {
    if (open) { setPhase({ kind: 'form' }); setReason(''); setRevokeSessions(true); }
  }, [open]);

  const remove = async () => {
    if (!reason.trim()) return;
    setPhase({ kind: 'removing' });
    try {
      const result = await recoveryApi.resetSecondFactors(user.id, { reason: reason.trim(), revokeSessions });
      setPhase({ kind: 'done', result });
      onRemoved(result);
    } catch (err) {
      setPhase({ kind: 'error', ...resetFailure(err) });
    }
  };

  const editing = phase.kind === 'form' || phase.kind === 'removing';
  const footer = editing
    ? <>
        <Button onClick={onClose} disabled={phase.kind === 'removing'}>Cancel</Button>
        <Button variant="danger" onClick={remove} disabled={!reason.trim()} loading={phase.kind === 'removing'}>
          {phase.kind === 'removing' ? 'Removing…' : 'Remove two-step sign-in'}
        </Button>
      </>
    : phase.kind === 'done'
      ? <>
          <Button onClick={onClose}>Done</Button>
          <Button variant="primary" onClick={onSendLink}>Also send a sign-in link</Button>
        </>
      : <>
          <Button onClick={onClose}>Close</Button>
          {/* Removing somebody's factor is never re-run unasked: back from the step-up, the page says to redo it. */}
          {phase.stepUp && <Button variant="primary" onClick={() => stepUpAndAskToRedo(`Remove two-step sign-in for ${user.email} again (their Sign-in tab); nothing was removed.`)}>Confirm my second factor</Button>}
        </>;

  return (
    <Dialog open={open} onClose={onClose} title={`Remove two-step sign-in for ${user.email}?`} footer={footer}>
      {editing && (
        <div className="stack gap-12">
          <div className="confirm-body">
            For somebody who lost their authenticator app or security key. This removes from their account:
          </div>
          <div className="row wrap gap-4">
            {methods.map(m => <Badge key={m} mono={false}>{FACTOR_LABELS[m] ?? m}</Badge>)}
          </div>
          <div className="small muted">Passkeys, if they have any, stay. {nextSignIn(required)}</div>
          <Field label="Reason" required hint="Written to the audit trail with your name.">
            <Textarea
              id="second-factor-reason"
              rows={3}
              maxLength={500}
              placeholder="Lost their phone; identity confirmed by video call"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </Field>
          <Checkbox
            checked={revokeSessions}
            onChange={setRevokeSessions}
            label="Also sign them out everywhere"
            hint="Ends every session, including any that already passed two-step sign-in."
          />
        </div>
      )}
      {phase.kind === 'done' && (
        <Callout tone="success" icon={I.check} title="Two-step sign-in removed">
          Removed: {factorList(phase.result.removed)}.
          {phase.result.sessionsRevoked ? ' They were signed out everywhere.' : ''} {nextSignIn(required)} To get them
          back in now, send a sign-in link.
        </Callout>
      )}
      {phase.kind === 'error' && (
        <Callout tone="danger" icon={I.alert} title={phase.title}>{phase.detail}</Callout>
      )}
    </Dialog>
  );
}
