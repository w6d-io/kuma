import { useState, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { MultiSelectPills } from '../components/ui/Primitives';
import { Avatar, Badge, Button, ButtonBase, Card, Drawer, EmptyHint, EmptyRow, Field, Input, LoadingRows, PageHeader, Table, cx } from '../components/ui';
import { kratosToUser } from '../api/transforms';
import {
  useAllOrganizations,
  useOrgUsers,
  useAssignableGroups,
  useOrgAdminMap,
  useSetOrgAdmins,
  useSession,
} from '../api/hooks';
import { InviteDrawer } from './orgadmin/InviteDrawer';
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
  const { pageParam, setPage } = useApp();
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

  // The selected organisation is the address (`#/organizations/<id>`), so it can be linked to.
  const sel = pageParam ?? '';
  const setSel = (o: string) => setPage('organizations', o);
  const [q, setQ] = useState('');

  const activeOrg = sel && (orgs ?? []).includes(sel) ? sel : (orgs?.[0] ?? '');
  const filtered = useMemo(
    () => (orgs ?? []).filter(o => !q || o.toLowerCase().includes(q.toLowerCase()) || (names[o] ?? '').toLowerCase().includes(q.toLowerCase())),
    [orgs, q, names],
  );

  const header = (
    <PageHeader
      title="Organizations"
      sub={<>Every organization, the sites it runs and its members — in one place{orgs ? ` · ${orgs.length} org${orgs.length === 1 ? '' : 's'}` : ''}</>}
    />
  );

  if (orgs === null) {
    return <>{header}<Card className="p-32 text-center"><div className="muted small">Loading organizations…</div></Card></>;
  }

  if (orgs.length === 0) {
    return (
      <>
        {header}
        <Card className="p-32">
          <EmptyHint>
            The directory records no organization. They are provisioned elsewhere, not created here.
          </EmptyHint>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="list-detail">
        {/* Left rail — one row per org, with a bundle summary */}
        <Card>
          <div className="p-8 border-b">
            <Input placeholder="Search organizations…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {filtered.map((o) => {
            const svcs = applications[o] ?? [];
            const on = o === activeOrg;
            return (
              <ButtonBase key={o} onClick={() => setSel(o)} className={cx('org-rail-item', on && 'on')}>
                <span className="icon muted">{I.globe}</span>
                <div className="flex-1 min-w-0">
                  {/* The name when the directory knows it, the identifier when it does not — worse to
                      read, still correct, and never a guess. A list of raw UUIDs is unreadable, and
                      three of the eight here do carry a name nobody was showing. */}
                  <div className={cx('org-rail-name text-base', on ? 'fw-semibold' : 'fw-medium', !names[o] && 'mono')}>
                    {names[o] ?? o}
                  </div>
                  {names[o] && (
                    <div className="small muted mono break-anywhere">{o}</div>
                  )}
                  <div className="small muted mt-4">
                    {svcs.length > 0
                      ? <>{svcs.join(' · ')}</>
                      /* Not a warning: an organisation running nothing is a fact about a tenant,
                         not a setup step somebody forgot. */
                      : <span className="muted">no applications</span>}
                  </div>
                </div>
              </ButtonBase>
            );
          })}
          {filtered.length === 0 && <EmptyHint>No match.</EmptyHint>}
        </Card>

        {/* Right — selected org */}
        <div className="min-w-0">
          {activeOrg && <OrgDetail key={activeOrg} org={activeOrg} name={names[activeOrg]} services={applications[activeOrg] ?? []} />}
        </div>
      </div>

    </>
  );
}

function OrgDetail({ org, name, services }: { org: string; name?: string; services: string[] }) {
  const { setUserDrawer, pushToast, setPage } = useApp();
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
      <div className="panel-head mb-12">
        <div className="min-w-0">
          <h3 className="row gap-8">
            <span className={name ? '' : 'mono'}>{name ?? org}</span>
            {!hasBundle && <Badge tone="warning" title="Runs no site yet — members can't be given site roles here">no sites</Badge>}
          </h3>
          <div className="sub">
            {total} member{total === 1 ? '' : 's'}{hasBundle ? <> · {services.length} site{services.length === 1 ? '' : 's'}</> : ''}
            {name && <> · <span className="mono">{org}</span></>}
          </div>
        </div>
        <div className="row gap-8">
          <Button size="sm" onClick={() => setPage('apikeys', org)}>API keys</Button>
          <Button size="sm" variant="primary" icon={I.plus} onClick={() => setInvite(true)}>Invite person</Button>
        </div>
      </div>

      {/* What this organisation runs. A record of the directory, not a setting of this console: it
          changes when a deployment is provisioned or turned off, which is not something to edit here. */}
      <Card pad="md" className="mb-12">
        <div className="min-w-0">
          <div className="fw-medium text-base">Applications</div>
          <div className="small muted mt-2">
            {hasBundle
              ? <>The sites this organization runs. Only what is enabled.</>
              : <>This organisation runs nothing that the directory records.</>}
          </div>
          <div className="row wrap gap-4 mt-8">
            {hasBundle
              ? services.map(s => <Badge key={s} tone="success">{s}</Badge>)
              : <span className="small muted">none</span>}
          </div>
        </div>
      </Card>

      {/* Administrators — the org's per-org admin roster (data.org_admin_map). An
          admin manages this org's members, scoped to its bundle. Assigning is
          Gated on admin.membership:write plus a recent second factor, enforced by jinbe. */}
      <Card pad="md" className="mb-12">
        <div className="row justify-between items-start gap-12">
          <div className="min-w-0 flex-1">
            <div className="fw-medium text-base">Administrators</div>
            <div className="small muted mt-2">
              Org admins manage this organization's members, within the sites it runs. Changing them needs permission to manage members.
            </div>
            <div className="row wrap gap-4 mt-8">
              {roster.length === 0
                ? <span className="small muted">No admins yet — nobody can manage this org's members.</span>
                : roster.map(a => <Badge key={a} tone="accent">{a}</Badge>)}
            </div>
          </div>
          {mayAdminister && (
            <Button variant="ghost" size="sm" onClick={() => setEditAdmins(true)}>{roster.length ? 'Edit admins' : 'Add admins'}</Button>
          )}
        </div>
      </Card>

      {/* Members */}
      <Card title="People" sub="Click a person to see their site and org access" pad="none">
        <Table>
          <thead><tr><th>Identity</th><th>Groups</th><th></th></tr></thead>
          <tbody>
            {usersQ.isLoading && <LoadingRows rows={4} cols={3} />}
            {!usersQ.isLoading && users.length === 0 && <EmptyRow colSpan={3}><EmptyHint>No people in this organization yet — invite someone.</EmptyHint></EmptyRow>}
            {!usersQ.isLoading && users.map(u => {
              const groups = u.metadata_admin?.groups ?? [];
              return (
                <tr key={u.id} className="row-click" onClick={() => setUserDrawer({ mode: 'edit', user: kratosToUser(u) })}>
                  <td>
                    <div className="row gap-8">
                      <Avatar name={u.traits?.name || u.traits?.email} />
                      <div>
                        <div className="fw-medium">{u.traits?.name || u.traits?.email}{roster.includes(u.traits?.email || '') && <> <Badge tone="accent" title="Administrator of this organization">admin</Badge></>}{u.state !== 'active' && <> <Badge tone="warning">inactive</Badge></>}</div>
                        <div className="small muted mono">{u.traits?.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {groups.length === 0
                      ? <span className="small muted">— no groups —</span>
                      : <span className="row wrap gap-4">{groups.map(g => <Badge key={g}>{g}</Badge>)}</span>}
                  </td>
                  <td className="org-chev-cell text-right"><span className="text-disabled">{I.chev}</span></td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

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
          name={name}
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
function AdminsDrawer({ org, name, current, members, onClose }: {
  org: string; name?: string; current: string[]; members: string[]; onClose: () => void;
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
      eyebrow="Org admins"
      title="Edit administrators"
      footer={
        <>
          <span className="small muted">Needs permission to manage members and a recent second factor.</span>
          <div className="row">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save admins'}</Button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <div className="input-label">Organization</div>
        <div className={cx('text-base', !name && 'mono')}>{name ?? org}</div>
      </div>
      <Field
        label="Administrators (org members)"
        hint="Each selected member becomes an org admin and can manage this organization's people, within the sites it runs. Saving replaces the whole list; deselect everyone to remove all org admins."
      >
        <Card pad="sm">
          <MultiSelectPills
            options={options}
            selected={selected}
            onToggle={toggle}
            empty="No members in this organization yet — invite someone first."
          />
        </Card>
      </Field>
    </Drawer>
  );
}

