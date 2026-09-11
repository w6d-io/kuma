import { useState, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Drawer, EmptyHint, MultiSelectPills } from '../components/ui/Primitives';
import { kratosToUser } from '../api/transforms';
import {
  useAllOrganizations,
  useOrgUsers,
  useAssignableGroups,
  useOrgAdminMap,
  useSetOrgAdmins,
  useSession,
} from '../api/hooks';
import { InviteDrawer } from './OrgAdmin';
import { PRIVILEGED_MUTATION, permits } from '../policy/model';
import { bounceToStepUp } from '../lib/stepUp';

// The Organizations hub — the platform-level view of EVERY
// tenant, as opposed to the delegated "Org Admin" tab (a member's self-service
// view of only the orgs they administer). Organizations aren't a first-class
// entity in jinbe; they're implied by the org→service BUNDLE map + the org ids
// identities carry; /admin/organizations answers the platform-wide question.
//
// Each org bundles a SET of services (J14 org-service entitlement model): its
// people can be granted roles from any service in the bundle. Setup used to be
// scattered — Settings (org→service map), Groups (make an admin group), Users
// (set organization_id), Org Admin (invite). This nests it: pick an org, see
// its bundle + people, bundle/invite/grant from one place.

export function OrganizationsPage() {
  // EVERY organisation, from the route that answers that question and refuses when the caller may
  // not ask it. This page used to call `/me/organizations`, which widened to everything for an
  // administrator and returned only theirs otherwise — the same call meaning two different things.
  const orgsQ = useAllOrganizations();
  const names = useMemo(
    () => Object.fromEntries((orgsQ.data?.organizations ?? []).map((o) => [o.id, o.name])),
    [orgsQ.data],
  );
  // Which applications each organisation actually has, from the directory that records them. This
  // page read a map from Redis that nothing populates any more, so it reported "no services bundled"
  // for all eight — while `organisation_deployments` held the answer the whole time.
  const applications = useMemo(
    () => Object.fromEntries((orgsQ.data?.organizations ?? []).map((o) => [o.id, o.applications ?? []])),
    [orgsQ.data],
  );
  const orgs = useMemo(
    () => (orgsQ.isError ? [] : orgsQ.data ? orgsQ.data.organizations.map((o) => o.id) : null),
    [orgsQ.isError, orgsQ.data],
  );

  const [sel, setSel] = useState('');
  const [q, setQ] = useState('');

  const activeOrg = sel && (orgs ?? []).includes(sel) ? sel : (orgs?.[0] ?? '');
  const filtered = useMemo(
    () => (orgs ?? []).filter(o => !q || o.toLowerCase().includes(q.toLowerCase())),
    [orgs, q],
  );

  const header = (
    <div className="page-head">
      <div>
        <h1>Organizations</h1>
        <div className="sub">Every tenant, what it runs and its people — in one place{orgs ? ` · ${orgs.length} org${orgs.length === 1 ? '' : 's'}` : ''}</div>
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
            The directory records no organization. They are provisioned elsewhere, not created here.
          </EmptyHint>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="list-detail">
        {/* Left rail — one row per org, with a bundle summary */}
        <div className="panel" style={{ padding: 0 }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
            <input className="input" placeholder="Search organizations…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%' }} />
          </div>
          {filtered.map((o, i) => {
            const svcs = applications[o] ?? [];
            const on = o === activeOrg;
            return (
              <button key={o} onClick={() => setSel(o)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: i < filtered.length - 1 ? '1px solid var(--line)' : 'none', background: on ? 'var(--panel-2)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', gap: 9, alignItems: 'center' }}>
                <span style={{ color: 'var(--ink-3)', flexShrink: 0, display: 'grid', placeItems: 'center', width: 15, height: 15 }}>{I.globe}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* The name when the directory knows it, the identifier when it does not — worse to
                      read, still correct, and never a guess. A list of raw UUIDs is unreadable, and
                      three of the eight here do carry a name nobody was showing. */}
                  <div
                    className={names[o] ? '' : 'mono'}
                    style={{ fontWeight: on ? 600 : 500, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {names[o] ?? o}
                  </div>
                  {names[o] && (
                    <div className="small muted mono" style={{ overflowWrap: 'anywhere' }}>{o}</div>
                  )}
                  <div className="small muted mt-4">
                    {svcs.length > 0
                      ? <>{svcs.join(' · ')}</>
                      /* Not a warning: an organisation running nothing is a fact about a tenant,
                         not a setup step somebody forgot. */
                      : <span className="muted">no applications</span>}
                  </div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && <EmptyHint>No match.</EmptyHint>}
        </div>

        {/* Right — selected org */}
        <div style={{ minWidth: 0 }}>
          {activeOrg && <OrgDetail key={activeOrg} org={activeOrg} services={applications[activeOrg] ?? []} />}
        </div>
      </div>

    </>
  );
}

function OrgDetail({ org, services }: { org: string; services: string[] }) {
  const { setGrant, pushToast } = useApp();
  const { data: session } = useSession();
  // The permission the mutation checks, not a role NAME. `super_admin` is not a role this model
  // defines, so this test was false for everybody and greyed the control for its only holders.
  const mayAdminister = permits(session?.permissions, PRIVILEGED_MUTATION);
  const usersQ = useOrgUsers(org);
  const assignableQ = useAssignableGroups(org);
  const assignable = useMemo(() => assignableQ.data ?? [], [assignableQ.data]);
  const { data: orgAdminMap = {} } = useOrgAdminMap();
  const roster = orgAdminMap[org] ?? [];
  const [invite, setInvite] = useState(false);
  const [editAdmins, setEditAdmins] = useState(false);

  const users = usersQ.data?.data ?? [];
  const total = usersQ.data?.total ?? users.length;
  const hasBundle = services.length > 0;
  const memberEmails = users.map(u => u.traits?.email).filter((e): e is string => !!e);

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

      {/* What this organisation runs. A record of the directory, not a setting of this console: it
          changes when a deployment is provisioned or turned off, which is not something to edit here. */}
      <div className="panel mb-12" style={{ padding: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 12.5 }}>Applications</div>
          <div className="small muted" style={{ marginTop: 2 }}>
            {hasBundle
              ? <>What this organisation runs, from <span className="mono">organisation_deployments</span>. Only what is enabled.</>
              : <>This organisation runs nothing that the directory records.</>}
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {hasBundle
              ? services.map(s => <Chip key={s} tone="ok">{s}</Chip>)
              : <span className="small muted">none</span>}
          </div>
        </div>
      </div>

      {/* Administrators — the org's per-org admin roster (data.org_admin_map). An
          admin manages this org's members, scoped to its bundle. Assigning is
          Gated on admin.membership:write plus a recent second factor, enforced by jinbe. */}
      <div className="panel mb-12" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 12.5 }}>Administrators</div>
            <div className="small muted" style={{ marginTop: 2 }}>
              People who can manage this org's members (scoped to its bundle). Changing it needs admin.membership:write.
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {roster.length === 0
                ? <span className="small muted">No admins yet — nobody can manage this org's members.</span>
                : roster.map(a => <Chip key={a} tone="accent">{a}</Chip>)}
            </div>
          </div>
          {mayAdminister && (
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

      {editAdmins && (
        <AdminsDrawer
          org={org}
          current={roster}
          members={memberEmails}
          onClose={() => setEditAdmins(false)}
        />
      )}

    </>
  );
}

// The org admin ROSTER editor (data.org_admin_map). A PUT replaces the org's
// ENTIRE roster with the selected emails; an empty roster is allowed (it clears
// the org's admins). admin.membership:write + a recent second factor are enforced by jinbe;
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
          pushToast('Two-factor re-verification required', { err: true, sub: 'You will be sent to re-verify your second factor, then back here to retry. This is not a sign-out.' });
          bounceToStepUp();
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
          <span className="small muted">Needs admin.membership:write and a recent second factor.</span>
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

