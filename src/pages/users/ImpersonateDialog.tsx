import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { impersonationApi, type ActiveImpersonation } from '../../api/impersonation';
import { Button, Callout, Dialog, Field, Segmented, Textarea } from '../../components/ui';
import { I } from '../../components/ui/Icons';
import { setActiveImpersonation, useImpersonation, useStopImpersonation } from '../../hooks/useImpersonation';
import { durationChoices, impersonationFailure, REASON_MAX, REASON_MIN, targetLabel } from '../../lib/impersonation';
import { stepUpAndAskToRedo } from '../../lib/resume';
import { ImpersonationSites } from './ImpersonationSites';

type Phase =
  | { kind: 'switch' }
  | { kind: 'form' }
  | { kind: 'starting' }
  | { kind: 'done'; active: ActiveImpersonation }
  | { kind: 'error'; title: string; detail: string; stepUp?: boolean };

const until = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * "Impersonate": for support, to see the sites the way one person sees them. Says what it does and
 * does not do, asks why (written to the audit trail) and for how long, and once started says where
 * to go and how to stop. `current` is who the caller is already viewing as, when it is somebody
 * else: starting replaces that one, so the dialog asks about the switch before anything else.
 */
export function ImpersonateDialog({ open, user, current, onClose }: {
  open: boolean;
  user: { id: string; email: string; name: string };
  current: ActiveImpersonation | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { stop, stopping } = useStopImpersonation();
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [reason, setReason] = useState('');
  // What jinbe allows at most decides the choices; the longest one offered is the default.
  const choices = durationChoices(useImpersonation().data?.maxMinutes);
  const longest = choices[choices.length - 1];
  const [picked, setMinutes] = useState<number | null>(null);
  const minutes = picked !== null && choices.includes(picked) ? picked : longest;
  const who = targetLabel(user);
  const other = current && current.target.id !== user.id ? current : null;
  // Decided when the dialog opens: once it has started, `current` is this person and says nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setPhase({ kind: other ? 'switch' : 'form' }); setReason(''); setMinutes(null); } }, [open]);

  const ready = reason.trim().length >= REASON_MIN;
  const start = async () => {
    if (!ready) return;
    setPhase({ kind: 'starting' });
    try {
      const { active } = await impersonationApi.start(user.id, { reason: reason.trim(), minutes });
      setActiveImpersonation(qc, active);
      setPhase({ kind: 'done', active });
    } catch (err) {
      setPhase({ kind: 'error', ...impersonationFailure(err, user.email) });
    }
  };

  // The one being switched away from ran out (or was stopped) while the question was up: just the form.
  const switching = phase.kind === 'switch' && other ? other : null;
  const editing = phase.kind === 'form' || phase.kind === 'starting' || (phase.kind === 'switch' && !switching);
  const footer = switching
    ? <>
        <Button onClick={onClose}>Keep viewing as {targetLabel(switching.target)}</Button>
        <Button variant="primary" onClick={() => setPhase({ kind: 'form' })}>Switch to {who}</Button>
      </>
    : editing
      ? <>
          <Button onClick={onClose} disabled={phase.kind === 'starting'}>Cancel</Button>
          <Button variant="primary" onClick={start} disabled={!ready} loading={phase.kind === 'starting'}>
            {phase.kind === 'starting' ? 'Starting…' : 'Impersonate'}
          </Button>
        </>
      : phase.kind === 'done'
        ? <>
            <Button onClick={() => { void stop().then(onClose); }} loading={stopping}>Stop impersonating</Button>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </>
        : <>
            <Button onClick={onClose}>Close</Button>
            {/* Never started unasked: back from the step-up, the page says to do it again. */}
            {phase.kind === 'error' && phase.stepUp && <Button variant="primary" onClick={() => stepUpAndAskToRedo(`Impersonate ${user.email} again (their Sign-in tab); nothing was started.`)}>Confirm my second factor</Button>}
          </>;

  const title = switching
    ? `You are viewing as ${targetLabel(switching.target)}. Switch to ${who}?`
    : phase.kind === 'done' ? `Viewing as ${who}` : `Impersonate ${user.email}?`;

  return (
    <Dialog open={open} onClose={onClose} title={title} footer={footer}>
      {switching && (
        <div className="confirm-body">
          Only one person at a time. Switching ends viewing as <span className="mono">{switching.target.email}</span> and
          starts again for <span className="mono">{user.email}</span>, with its own reason and time limit.
        </div>
      )}
      {editing && (
        <div className="stack gap-12">
          <div className="confirm-body">
            Opens the sites as <span className="mono">{user.email}</span>, to see what they see.
          </div>
          <ul className="small muted viewing-as-facts">
            <li>Read-only: nothing can be changed as them.</li>
            <li>Only on the sites, in other tabs. This console stays yours.</li>
            <li>They are not notified.</li>
            <li>Everything is recorded in the audit trail, with your name.</li>
          </ul>
          <Field label="Reason" required hint={`At least ${REASON_MIN} characters. Written to the audit trail with your name.`}>
            <Textarea
              id="impersonate-reason"
              rows={3}
              maxLength={REASON_MAX}
              placeholder="Ticket 4821: cannot see their invoices"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </Field>
          <div>
            <div className="input-label">Duration</div>
            <Segmented
              label="Duration"
              size="md"
              value={String(minutes)}
              onChange={(v) => setMinutes(Number(v))}
              options={choices.map((m) => ({ value: String(m), label: `${m} min` }))}
            />
            <div className="small muted mt-4">It ends by itself after that. You can stop it sooner, at any time.</div>
          </div>
          {/* What they will get, said before starting; never a reason the button stays grey. */}
          <ImpersonationSites userId={user.id} started={false} />
        </div>
      )}
      {phase.kind === 'done' && (
        <div className="stack gap-12">
          <Callout tone="warning" icon={I.users} title={`Sites now open as ${who} — read-only, until ${until(phase.active.expiresAt)}`}>
            This console is still yours. To stop, use Stop in the strip at the top of every page.
          </Callout>
          <ImpersonationSites userId={user.id} started />
        </div>
      )}
      {phase.kind === 'error' && (
        <Callout tone="danger" icon={I.alert} title={phase.title}>{phase.detail}</Callout>
      )}
    </Dialog>
  );
}
