import { useState } from 'react';
import { Drawer, EmptyHint, Switch } from '../../components/ui/Primitives';
import { makeToastErr, type PushToast } from './toastErr';
import { useCreateOrgUser } from '../../api/hooks';

/** Checkbox list limited to the caller's assignable groups (never the full catalog). */
function GroupPicker({ assignable, checked, toggle }: { assignable: string[]; checked: string[]; toggle: (g: string) => void }) {
  if (assignable.length === 0) {
    return <EmptyHint>No groups you may assign here — the user keeps base access.</EmptyHint>;
  }
  return (
    <div className="panel" style={{ padding: 0 }}>
      {assignable.map((g, i) => {
        const on = checked.includes(g);
        return (
          <label
            key={g}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              borderBottom: i < assignable.length - 1 ? '1px solid var(--line)' : 'none',
              cursor: 'pointer', background: on ? 'var(--accent-soft)' : 'transparent',
            }}
          >
            <input type="checkbox" checked={on} onChange={() => toggle(g)} />
            <span style={{ fontWeight: 500, fontSize: 12.5 }}>{g}</span>
          </label>
        );
      })}
    </div>
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
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={submit} disabled={!email || busy}>{busy ? 'Inviting…' : 'Invite'}</button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <label className="input-label">Email *</label>
        <input className="input mono" type="text" inputMode="email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="user@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
      </div>
      <div className="mb-12">
        <label className="input-label">Name <span className="muted">(optional)</span></label>
        <input className="input" placeholder="Jane Doe" value={name} onChange={e => setName(e.target.value)} />
      </div>
      {/* No list at all where there is nothing to hand out on invite: My org grants after joining. */}
      {assignable.length > 0 && (
        <div className="mb-12">
          <label className="input-label">Groups <span className="muted">(optional · only groups you may assign)</span></label>
          <GroupPicker assignable={assignable} checked={groups} toggle={toggle} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Send invite email</div>
          <div className="small muted">Emails them a link to set their password</div>
        </div>
        <Switch on={sendInvite} onChange={setSendInvite} />
      </div>
    </Drawer>
  );
}
