import { useEffect, useState } from 'react';
import { recoveryApi } from '../../api/recovery';
import { Button, Callout, Dialog } from '../../components/ui';
import { I } from '../../components/ui/Icons';
import { formatWait, LINK_LIFESPAN, LINK_RECOVERY_SETTINGS, linkFailure, linkReturnTo, type LinkOutcome } from '../../lib/recovery';

type Phase = 'confirm' | 'sending' | LinkOutcome;

/**
 * "Send a sign-in link": for somebody whose email sign-in code does not arrive or who cannot get in
 * at all. Kratos mails a one-click link (account recovery by link); the console never sees it.
 */
export function SendLoginLinkDialog({ open, user, hasSecondFactor = false, onClose }: {
  open: boolean;
  user: { id: string; email: string };
  /** Says the link will not get them past a factor they lost. */
  hasSecondFactor?: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('confirm');
  useEffect(() => { if (open) setPhase('confirm'); }, [open]);

  const send = async () => {
    setPhase('sending');
    const returnTo = linkReturnTo();
    try {
      let sent: { expiresAt: string | null };
      try {
        sent = await recoveryApi.sendLoginLink(user.id, returnTo);
      } catch (err) {
        // Kratos refuses a return address outside selfservice.allowed_return_urls: the link still
        // helps without it — they land on their settings and go on from there.
        if (!returnTo || linkFailure(err).kind !== 'return_to_refused') throw err;
        sent = await recoveryApi.sendLoginLink(user.id);
      }
      setPhase({ kind: 'sent', expiresAt: sent.expiresAt });
    } catch (err) {
      setPhase(linkFailure(err));
    }
  };

  const confirming = phase === 'confirm' || phase === 'sending';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Send a sign-in link to ${user.email}?`}
      footer={confirming
        ? <>
            <Button onClick={onClose} disabled={phase === 'sending'}>Cancel</Button>
            <Button variant="primary" onClick={send} loading={phase === 'sending'}>
              {phase === 'sending' ? 'Sending…' : 'Send link'}
            </Button>
          </>
        : <Button variant="primary" onClick={onClose}>Done</Button>}
    >
      {confirming
        ? (
          <div className="stack gap-12">
            <div className="confirm-body">
              Emails <span className="mono">{user.email}</span> a one-click link valid for {LINK_LIFESPAN}. It signs
              them in and opens their account settings. Use it when the email sign-in code does not arrive.
            </div>
            {hasSecondFactor && (
              <div className="small muted">
                They have two-step sign-in. If they lost that factor, remove it first — otherwise the link asks for it.
              </div>
            )}
          </div>
        )
        : <LinkResult outcome={phase} email={user.email} />}
    </Dialog>
  );
}

function LinkResult({ outcome, email }: { outcome: LinkOutcome; email: string }) {
  switch (outcome.kind) {
    case 'sent':
      return (
        <Callout tone="success" icon={I.check} title="Sign-in link sent">
          Sent to <span className="mono">{email}</span>. It works once,
          {outcome.expiresAt ? ` until ${new Date(outcome.expiresAt).toLocaleTimeString()} at the latest.` : ` for up to ${LINK_LIFESPAN}.`}
        </Callout>
      );
    case 'rate_limited':
      return (
        <Callout tone="warning" icon={I.clock} title="Too many links for this person">
          Three sign-in links in 15 minutes is the limit, so nothing was sent. Try again in {formatWait(outcome.retryAfterSeconds)}.
        </Callout>
      );
    case 'unavailable':
      return (
        <Callout tone="danger" icon={I.alert} title="Kratos is not set up to send sign-in links">
          <div>
            Kratos recovers accounts by code only, and a code mailed outside a sign-in the person started cannot be
            used — so nothing was sent. In the Kratos configuration, set:
          </div>
          <pre className="mono small mt-4">{LINK_RECOVERY_SETTINGS.join('\n')}</pre>
        </Callout>
      );
    case 'no_address':
      return (
        <Callout tone="warning" icon={I.alert} title="No email address">
          This person has no email address to send a link to. Add one under Edit first.
        </Callout>
      );
    case 'return_to_refused':
    case 'failed':
      return (
        <Callout tone="danger" icon={I.alert} title="The link was not sent">
          {outcome.kind === 'failed' ? outcome.message : 'Kratos refused the return address.'}
        </Callout>
      );
  }
}
