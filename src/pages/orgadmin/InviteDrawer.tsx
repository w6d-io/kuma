import { useState } from 'react';
import { Button, Card, Checkbox, Drawer, EmptyHint, Field, FormGrid, Input, Switch, TwoFactorBadge, cx } from '../../components/ui';
import { useGroupSecondFactors } from '../../api/twoFactor';
import { makeToastErr, type PushToast } from './toastErr';
import { useCreateOrgUser } from '../../api/hooks';

/**
 * Checkbox list limited to the caller's assignable groups (never the full catalog). A new account has
 * no second factor yet, so a group whose members must use one is shown but cannot be ticked.
 */
function GroupPicker({ assignable, checked, toggle }: { assignable: string[]; checked: string[]; toggle: (g: string) => void }) {
  const secondFactorOf = useGroupSecondFactors();
  if (assignable.length === 0) {
    return <EmptyHint>No groups you may assign here — the user keeps base access.</EmptyHint>;
  }
  return (
    <Card>
      {assignable.map((g) => {
        const on = checked.includes(g);
        const needs2fa = !on && !!secondFactorOf(g)?.required;
        return (
          <Checkbox
            key={g}
            className={cx('orgs-pick', on && 'on')}
            checked={on}
            disabled={needs2fa}
            onChange={() => { if (!needs2fa) toggle(g); }}
            label={<span className="row wrap gap-4 fw-medium text-base">{g}{needs2fa && <TwoFactorBadge kind="needs-enrol" title="A new account has no second factor yet. Add them to this group once they have enrolled one." />}</span>}
          />
        );
      })}
    </Card>
  );
}

export function InviteDrawer({ org, assignable, onClose, onDone, pushToast }: {
  org: string; assignable: string[]; onClose: () => void; onDone: () => void; pushToast: PushToast;
}) {
  const toastErr = makeToastErr(pushToast);
  const createUser = useCreateOrgUser(org);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [groups, setGroups] = useState<string[]>([]);
  const busy = createUser.isPending;
  const toggle = (g: string) => setGroups(gs => (gs.includes(g) ? gs.filter(x => x !== g) : [...gs, g]));

  const submit = () => {
    if (!email || busy) return;
    createUser.mutate(
      {
        email: email.trim(),
        name: name.trim() || undefined,
        sendInvite,
        groups: groups.length ? groups : undefined,
      },
      {
        onSuccess: () => { pushToast(`Invited ${email.trim()}`, { sub: sendInvite ? 'recovery email sent' : undefined }); onDone(); },
        onError: toastErr,
      },
    );
  };

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Org admin"
      title="Invite user"
      footer={
        <>
          <span className="small muted">Adds a new member to this organization</span>
          <div className="row">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={!email || busy}>{busy ? 'Inviting…' : 'Invite'}</Button>
          </div>
        </>
      }
    >
      <FormGrid>
      <Field label="Email" required>
        <Input mono type="text" inputMode="email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="user@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
      </Field>
      <Field label={<>Name <span className="muted">(optional)</span></>}>
        <Input placeholder="Jane Doe" value={name} onChange={e => setName(e.target.value)} />
      </Field>
      {/* No list at all where there is nothing to hand out on invite: My org grants after joining. */}
      {assignable.length > 0 && (
        <Field label={<>Groups <span className="muted">(optional · only groups you may assign)</span></>}>
          <GroupPicker assignable={assignable} checked={groups} toggle={toggle} />
        </Field>
      )}
      <Field label="Send invite email" inline hint="Emails them a link to set their password">
        <Switch on={sendInvite} onChange={setSendInvite} label="Send invite email" />
      </Field>
      </FormGrid>
    </Drawer>
  );
}
