import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Drawer, EmptyHint, Switch } from '../components/ui/Primitives';
import { api, type KratosIdentity } from '../api/client';

type PushToast = (msg: string, opts?: { err?: boolean; sub?: string; ttl?: number }) => void;
type ApiErr = Error & { code?: string; status?: number; details?: { hint?: string } };

// Map jinbe's delegation error codes to friendly toasts (mirrors useApplyChange).
function makeToastErr(pushToast: PushToast) {
  return (err: unknown) => {
    const e = err as ApiErr;
    if (e.code === 'mfa_required') {
      pushToast('MFA required · target user has no second factor', { err: true, sub: e.details?.hint || e.message });
      return;
    }
    if (e.code === 'privilege_escalation_blocked') {
      pushToast('Not allowed · that group is outside your delegation', { err: true, sub: e.details?.hint || e.message });
      return;
    }
    if (e.status === 403) {
      pushToast('Not authorized for this organization', { err: true, sub: e.message });
      return;
    }
    pushToast(e.message || 'Request failed', { err: true });
  };
}

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

function InviteDrawer({ org, assignable, onClose, onDone, pushToast }: {
  org: string; assignable: string[]; onClose: () => void; onDone: () => void; pushToast: PushToast;
}) {
  const toastErr = makeToastErr(pushToast);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [groups, setGroups] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (g: string) => setGroups(gs => (gs.includes(g) ? gs.filter(x => x !== g) : [...gs, g]));

  const submit = () => {
    if (!email || busy) return;
    setBusy(true);
    api.createOrgUser(org, {
      email: email.trim(),
      name: name.trim() || undefined,
      sendInvite,
      groups: groups.length ? groups : undefined,
    })
      .then(() => { pushToast(`Invited ${email.trim()}`, { sub: sendInvite ? 'recovery email sent' : undefined }); onDone(); })
      .catch(err => { toastErr(err); setBusy(false); });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={`POST /organizations/${org}/users`}
      title="Invite user"
      footer={
        <>
          <span className="small muted mono">creates a Kratos identity in this org</span>
          <div className="row">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={submit} disabled={!email || busy}>{busy ? 'Inviting…' : 'Invite'}</button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <label className="input-label">Email *</label>
        <input className="input mono" type="email" placeholder="user@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
      </div>
      <div className="mb-12">
        <label className="input-label">Name <span className="muted">(optional)</span></label>
        <input className="input" placeholder="Jane Doe" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="mb-12">
        <label className="input-label">Groups <span className="muted">(optional · only groups you may assign)</span></label>
        <GroupPicker assignable={assignable} checked={groups} toggle={toggle} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Send invite email</div>
          <div className="small muted">Generates a recovery link via Kratos</div>
        </div>
        <Switch on={sendInvite} onChange={setSendInvite} />
      </div>
    </Drawer>
  );
}

function ManageGroupsDrawer({ org, user, assignable, onClose, onDone, pushToast }: {
  org: string; user: KratosIdentity; assignable: string[]; onClose: () => void; onDone: () => void; pushToast: PushToast;
}) {
  const toastErr = makeToastErr(pushToast);
  const current = user.metadata_admin?.groups ?? [];
  // Only the assignable groups are editable; any other group the user already
  // has is shown read-only (the org admin can't grant/revoke outside their set).
  const [groups, setGroups] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);
  const toggle = (g: string) => setGroups(gs => (gs.includes(g) ? gs.filter(x => x !== g) : [...gs, g]));

  const readOnly = current.filter(g => !assignable.includes(g));

  const submit = () => {
    if (busy) return;
    setBusy(true);
    api.setOrgUserGroups(org, user.id, groups)
      .then(() => { pushToast(`Updated groups for ${user.traits?.email}`); onDone(); })
      .catch(err => { toastErr(err); setBusy(false); });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={`PUT /organizations/${org}/users/${user.id}/groups`}
      title={`Manage groups · ${user.traits?.name || user.traits?.email}`}
      footer={
        <>
          <span className="small muted mono">metadata_admin.groups</span>
          <div className="row">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Apply change'}</button>
          </div>
        </>
      }
    >
      <div className="panel mb-12" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Avatar name={user.traits?.name || user.traits?.email} size={36} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500 }}>{user.traits?.name || user.traits?.email}</div>
          <div className="small muted mono">{user.traits?.email}</div>
        </div>
        {user.state !== 'active' && <Chip tone="warn">inactive</Chip>}
      </div>
      <div className="mb-12">
        <label className="input-label">Assignable groups</label>
        <GroupPicker assignable={assignable} checked={groups} toggle={toggle} />
      </div>
      {readOnly.length > 0 && (
        <div className="mb-12">
          <label className="input-label">Other groups <span className="muted">(outside your delegation · read-only)</span></label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{readOnly.map(g => <Chip key={g}>{g}</Chip>)}</div>
        </div>
      )}
    </Drawer>
  );
}

export function OrgAdminPage() {
  const { pushToast } = useApp();
  const toastErr = useMemo(() => makeToastErr(pushToast), [pushToast]);

  const [orgs, setOrgs] = useState<string[] | null>(null); // null = still loading
  const [org, setOrg] = useState('');
  const [users, setUsers] = useState<KratosIdentity[]>([]);
  const [assignable, setAssignable] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [invite, setInvite] = useState(false);
  const [manageUser, setManageUser] = useState<KratosIdentity | null>(null);

  useEffect(() => {
    let alive = true;
    api.myOrganizations()
      .then(list => { if (!alive) return; setOrgs(list); if (list.length) setOrg(list[0]); })
      .catch(err => { if (!alive) return; setOrgs([]); toastErr(err); });
    return () => { alive = false; };
  }, [toastErr]);

  const loadOrg = useCallback((orgId: string, search?: string) => {
    if (!orgId) return;
    setLoading(true);
    Promise.all([
      api.getOrgUsers(orgId, { search: search || undefined }),
      api.getAssignableGroups(orgId),
    ])
      .then(([u, g]) => { setUsers(u.data); setAssignable(g); })
      .catch(toastErr)
      .finally(() => setLoading(false));
  }, [toastErr]);

  useEffect(() => { if (org) loadOrg(org); }, [org, loadOrg]);

  if (orgs === null) {
    return <div className="page-head"><div><h1>Org Admin</h1><div className="sub">loading…</div></div></div>;
  }

  if (orgs.length === 0) {
    return (
      <>
        <div className="page-head"><div><h1>Org Admin</h1><div className="sub">Manage users in organizations you administer</div></div></div>
        <div className="panel" style={{ padding: 40 }}>
          <EmptyHint>You don&apos;t administer any organizations. Ask a super_admin to add you to an org-admin group.</EmptyHint>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Org Admin</h1>
          <div className="sub">Manage users in organizations you administer · {orgs.length} org{orgs.length === 1 ? '' : 's'}</div>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setInvite(true)} disabled={!org}>
            <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.plus}</span>
            Invite user
          </button>
        </div>
      </div>

      <div className="panel">
        <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--line)' }}>
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Organization
            <select className="input mono" style={{ width: 'auto' }} value={org} onChange={e => setOrg(e.target.value)}>
              {orgs.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>{I.search}</span>
            <input
              className="input mono"
              style={{ paddingLeft: 30 }}
              placeholder="Find by exact email…"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') loadOrg(org, q.trim()); }}
            />
          </div>
          <button className="btn" onClick={() => loadOrg(org, q.trim())}>Search</button>
          {q && <button className="btn ghost sm" onClick={() => { setQ(''); loadOrg(org); }}>Clear</button>}
          <div className="flex-1" />
          <span className="small muted mono">{users.length} user{users.length === 1 ? '' : 's'} · {assignable.length} assignable group{assignable.length === 1 ? '' : 's'}</span>
        </div>

        <table className="table">
          <thead><tr><th>Identity</th><th>Groups</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={3} className="small muted" style={{ padding: 16 }}>loading…</td></tr>}
            {!loading && users.length === 0 && <tr><td colSpan={3}><EmptyHint>No users in this organization.</EmptyHint></td></tr>}
            {!loading && users.map(u => {
              const groups = u.metadata_admin?.groups ?? [];
              return (
                <tr key={u.id}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <Avatar name={u.traits?.name || u.traits?.email} />
                      <div>
                        <div style={{ fontWeight: 500 }}>
                          {u.traits?.name || u.traits?.email}
                          {u.state !== 'active' && <> <Chip tone="warn">inactive</Chip></>}
                        </div>
                        <div className="small muted mono">{u.traits?.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {groups.length === 0
                      ? <span className="small muted">— no groups —</span>
                      : <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{groups.map(g => <Chip key={g}>{g}</Chip>)}</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn sm" onClick={() => setManageUser(u)}>Manage groups</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {invite && (
        <InviteDrawer
          org={org}
          assignable={assignable}
          pushToast={pushToast}
          onClose={() => setInvite(false)}
          onDone={() => { setInvite(false); loadOrg(org); }}
        />
      )}
      {manageUser && (
        <ManageGroupsDrawer
          org={org}
          user={manageUser}
          assignable={assignable}
          pushToast={pushToast}
          onClose={() => setManageUser(null)}
          onDone={() => { setManageUser(null); loadOrg(org); }}
        />
      )}
    </>
  );
}
