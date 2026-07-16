import { useState, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Drawer, EmptyHint } from '../components/ui/Primitives';
import { kratosToUser } from '../api/transforms';
import {
  useMyOrganizations,
  useOrgServiceMap,
  useSetOrgServiceMapping,
  useDeleteOrgServiceMapping,
  useOrgUsers,
  useAssignableGroups,
} from '../api/hooks';
import { InviteDrawer } from './OrgAdmin';

// The Organizations hub — the super_admin's platform-level view of EVERY
// tenant, as opposed to the delegated "Org Admin" tab (a member's self-service
// view of only the orgs they administer). Organizations aren't a first-class
// entity in jinbe; they're implied by the org→service map + the org ids
// identities carry, and /me/organizations returns that union for a super_admin.
//
// Setup used to be scattered — Settings (org→service map), Groups (make an
// admin group), Users (set organization_id), Org Admin (invite). This nests it:
// pick an org, see its service + people, map/invite/grant from one place.

export function OrganizationsPage() {
  const orgsQ = useMyOrganizations();
  const { data: orgServiceMap = {} } = useOrgServiceMap();
  const orgs = useMemo(() => (orgsQ.isError ? [] : orgsQ.data ?? null), [orgsQ.isError, orgsQ.data]);

  const [sel, setSel] = useState('');
  const [q, setQ] = useState('');
  const [newOrgOpen, setNewOrgOpen] = useState(false);

  const activeOrg = sel && (orgs ?? []).includes(sel) ? sel : (orgs?.[0] ?? '');
  const filtered = useMemo(
    () => (orgs ?? []).filter(o => !q || o.toLowerCase().includes(q.toLowerCase())),
    [orgs, q],
  );

  const header = (
    <div className="page-head">
      <div>
        <h1>Organizations</h1>
        <div className="sub">Every tenant, its service and its people — in one place{orgs ? ` · ${orgs.length} org${orgs.length === 1 ? '' : 's'}` : ''}</div>
      </div>
      <div className="page-actions">
        <button className="btn primary" onClick={() => setNewOrgOpen(true)}>
          <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.plus}</span> New organization
        </button>
      </div>
    </div>
  );

  if (orgs === null) {
    return <>{header}<div className="panel" style={{ padding: 40, textAlign: 'center' }}><div className="muted small">Loading organizations…</div></div></>;
  }

  if (orgs.length === 0) {
    return (
      <>
        {header}
        <div className="panel" style={{ padding: 40 }}>
          <EmptyHint>
            No organizations yet. Create one to map a service to a tenant and invite its first admin.
          </EmptyHint>
        </div>
        {newOrgOpen && <NewOrgDrawer onClose={() => setNewOrgOpen(false)} onDone={(o) => { setNewOrgOpen(false); orgsQ.refetch(); setSel(o); }} />}
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid" style={{ gridTemplateColumns: '280px 1fr', gap: 14, alignItems: 'start' }}>
        {/* Left rail — one row per org */}
        <div className="panel" style={{ padding: 0 }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
            <input className="input" placeholder="Search organizations…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%' }} />
          </div>
          {filtered.map((o, i) => {
            const svc = orgServiceMap[o];
            const on = o === activeOrg;
            return (
              <button key={o} onClick={() => setSel(o)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: i < filtered.length - 1 ? '1px solid var(--line)' : 'none', background: on ? 'var(--panel-2)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', gap: 9, alignItems: 'center' }}>
                <span style={{ color: svc ? 'var(--ink-3)' : 'var(--warn)', flexShrink: 0, display: 'grid', placeItems: 'center', width: 15, height: 15 }}>{svc ? I.globe : I.alert}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontWeight: on ? 600 : 500, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>{o}</div>
                  <div className="small muted mt-4">
                    {svc ? <>service: <span className="mono">{svc}</span></> : <span style={{ color: 'var(--warn)' }}>no service mapped</span>}
                  </div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && <EmptyHint>No match.</EmptyHint>}
        </div>

        {/* Right — selected org */}
        <div style={{ minWidth: 0 }}>
          {activeOrg && <OrgDetail key={activeOrg} org={activeOrg} service={orgServiceMap[activeOrg]} />}
        </div>
      </div>

      {newOrgOpen && <NewOrgDrawer onClose={() => setNewOrgOpen(false)} onDone={(o) => { setNewOrgOpen(false); orgsQ.refetch(); setSel(o); }} />}
    </>
  );
}

function OrgDetail({ org, service }: { org: string; service?: string }) {
  const { state, setGrant, pushToast } = useApp();
  const usersQ = useOrgUsers(org);
  const assignableQ = useAssignableGroups(org);
  const assignable = useMemo(() => assignableQ.data ?? [], [assignableQ.data]);
  const setMapping = useSetOrgServiceMapping();
  const delMapping = useDeleteOrgServiceMapping();
  const [invite, setInvite] = useState(false);
  const [editSvc, setEditSvc] = useState(false);

  const users = usersQ.data?.data ?? [];
  const total = usersQ.data?.total ?? users.length;
  // Non-global services are the mappable set (mapping an org to the virtual
  // "global" service is meaningless).
  const svcOptions = state.services.map(s => s.name).filter(n => n !== 'global');

  // "Admins" of the org = members holding a group that grants admin power on
  // the mapped service (or globally). Purely derived from the group catalog.
  const isAdminGroup = (g: string): boolean => {
    const map = state.groups[g] || {};
    if ((map.global ?? []).includes('super_admin')) return true;
    const check = (svc: string) => (map[svc] ?? []).some(r => (state.roles[svc]?.[r] ?? []).includes('*'));
    if (check('global')) return true;
    return service ? check(service) : false;
  };
  const admins = users.filter(u => (u.metadata_admin?.groups ?? []).some(isAdminGroup));

  const applyMapping = (svc: string) => {
    setMapping.mutate({ organizationId: org, serviceName: svc }, {
      onSuccess: () => { pushToast(`Mapped ${org} → ${svc}`); setEditSvc(false); },
      onError: (e: unknown) => pushToast((e as Error).message || 'Failed to map service', { err: true }),
    });
  };
  const clearMapping = () => {
    delMapping.mutate(org, {
      onSuccess: () => { pushToast(`Unmapped ${org}`); setEditSvc(false); },
      onError: (e: unknown) => pushToast((e as Error).message || 'Failed to unmap', { err: true }),
    });
  };

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 className="row" style={{ gap: 8 }}>
            <span className="mono">{org}</span>
            {!service && <Chip tone="warn" title="No service mapped — members can't be granted service roles here yet">unmapped</Chip>}
          </h3>
          <div className="sub">{total} member{total === 1 ? '' : 's'}{service ? <> · service <span className="mono">{service}</span></> : ''}</div>
        </div>
        <button className="btn primary" onClick={() => setInvite(true)}>
          <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.plus}</span> Invite person
        </button>
      </div>

      {/* Service mapping — the setup step that makes an org administrable */}
      <div className="panel mb-12" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 12.5 }}>Service</div>
            <div className="small muted" style={{ marginTop: 2 }}>
              {service
                ? <>This org's people are governed by <span className="mono">{service}</span>'s roles.</>
                : <>Map a service to make roles assignable to this org's people.</>}
            </div>
          </div>
          {!editSvc ? (
            <div className="row" style={{ gap: 6 }}>
              {service && <Chip tone="ok">{service}</Chip>}
              <button className="btn ghost sm" onClick={() => setEditSvc(true)}>{service ? 'Change' : 'Map service'}</button>
            </div>
          ) : (
            <div className="row" style={{ gap: 6 }}>
              <select className="input mono" style={{ width: 'auto' }} defaultValue={service ?? ''} onChange={e => e.target.value && applyMapping(e.target.value)}>
                <option value="" disabled>Choose a service…</option>
                {svcOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {service && <button className="btn ghost sm" onClick={clearMapping} style={{ color: 'var(--red, #ef4444)' }}>Unmap</button>}
              <button className="btn ghost sm" onClick={() => setEditSvc(false)}>Cancel</button>
            </div>
          )}
        </div>
      </div>

      {/* Admins summary */}
      <div className="panel mb-12" style={{ padding: 14 }}>
        <div style={{ fontWeight: 500, fontSize: 12.5, marginBottom: 6 }}>Administrators</div>
        {admins.length === 0
          ? <div className="small muted">No member of this org holds an admin group{service ? '' : ' (map a service first)'} — nobody can manage it yet.</div>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{admins.map(a => <Chip key={a.id} tone="accent">{a.traits?.name || a.traits?.email}</Chip>)}</div>}
      </div>

      {/* Members */}
      <div className="panel">
        <div className="panel-head"><div><h3>People</h3><div className="sub">Click a person to grant or change their access</div></div></div>
        <table className="table">
          <thead><tr><th>Identity</th><th>Groups</th><th></th></tr></thead>
          <tbody>
            {usersQ.isLoading && <tr><td colSpan={3} className="small muted" style={{ padding: 16 }}>loading…</td></tr>}
            {!usersQ.isLoading && users.length === 0 && <tr><td colSpan={3}><EmptyHint>No people in this organization yet — invite someone.</EmptyHint></td></tr>}
            {!usersQ.isLoading && users.map(u => {
              const groups = u.metadata_admin?.groups ?? [];
              return (
                <tr key={u.id} className="row-click" onClick={() => setGrant({ user: kratosToUser(u) })}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <Avatar name={u.traits?.name || u.traits?.email} />
                      <div>
                        <div style={{ fontWeight: 500 }}>{u.traits?.name || u.traits?.email}{u.state !== 'active' && <> <Chip tone="warn">inactive</Chip></>}</div>
                        <div className="small muted mono">{u.traits?.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {groups.length === 0
                      ? <span className="small muted">— no groups —</span>
                      : <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{groups.map(g => <Chip key={g}>{g}</Chip>)}</span>}
                  </td>
                  <td style={{ width: 24, textAlign: 'right' }}><span style={{ color: 'var(--ink-4)' }}>{I.chev}</span></td>
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
          onDone={() => { setInvite(false); usersQ.refetch(); }}
        />
      )}
    </>
  );
}

// "Creating" an org = registering an org id → service mapping (the step that
// makes it show up + administrable). People then join by being invited into it
// (their identity gets this organization_id).
function NewOrgDrawer({ onClose, onDone }: { onClose: () => void; onDone: (org: string) => void }) {
  const { state, pushToast } = useApp();
  const setMapping = useSetOrgServiceMapping();
  const [org, setOrg] = useState('');
  const [svc, setSvc] = useState('');
  const svcOptions = state.services.map(s => s.name).filter(n => n !== 'global');
  const busy = setMapping.isPending;
  const valid = org.trim().length > 0 && !!svc;

  const submit = () => {
    if (!valid || busy) return;
    setMapping.mutate({ organizationId: org.trim(), serviceName: svc }, {
      onSuccess: () => { pushToast(`Created organization ${org.trim()} → ${svc}`); onDone(org.trim()); },
      onError: (e: unknown) => pushToast((e as Error).message || 'Failed to create organization', { err: true }),
    });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="New organization"
      title="Create organization"
      footer={
        <>
          <span className="small muted">Maps a tenant to a service. Invite its people next.</span>
          <div className="row">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={submit} disabled={!valid || busy}>{busy ? 'Creating…' : 'Create'}</button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <label className="input-label">Organization ID *</label>
        <input className="input mono" value={org} onChange={e => setOrg(e.target.value)} placeholder="tenant UUID or slug" autoFocus />
        <div className="input-hint">The <span className="mono">organization_id</span> its members carry in Kratos.</div>
      </div>
      <div className="mb-12">
        <label className="input-label">Service *</label>
        <select className="input mono" value={svc} onChange={e => setSvc(e.target.value)}>
          <option value="">Choose a service…</option>
          {svcOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="input-hint">Which app this tenant uses — its roles become assignable to the org's people.</div>
      </div>
    </Drawer>
  );
}
