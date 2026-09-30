import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { useSession, useUserIdentity } from '../../api/hooks';
import { accountsApi, type EmailChange } from '../../api/accounts';
import { ApiErrorState } from '../../components/ApiErrorState';
import { Badge, Button, Callout, Card, Field, Input } from '../../components/ui';
import { I } from '../../components/ui/Icons';
import { profileChange, type ProfileDraft } from '../../lib/profile';
import { formatWait } from '../../lib/recovery';
import { toastFor } from '../../lib/apiError';
import { signInAddress, VERIFICATION_LINK_SETTINGS, verificationFailure, type VerificationOutcome } from '../../lib/userAddress';
import { mayUse } from '../../policy/model';
import { ChangeEmailDialog } from './ChangeEmailDialog';
import type { User } from '../../api/types';

/**
 * Name and email. Seeded from the stored identity, not the directory row — the row shows the email
 * where there is no name, and saving that back would make it the name. The address is read-only
 * here: it changes through Change email (its own call, with a step-up), never the profile save.
 */
export function UserProfileTab({ user, resumedEmail, onEmailChanged }: {
  user: User;
  /** An address carried back from a step-up: the change dialog opens on it. */
  resumedEmail?: string;
  onEmailChanged?: (result: EmailChange) => void;
}) {
  const { pushToast, persona, apiSendRecoveryEmail } = useApp();
  const { data: session } = useSession();
  const qc = useQueryClient();
  const identityQ = useUserIdentity(user.id);
  const identity = identityQ.data;
  const baseline: ProfileDraft = { name: typeof identity?.traits.name === 'string' ? identity.traits.name : '' };
  const [draft, setDraft] = useState<ProfileDraft>(baseline);
  const [saving, setSaving] = useState(false);
  const [sendingRecovery, setSendingRecovery] = useState(false);
  const [changingEmail, setChangingEmail] = useState(!!resumedEmail);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<VerificationOutcome | null>(null);

  // Re-seed when the stored identity changes (first load, or after a save lands).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(baseline); }, [identity?.traits.name]);
  useEffect(() => { if (resumedEmail) setChangingEmail(true); }, [resumedEmail]);
  useEffect(() => { setVerification(null); }, [identity?.traits.email]);

  if (identityQ.isError) {
    return <ApiErrorState compact what="this profile" error={identityQ.error} onRetry={() => identityQ.refetch()} />;
  }
  if (identityQ.isLoading) {
    return <Card pad="md" className="text-center"><span className="small muted">Loading profile…</span></Card>;
  }

  const email = identity?.traits.email ?? user.email;
  const address = signInAddress(identity);
  const mayChangeEmail = mayUse(session, 'users:update_email');
  const mayVerify = mayUse(session, 'users:verify');
  const change = profileChange(baseline, draft);
  const blocked = () => {
    if (persona !== 'viewer') return false;
    pushToast('Read-only persona · change blocked', { err: true });
    return true;
  };

  const save = async () => {
    if (!change || blocked()) return;
    setSaving(true);
    try {
      await accountsApi.updateProfile(user.id, change.traits);
      pushToast(`Saved ${email}`);
      qc.invalidateQueries({ queryKey: ['user-identity', user.id] });
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      pushToast(...toastFor(err));
    } finally {
      setSaving(false);
    }
  };

  const sendRecovery = async () => {
    setSendingRecovery(true);
    try {
      await apiSendRecoveryEmail(user.id);
      pushToast(`Recovery email sent to ${email}`);
    } catch (err) {
      pushToast(...toastFor(err));
    } finally {
      setSendingRecovery(false);
    }
  };

  const resendVerification = async () => {
    if (blocked()) return;
    setVerifying(true);
    try {
      await accountsApi.resendVerification(user.id);
      setVerification({ kind: 'sent' });
    } catch (err) {
      const outcome = verificationFailure(err);
      setVerification(outcome);
      if (outcome.kind === 'already_verified') qc.invalidateQueries({ queryKey: ['user-identity', user.id] });
    } finally {
      setVerifying(false);
    }
  };

  const emailChanged = (result: EmailChange) => {
    qc.invalidateQueries({ queryKey: ['user-identity', user.id] });
    qc.invalidateQueries({ queryKey: ['users'] });
    onEmailChanged?.(result);
  };

  return (
    <div className="stack gap-12">
      <Field label="Full name">
        <Input id="profile-name" value={draft.name} placeholder="Jane Doe"
          onChange={e => setDraft({ name: e.target.value })} />
      </Field>
      <Field label="Email" hint={mayChangeEmail ? 'They sign in with this address. It changes through Change email, which confirms your second factor.' : 'They sign in with this address.'}>
        <div className="row gap-8">
          <Input id="profile-email" mono readOnly value={email} className="flex-1" />
          {address && (address.verified
            ? <Badge tone="success" mono={false}>verified</Badge>
            : <Badge tone="warning" mono={false}>unverified</Badge>)}
          {mayChangeEmail && <Button size="sm" icon={I.edit} onClick={() => { if (!blocked()) setChangingEmail(true); }}>Change email</Button>}
        </div>
      </Field>
      <div className="row justify-end gap-8">
        <Button onClick={() => setDraft(baseline)} disabled={!change || saving}>Reset</Button>
        <Button variant="primary" onClick={save} disabled={!change || saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
      {address && !address.verified && mayVerify && (
        <Card pad="md">
          <div className="row gap-12">
            <div className="flex-1">
              <div className="fw-medium text-base">Address not verified</div>
              <div className="small muted">Emails <span className="mono">{email}</span> a link that confirms it is theirs.</div>
            </div>
            <Button disabled={verifying} onClick={resendVerification}>
              {verifying ? 'Sending…' : 'Resend verification email'}
            </Button>
          </div>
          {verification && <VerificationResult outcome={verification} email={email} />}
        </Card>
      )}
      <Card pad="md">
        <div className="row gap-12">
          <div className="flex-1">
            <div className="fw-medium text-base">Recovery email</div>
            <div className="small muted">Send a password-reset link.</div>
          </div>
          <Button disabled={sendingRecovery} onClick={sendRecovery}>
            {sendingRecovery ? 'Sending…' : 'Send recovery email'}
          </Button>
        </div>
      </Card>
      {mayChangeEmail && (
        <ChangeEmailDialog
          open={changingEmail}
          user={{ id: user.id, email }}
          resumed={resumedEmail}
          onClose={() => setChangingEmail(false)}
          onChanged={emailChanged}
        />
      )}
    </div>
  );
}

function VerificationResult({ outcome, email }: { outcome: VerificationOutcome; email: string }) {
  switch (outcome.kind) {
    case 'sent':
      return (
        <Callout tone="success" icon={I.check} title="Verification email sent" className="mt-12">
          Sent to <span className="mono">{email}</span>. The address shows as verified once they use the link.
        </Callout>
      );
    case 'rate_limited':
      return (
        <Callout tone="warning" icon={I.clock} title={outcome.you ? 'You sent too many links this hour' : 'Too many links for this person'} className="mt-12">
          {outcome.you ? '30 verification links an hour is your limit' : 'Three verification links in 15 minutes is the limit'}, so
          nothing was sent. Try again in {formatWait(outcome.retryAfterSeconds)}.
        </Callout>
      );
    case 'already_verified':
      return (
        <Callout tone="success" icon={I.check} title="Already verified" className="mt-12">
          They confirmed the address meanwhile. Nothing was sent.
        </Callout>
      );
    case 'unavailable':
      return (
        <Callout tone="danger" icon={I.alert} title="Kratos is not set up to send verification links" className="mt-12">
          <div>Kratos verifies addresses by code only, and a code mailed outside a flow they started cannot be used — so nothing was sent. In the Kratos configuration, set:</div>
          <pre className="mono small mt-4">{VERIFICATION_LINK_SETTINGS.join('\n')}</pre>
        </Callout>
      );
    case 'unknown_address':
      return (
        <Callout tone="warning" icon={I.alert} title="Not one of their addresses" className="mt-12">
          Their address changed meanwhile. Close the drawer and open it again.
        </Callout>
      );
    case 'failed':
      return <Callout tone="danger" icon={I.alert} title="The link was not sent" className="mt-12">{outcome.message}</Callout>;
  }
}
