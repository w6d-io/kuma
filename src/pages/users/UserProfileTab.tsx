import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { useUserIdentity } from '../../api/hooks';
import { accountsApi } from '../../api/accounts';
import { ApiErrorState } from '../../components/ApiErrorState';
import { Button, Card, Field, Input } from '../../components/ui';
import { profileChange, profileError, type ProfileDraft } from '../../lib/profile';
import { toastFor } from '../../lib/apiError';
import type { User } from '../../api/types';

/**
 * Name and email. Seeded from the stored identity, not the directory row — the row shows the email
 * where there is no name, and saving that back would make it the name.
 */
export function UserProfileTab({ user }: { user: User }) {
  const { pushToast, persona, apiSendRecoveryEmail } = useApp();
  const qc = useQueryClient();
  const identityQ = useUserIdentity(user.id);
  const identity = identityQ.data;
  const baseline: ProfileDraft = {
    name: typeof identity?.traits.name === 'string' ? identity.traits.name : '',
    email: identity?.traits.email ?? '',
  };
  const [draft, setDraft] = useState<ProfileDraft>(baseline);
  const [saving, setSaving] = useState(false);
  const [sendingRecovery, setSendingRecovery] = useState(false);

  // Re-seed when the stored identity changes (first load, or after a save lands).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(baseline); }, [identity?.traits.name, identity?.traits.email]);

  if (identityQ.isError) {
    return <ApiErrorState compact what="this profile" error={identityQ.error} onRetry={() => identityQ.refetch()} />;
  }
  if (identityQ.isLoading) {
    return <Card pad="md" className="text-center"><span className="small muted">Loading profile…</span></Card>;
  }

  const change = profileChange(baseline, draft);
  const invalid = profileError(draft);

  const save = async () => {
    if (!change || invalid) return;
    if (persona === 'viewer') { pushToast('Read-only persona · change blocked', { err: true }); return; }
    setSaving(true);
    try {
      await accountsApi.updateProfile(user.id, change.traits);
      pushToast(`Saved ${change.traits.email ?? user.email}`);
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
      pushToast(`Recovery email sent to ${user.email}`);
    } catch (err) {
      pushToast(...toastFor(err));
    } finally {
      setSendingRecovery(false);
    }
  };

  return (
    <div className="stack gap-12">
      <Field label="Full name">
        <Input id="profile-name" value={draft.name} placeholder="Jane Doe"
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
      </Field>
      <Field
        label="Email"
        error={invalid && draft.email !== baseline.email ? invalid : undefined}
        hint={invalid && draft.email !== baseline.email ? undefined : 'They sign in with this address from now on.'}
      >
        <Input id="profile-email" mono type="text" inputMode="email" autoComplete="off"
          data-1p-ignore data-lpignore="true" value={draft.email}
          onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} />
      </Field>
      <div className="row justify-end gap-8">
        <Button onClick={() => setDraft(baseline)} disabled={!change || saving}>Reset</Button>
        <Button variant="primary" onClick={save} disabled={!change || !!invalid || saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
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
    </div>
  );
}
