import { useState } from 'react';
import { useSession } from '../../api/hooks';
import { Button, Callout, Card } from '../../components/ui';
import { I } from '../../components/ui/Icons';
import { useStopImpersonation, useViewingAs } from '../../hooks/useImpersonation';
import { formatLeft, impersonateBlocked, targetLabel } from '../../lib/impersonation';
import type { User } from '../../api/types';
import { ImpersonateDialog } from './ImpersonateDialog';
import { ImpersonationSites } from './ImpersonationSites';

/**
 * The Impersonate action on a person (their Sign-in tab, beside the other support actions). Shown
 * only where the feature is on. Greyed, with the reason in words, for whoever does not hold
 * users:impersonate, on the caller's own account, on a super admin and on an inactive account —
 * jinbe refuses those anyway. While this person is the one being viewed as, it is Stop instead.
 */
export function ImpersonateCard({ user }: { user: User }) {
  const { data: session } = useSession();
  const { state, active, left } = useViewingAs();
  const { stop, stopping } = useStopImpersonation();
  const [open, setOpen] = useState(false);
  if (!state?.enabled) return null;

  const mine = active?.target.id === user.id;
  const blocked = mine ? null : impersonateBlocked(state, session, user);
  return (
    <Card pad="md">
      <div className="row gap-12">
        <div className="flex-1 min-w-0">
          <div className="fw-medium text-base">Impersonate</div>
          <div className="small muted">
            {mine
              ? <>You are viewing the sites as them — read-only, <span className="viewing-as-left">{formatLeft(left)}</span> left.</>
              : 'Opens the sites as them, read-only and for a limited time — to see what they see. This console stays yours.'}
          </div>
          {blocked && <div className="small mt-4">{blocked}</div>}
          {!blocked && !mine && active && (
            <div className="small mt-4">You are viewing as {targetLabel(active.target)} now. Impersonating them switches.</div>
          )}
        </div>
        {mine
          ? <Button variant="primary" onClick={() => { void stop(); }} loading={stopping}>Stop impersonating</Button>
          : <Button onClick={() => setOpen(true)} disabled={!!blocked} title={blocked ?? undefined}>Impersonate</Button>}
      </div>
      <ImpersonateDialog open={open} user={user} current={active} onClose={() => setOpen(false)} />
    </Card>
  );
}

/**
 * At the top of a person's drawer, on every tab, while they are the one being viewed as: the drawer
 * covers the strip under the top bar, so it says the same thing, offers the same Stop, and lists
 * where to open their sites.
 */
export function ViewingAsNotice({ user, className }: { user: User; className?: string }) {
  const { active, left } = useViewingAs();
  const { stop, stopping } = useStopImpersonation();
  if (!active || active.target.id !== user.id) return null;
  return (
    <Callout
      tone="warning"
      icon={I.users}
      className={className}
      title={<>Viewing sites as {targetLabel(active.target)} — read-only — <span className="viewing-as-left">{formatLeft(left)}</span> left</>}
      actions={<Button size="sm" variant="primary" onClick={() => { void stop(); }} loading={stopping}>Stop</Button>}
    >
      <ImpersonationSites userId={user.id} started compact />
    </Callout>
  );
}
