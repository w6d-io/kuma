import { useState } from 'react';
import { Button, Card, Checkbox, Drawer, EmptyHint, Field, Input, Switch, cx } from '../../components/ui';
import { makeToastErr, type PushToast } from './toastErr';
import { useCreateOrgUser } from '../../api/hooks';

/** Checkbox list limited to the caller's assignable groups (never the full catalog). */
function GroupPicker({ assignable, checked, toggle }: { assignable: string[]; checked: string[]; toggle: (g: string) => void }) {
  if (assignable.length === 0) {
    return <EmptyHint>No groups you may assign here — the user keeps base access.</EmptyHint>;
  }
  return (
    <Card>
      {assignable.map((g) => {
        const on = checked.includes(g);
        return (
          <Checkbox
            key={g}
            className={cx('orgs-pick', on && 'on')}
            checked={on}
            onChange={() => toggle(g)}
            label={<span className="fw-medium text-base">{g}</span>}
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
      <Field label="Email" required className="mb-12">
        <Input mono type="text" inputMode="email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="user@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
      </Field>
      <Field label={<>Name <span className="muted">(optional)</span></>} className="mb-12">
        <Input placeholder="Jane Doe" value={name} onChange={e => setName(e.target.value)} />
      </Field>
      {/* No list at all where there is nothing to hand out on invite: My org grants after joining. */}
      {assignable.length > 0 && (
        <Field label={<>Groups <span className="muted">(optional · only groups you may assign)</span></>} className="mb-12">
          <GroupPicker assignable={assignable} checked={groups} toggle={toggle} />
        </Field>
      )}
      <div className="row justify-between py-8">
        <div>
          <div className="fw-medium text-base">Send invite email</div>
          <div className="small muted">Emails them a link to set their password</div>
        </div>
        <Switch on={sendInvite} onChange={setSendInvite} />
      </div>
    </Drawer>
  );
}
