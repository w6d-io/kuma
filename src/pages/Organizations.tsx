import { useState, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Drawer, EmptyHint, MultiSelectPills, ConfirmDialog } from '../components/ui/Primitives';
import { kratosToUser } from '../api/transforms';
import {
  useMyOrganizations,
  useOrgServiceMap,
  useSetOrgServiceBundle,
  useDeleteOrgServiceMapping,
  useOrgUsers,
  useAssignableGroups,
  useOrgAdminMap,
  useSetOrgAdmins,
  useSession,
} from '../api/hooks';
import { InviteDrawer } from './OrgAdmin';

// The Organizations hub — the super_admin's platform-level view of EVERY
// tenant, as opposed to the delegated "Org Admin" tab (a member's self-service
// view of only the orgs they administer). Organizations aren't a first-class
// entity in jinbe; they're implied by the org→service BUNDLE map + the org ids
// identities carry, and /me/organizations returns that union for a super_admin.
//
// Each org bundles a SET of services (J14 org-service entitlement model): its
// people can be granted roles from any service in the bundle. Setup used to be
// scattered — Settings (org→service map), Groups (make an admin group), Users
// (set organization_id), Org Admin (invite). This nests it: pick an org, see
// its bundle + people, bundle/invite/grant from one place.

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
        <div className="sub">Every tenant, its service bundle and its people — in one place{orgs ? ` · ${orgs.length} org${orgs.length === 1 ? '' : 's'}` : ''}</div>
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
            No organizations yet. Create one to bundle services for a tenant and invite its first admin.
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
        {/* Left rail — one row per org, with a bundle summary */}
        <div className="panel" style={{ padding: 0 }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
            <input className="input" placeholder="Search organizations…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%' }} />
          </div>
          {filtered.map((o, i) => {
            const svcs = orgServiceMap[o] ?? [];
            const on = o === activeOrg;
            return (
              <button key={o} onClick={() => setSel(o)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: i < filtered.length - 1 ? '1px solid var(--line)' : 'none', background: on ? 'var(--panel-2)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', gap: 9, alignItems: 'center' }}>
                <span style={{ color: svcs.length ? 'var(--ink-3)' : 'var(--warn)', flexShrink: 0, display: 'grid', placeItems: 'center', width: 15, height: 15 }}>{svcs.length ? I.globe : I.alert}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontWeight: on ? 600 : 500, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>{o}</div>
                  <div className="small muted mt-4">
                    {svcs.length
                      ? <>{svcs.length} service{svcs.length === 1 ? '' : 's'} bundled</>
                      : <span style={{ color: 'var(--warn)' }}>no services bundled</span>}
                  </div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && <EmptyHint>No match.</EmptyHint>}
        </div>

        {/* Right — selected org */}
        <div style={{ minWidth: 0 }}>
          {activeOrg && <OrgDetail key={activeOrg} org={activeOrg} services={orgServiceMap[activeOrg] ?? []} />}
        </div>
      </div>

      {newOrgOpen && <NewOrgDrawer onClose={() => setNewOrgOpen(false)} onDone={(o) => { setNewOrgOpen(false); orgsQ.refetch(); setSel(o); }} />}
    </>
  );
}

function OrgDetail({ org, services }: { org: string; services: string[] }) {
  const { setGrant, pushToast } = useApp();
  const { data: session } = useSession();
  const actorIsSuperAdmin = (session?.roles || []).includes('super_admin');
  const usersQ = useOrgUsers(org);
  const assignableQ = useAssignableGroups(org);
  const assignable = useMemo(() => assignableQ.data ?? [], [assignableQ.data]);
  const { data: orgAdminMap = {} } = useOrgAdminMap();
  const roster = orgAdminMap[org] ?? [];
  const delBundle = useDeleteOrgServiceMapping();
  const [invite, setInvite] = useState(false);
  const [editBundle, setEditBundle] = useState(false);
  const [editAdmins, setEditAdmins] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const users = usersQ.data?.data ?? [];
  const total = usersQ.data?.total ?? users.length;
  const hasBundle = services.length > 0;
  const memberEmails = users.map(u => u.traits?.email).filter((e): e is string => !!e);

  const clearBundle = () => {
    delBundle.mutate(org, {
      onSuccess: () => { pushToast(`Cleared services for ${org}`); setConfirmClear(false); },
      onError: (e: unknown) => pushToast((e as Error).message || 'Failed to clear bundle', { err: true }),
    });
  };

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 className="row" style={{ gap: 8 }}>
            <span className="mono">{org}</span>
            {!hasBundle && <Chip tone="warn" title="No services bundled — members can't be granted service roles here yet">unmapped</Chip>}
          </h3>
          <div className="sub">{total} member{total === 1 ? '' : 's'}{hasBundle ? <> · {services.length} service{services.length === 1 ? '' : 's'} bundled</> : ''}</div>
        </div>
        <button className="btn primary" onClick={() => setInvite(true)}>
          <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.plus}</span> Invite person
        </button>
      </div>

      {/* Service bundle — the setup step that makes an org administrable */}
      <div className="panel mb-12" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 12.5 }}>Service bundle</div>
            <div className="small muted" style={{ marginTop: 2 }}>
              {hasBundle
                ? <>This org's people can be granted roles from the services below.</>
                : <>Bundle one or more services to make their roles assignable to this org's people.</>}
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {hasBundle
                ? services.map(s => <Chip key={s} tone="ok">{s}</Chip>)
                : <span className="small" style={{ color: 'var(--warn)' }}>no services bundled</span>}
            </div>
          </div>
          <button className="btn ghost sm" onClick={() => setEditBundle(true)}>{hasBundle ? 'Edit services' : 'Bundle services'}</button>
        </div>
      </div>

      {/* Administrators — the org's per-org admin roster (data.org_admin_map). An
          admin manages this org's members, scoped to its bundle. Assigning is
          super_admin-only + step-up gated (enforced by jinbe). */}
      <div className="panel mb-12" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 12.5 }}>Administrators</div>
            <div className="small muted" style={{ marginTop: 2 }}>
              People who can manage this org's members (scoped to its bundle). Only super_admins can change this.
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {roster.length === 0
                ? <span className="small muted">No admins yet — nobody can manage this org's members.</span>
                : roster.map(a => <Chip key={a} tone="accent">{a}</Chip>)}
            </div>
          </div>
          {actorIsSuperAdmin && (
            <button className="btn ghost sm" onClick={() => setEditAdmins(true)}>{roster.length ? 'Edit admins' : 'Add admins'}</button>
          )}
        </div>
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
                        <div style={{ fontWeight: 500 }}>{u.traits?.name || u.traits?.email}{roster.includes(u.traits?.email || '') && <> <Chip tone="accent" title="Administrator of this organization">admin</Chip></>}{u.state !== 'active' && <> <Chip tone="warn">inactive</Chip></>}</div>
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

      {editBundle && (
        <BundleDrawer
          org={org}
          current={services}
          onClose={() => setEditBundle(false)}
          onRequestClear={() => { setEditBundle(false); setConfirmClear(true); }}
        />
      )}

      {editAdmins && (
        <AdminsDrawer
          org={org}
          current={roster}
          members={memberEmails}
          onClose={() => setEditAdmins(false)}
        />
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Clear service bundle?"
        danger
        confirmLabel="Clear bundle"
        busy={delBundle.isPending}
        body={<>Org admins for <span className="mono">{org.slice(0, 8)}…</span> will lose the ability to grant service roles here, and delegated group assignment will stop working for this organization until you bundle a service again.</>}
        onCancel={() => setConfirmClear(false)}
        onConfirm={clearBundle}
      />
    </>
  );
}

// The org→service bundle editor. A PUT replaces the org's ENTIRE bundle with the
// selected set (jinbe requires >=1), seeded from the current bundle so a save is
// a deliberate replace, never an accidental clobber. Clearing the bundle is a
// separate DELETE (handled by the caller's ConfirmDialog) so an empty PUT — which
// jinbe would reject — is never attempted.
function BundleDrawer({ org, current, onClose, onRequestClear }: {
  org: string; current: string[]; onClose: () => void; onRequestClear: () => void;
}) {
  const { state, pushToast } = useApp();
  const setBundle = useSetOrgServiceBundle();
  // Mapping an org to the virtual "global" service is meaningless — exclude it.
  const svcOptions = state.services.map(s => s.name).filter(n => n !== 'global');
  const [selected, setSelected] = useState<string[]>(current);
  const busy = setBundle.isPending;
  const valid = selected.length > 0;
  const dirty = selected.length !== current.length || selected.some(s => !current.includes(s));

  const toggle = (svc: string) =>
    setSelected(prev => (prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]));

  const save = () => {
    if (!valid || !dirty || busy) return;
    setBundle.mutate({ organizationId: org, services: selected }, {
      onSuccess: () => { pushToast(`Updated services for ${org}`, { sub: `${selected.length} service${selected.length === 1 ? '' : 's'} bundled` }); onClose(); },
      onError: (e: unknown) => pushToast((e as Error).message || 'Failed to update bundle', { err: true }),
    });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      eyebrow="PUT /api/admin/rbac/org-service-map"
      title="Edit service bundle"
      footer={
        <>
          {current.length > 0
            ? <button className="btn danger sm" onClick={onRequestClear} disabled={busy}><span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.trash}</span> Clear bundle</button>
            : <div />}
          <div className="row">
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={!valid || !dirty || busy}>{busy ? 'Saving…' : 'Save bundle'}</button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <div className="input-label">Organization</div>
        <div className="mono" style={{ fontSize: 12.5 }}>{org}</div>
      </div>
      {selected.length === 0 && (
        <div className="panel mb-12" style={{ padding: 10, background: 'var(--warn-soft, #422)', border: '1px solid var(--warn, #d97706)', color: 'var(--warn, #d97706)' }}>
          <div style={{ fontWeight: 500, fontSize: 12.5 }}>No services selected</div>
          <div className="small" style={{ marginTop: 4 }}>
            Pick at least one service to save. To remove the org's entire bundle, use <strong>Clear bundle</strong> instead.
          </div>
        </div>
      )}
      <label className="input-label">Services in this bundle</label>
      <div className="panel" style={{ padding: 12 }}>
        <MultiSelectPills
          options={svcOptions}
          selected={selected}
          onToggle={toggle}
          empty="No services defined yet — create one under Services first."
        />
      </div>
      <div className="input-hint" style={{ marginTop: 8 }}>Saving replaces the org's entire bundle with the selected services.</div>
    </Drawer>
  );
}

// The org admin ROSTER editor (data.org_admin_map). A PUT replaces the org's
// ENTIRE roster with the selected emails; an empty roster is allowed (it clears
// the org's admins). super_admin + a recent second factor are enforced by jinbe;
// a stale factor returns 422 reauth_required, handled here with a step-up bounce.
// The picker offers the org's members (you can't administer an org you don't
// belong to — jinbe's manageable_orgs also enforces this), unioned with any
// already-rostered email so a stale entry can still be removed.
function AdminsDrawer({ org, current, members, onClose }: {
  org: string; current: string[]; members: string[]; onClose: () => void;
}) {
  const { pushToast } = useApp();
  const setAdmins = useSetOrgAdmins();
  const options = useMemo(() => [...new Set([...members, ...current])], [members, current]);
  const [selected, setSelected] = useState<string[]>(current);
  const busy = setAdmins.isPending;
  const dirty = selected.length !== current.length || selected.some(a => !current.includes(a));

  const toggle = (email: string) =>
    setSelected(prev => (prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]));

  const save = () => {
    if (!dirty || busy) return;
    setAdmins.mutate({ organizationId: org, admins: selected }, {
      onSuccess: () => { pushToast(`Updated administrators for ${org}`, { sub: `${selected.length} admin${selected.length === 1 ? '' : 's'}` }); onClose(); },
      onError: (e: unknown) => {
        const err = e as Error & { code?: string; details?: { hint?: string } };
        // Step-up (R2): re-verify a recent second factor, then return to retry.
        if (err.code === 'reauth_required') {
          pushToast('Two-factor re-verification required · redirecting to step-up', { err: true, sub: err.details?.hint || err.message });
          const authDomain = (window as any).__AUTH_DOMAIN__;
          if (authDomain) {
            const returnTo = window.location.href;
            setTimeout(() => { window.location.href = `https://${authDomain}/login?aal=aal2&refresh=true&return_to=${encodeURIComponent(returnTo)}`; }, 1500);
          }
          return;
        }
        if (err.code === 'privilege_escalation_blocked' || err.code === 'mfa_required') {
          pushToast(err.message, { err: true, sub: err.details?.hint });
          return;
        }
        pushToast(err.message || 'Failed to update administrators', { err: true });
      },
    });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      eyebrow="PUT /api/admin/rbac/org-admin-map"
      title="Edit administrators"
      footer={
        <>
          <span className="small muted">super_admin + recent 2FA required.</span>
          <div className="row">
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save admins'}</button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <div className="input-label">Organization</div>
        <div className="mono" style={{ fontSize: 12.5 }}>{org}</div>
      </div>
      <label className="input-label">Administrators (org members)</label>
      <div className="panel" style={{ padding: 12 }}>
        <MultiSelectPills
          options={options}
          selected={selected}
          onToggle={toggle}
          empty="No members in this organization yet — invite someone first."
        />
      </div>
      <div className="input-hint" style={{ marginTop: 8 }}>
        Each selected member can manage this org's people (scoped to its service bundle). Saving replaces the entire roster; deselect everyone to remove all admins.
      </div>
    </Drawer>
  );
}

// "Creating" an org = registering an org id → service bundle (the step that
// makes it show up + administrable). People then join by being invited into it
// (their identity gets this organization_id).
function NewOrgDrawer({ onClose, onDone }: { onClose: () => void; onDone: (org: string) => void }) {
  const { state, pushToast } = useApp();
  const setBundle = useSetOrgServiceBundle();
  const [org, setOrg] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const svcOptions = state.services.map(s => s.name).filter(n => n !== 'global');
  const busy = setBundle.isPending;
  const valid = org.trim().length > 0 && selected.length > 0;

  const toggle = (svc: string) =>
    setSelected(prev => (prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]));

  const submit = () => {
    if (!valid || busy) return;
    const id = org.trim();
    setBundle.mutate({ organizationId: id, services: selected }, {
      onSuccess: () => { pushToast(`Created organization ${id}`, { sub: `${selected.length} service${selected.length === 1 ? '' : 's'} bundled` }); onDone(id); },
      onError: (e: unknown) => pushToast((e as Error).message || 'Failed to create organization', { err: true }),
    });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      eyebrow="New organization"
      title="Create organization"
      footer={
        <>
          <span className="small muted">Bundles services to a tenant. Invite its people next.</span>
          <div className="row">
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
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
        <label className="input-label">Services *</label>
        <div className="panel" style={{ padding: 12 }}>
          <MultiSelectPills
            options={svcOptions}
            selected={selected}
            onToggle={toggle}
            empty="No services defined yet — create one under Services first."
          />
        </div>
        <div className="input-hint">Which apps this tenant bundles — their roles become assignable to the org's people.</div>
      </div>
    </Drawer>
  );
}
