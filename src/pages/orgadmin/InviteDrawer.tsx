import { useState } from 'react';
import { Button, Callout, Card, Checkbox, CopyField, Drawer, Field, FormGrid, I, Input, cx } from '../../components/ui';
import { refusalWords, refusedOf, type OrgRole, type RefusedRole } from '../../api/orgAccess';
import { invitationAddress, useCreateInvitation, type InvitationCreated } from '../../api/invitations';
import { roleLabel } from '../../lib/orgRoles';
import { makeToastErr, type PushToast } from './toastErr';

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

/**
 * Invite somebody into this organization by address, with or without an account. They join only by
 * accepting, signed in with that address verified; the roles chosen here are given then. The link
 * (or token) is shown once, to be sent to them.
 */
export function InviteDrawer({ org, assignable, onClose, onDone, pushToast }: {
  org: string; assignable: OrgRole[];
  onClose: () => void; onDone: () => void; pushToast: PushToast;
}) {
  const toastErr = makeToastErr(pushToast);
  const create = useCreateInvitation(org);
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [refused, setRefused] = useState<RefusedRole[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<InvitationCreated | null>(null);
  const busy = create.isPending;
  const toggle = (r: string) => setRoles(rs => (rs.includes(r) ? rs.filter(x => x !== r) : [...rs, r]));

  const submit = () => {
    if (!email.trim() || busy) return;
    setRefused([]);
    setProblem(null);
    create.mutate(
      { email: email.trim(), ...(roles.length ? { roles } : {}) },
      {
        onSuccess: (res) => { pushToast(`Invited ${res.invitation.email}`); setSent(res); onDone(); },
        onError: (err) => {
          const list = refusedOf(err);
          if (list.length) { setRefused(list); return; }
          if ((err as { details?: { code?: string } }).details?.code === 'already_member') { setProblem('Already a member. Give them roles from the list instead.'); return; }
          toastErr(err);
        },
      },
    );
  };

  if (sent) {
    const address = invitationAddress(sent);
    return (
      <Drawer
        open
        onClose={onClose}
        eyebrow="Organization"
        title={`${sent.invitation.email} invited`}
        footer={<><span className="small muted">Pending until they accept.</span><Button variant="primary" onClick={onClose}>Done</Button></>}
      >
        <div className="stack gap-16">
          <Callout tone="warning" icon={I.lock} title="Send it now">
            The {sent.link ? 'link' : 'token'} is shown once. They join when they accept it, signed in with this address,
            before {new Date(sent.invitation.expiresAt).toLocaleDateString()}.
          </Callout>
          <Field label={address.label}><CopyField value={address.value} /></Field>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Organization"
      title="Invite by email"
      footer={
        <>
          <span className="small muted">They join when they accept</span>
          <div className="row">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={!email.trim() || busy}>{busy ? 'Inviting…' : 'Invite'}</Button>
          </div>
        </>
      }
    >
      <FormGrid>
        <Field label="Email" required error={problem ?? undefined}>
          <Input mono type="text" inputMode="email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="user@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
        </Field>
        {/* No list at all where there is nothing to hand out: roles are assigned after joining. */}
        {assignable.length > 0 && (
          <Field label={<>Roles <span className="muted">(optional · given when they accept)</span></>}>
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
      </FormGrid>
    </Drawer>
  );
}
