import { useState } from 'react';
import { Button, Card, Checkbox, Drawer, Field, FormGrid, Input, Switch, cx } from '../../components/ui';
import { refusalWords, refusedOf, type OrgRole, type RefusedRole } from '../../api/orgAccess';
import { roleLabel } from '../../lib/orgRoles';
import { makeToastErr, type PushToast } from './toastErr';
import { useCreateOrgUser } from '../../api/hooks';

/** Checkbox list limited to the org roles the caller may assign here (never the whole catalogue). */
function RolePicker({ assignable, checked, toggle }: { assignable: OrgRole[]; checked: string[]; toggle: (r: string) => void }) {
  return (
    <Card>
      {assignable.map((r) => {
        const on = checked.includes(r.role);
        const { name, site } = roleLabel(r.role);
        return (
          <Checkbox
            key={r.role}
            className={cx('orgs-pick', on && 'on')}
            checked={on}
            onChange={() => toggle(r.role)}
            label={
              <span className="row wrap gap-4">
                <span className="fw-medium text-base">{name}</span>
                {site && <span className="small muted">on {site}</span>}
                <span className="small muted mono">{r.permissions.join(' · ')}</span>
              </span>
            }
          />
        );
      })}
    </Card>
  );
}

export function InviteDrawer({ org, assignable, onClose, onDone, pushToast }: {
  org: string; assignable: OrgRole[]; onClose: () => void; onDone: () => void; pushToast: PushToast;
}) {
  const toastErr = makeToastErr(pushToast);
  const createUser = useCreateOrgUser(org);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [refused, setRefused] = useState<RefusedRole[]>([]);
  const busy = createUser.isPending;
  const toggle = (r: string) => setRoles(rs => (rs.includes(r) ? rs.filter(x => x !== r) : [...rs, r]));

  const submit = () => {
    if (!email || busy) return;
    setRefused([]);
    createUser.mutate(
      {
        email: email.trim(),
        name: name.trim() || undefined,
        sendInvite,
        roles: roles.length ? roles : undefined,
      },
      {
        onSuccess: () => { pushToast(`Invited ${email.trim()}`, { sub: sendInvite ? 'recovery email sent' : undefined }); onDone(); },
        onError: (err) => {
          const list = refusedOf(err);
          if (list.length) setRefused(list);
          else toastErr(err);
        },
      },
    );
  };

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Organization"
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
      {/* No list at all where there is nothing to hand out on invite: roles are assigned after joining. */}
      {assignable.length > 0 && (
        <Field label={<>Roles <span className="muted">(optional · only roles you may assign here)</span></>}>
          <RolePicker assignable={assignable} checked={roles} toggle={toggle} />
        </Field>
      )}
      {refused.length > 0 && (
        <div role="alert" className="orgs-refused">
          <div className="small fw-medium text-danger">Nobody was invited. Refused:</div>
          <ul className="small orgs-refused-list">
            {refused.map((r) => <li key={r.role}><span className="mono">{r.role}</span> — {refusalWords(r)}</li>)}
          </ul>
        </div>
      )}
      <Field label="Send invite email" inline hint="Emails them a link to set their password">
        <Switch on={sendInvite} onChange={setSendInvite} label="Send invite email" />
      </Field>
      </FormGrid>
    </Drawer>
  );
}
