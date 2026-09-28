import { useState, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { MultiSelectPills } from '../components/ui/Primitives';
import { Avatar, Badge, Button, ButtonBase, Card, ConfirmDialog, Drawer, EmptyHint, EmptyRow, Field, Input, LoadingRows, PageHeader, Table, cx } from '../components/ui';
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
import { AddMember } from './orgadmin/AddMember';
import { CreateOrgDialog, DeleteOrgDialog, EditOrgDialog } from './organizations/OrgDialogs';
import { orgAccessApi } from '../api/orgAccess';
import { toastFor } from '../lib/apiError';
import { ApiErrorState } from '../components/ApiErrorState';
import { PRIVILEGED_MUTATION, permits } from '../policy/model';
import { bounceToStepUp } from '../lib/stepUp';

// The Organizations hub — the platform-level view of EVERY tenant, as opposed to the delegated
// "Org Admin" tab (a member's self-service view of only the orgs they administer). jinbe owns the
// records (the registry: name, tenant, applications) and the memberships (on each identity); this
// screen creates, renames and deletes organisations, sets what they run, and manages their people
// and their administrators in one place.

/** Creating, renaming and deleting organisations — the record, not who belongs to it. */
const ORG_WRITE = 'admin.organisation:write';

export function OrganizationsPage() {
  const { pageParam, setPage, pushToast } = useApp();
  const { data: session } = useSession();
  const mayWrite = permits(session?.permissions, ORG_WRITE);
  const [creating, setCreating] = useState(false);
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
  const tenants = useMemo(
    () => Object.fromEntries((orgsQ.data?.organizations ?? []).map((o) => [o.id, o.tenant])),
    [orgsQ.data],
  );
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

  const createDialog = creating && (
    <CreateOrgDialog
      pushToast={pushToast}
      onClose={() => setCreating(false)}
      onCreated={(org) => { setCreating(false); setSel(org.id); }}
    />
  );

  const header = (
    <PageHeader
      title="Organizations"
      sub={<>Every organization, the sites it runs and its members — in one place{orgs ? ` · ${orgs.length} org${orgs.length === 1 ? '' : 's'}` : ''}</>}
      actions={mayWrite && !orgsQ.isError ? <Button variant="primary" icon={I.plus} onClick={() => setCreating(true)}>Create organization</Button> : undefined}
    />
  );

  // Refused or unreachable is not "none": the list is empty only when the directory says so. With no
  // organisation database at all, this says what to set rather than offering a retry.
  if (orgsQ.isError) {
    return <>{header}<ApiErrorState error={orgsQ.error} what="organizations" onRetry={() => orgsQ.refetch()} /></>;
  }

  if (orgs === null) {
    return <>{header}<Card className="p-32 text-center"><div className="muted small">Loading organizations…</div></Card></>;
  }

  if (orgs.length === 0) {
    return (
      <>
        {header}
        <Card className="p-32">
          <EmptyHint>
            {mayWrite
              ? <>No organization yet. Create one, then add its people and choose its administrators.</>
              : <>No organization yet. Somebody who may manage organizations can create one.</>}
          </EmptyHint>
          {mayWrite && (
            <div className="row justify-center mt-12">
              <Button variant="primary" icon={I.plus} onClick={() => setCreating(true)}>Create organization</Button>
            </div>
          )}
        </Card>
        {createDialog}
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
          {activeOrg && (
            <OrgDetail
              key={activeOrg}
              org={activeOrg}
              name={names[activeOrg]}
              tenant={tenants[activeOrg]}
              services={applications[activeOrg] ?? []}
              mayWrite={mayWrite}
              onDeleted={() => setPage('organizations', null)}
            />
          )}
        </div>
      </div>
      {createDialog}

    </>
  );
}

function OrgDetail({ org, name, tenant, services, mayWrite, onDeleted }: {
  org: string; name?: string; tenant?: string; services: string[]; mayWrite: boolean; onDeleted: () => void;
}) {
  const { setUserDrawer, pushToast, setPage } = useApp();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState<{ id: string; label: string } | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);
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
          {mayWrite && <Button size="sm" variant="ghost" icon={I.edit} onClick={() => setEditing(true)}>Edit</Button>}
          {mayWrite && <Button size="sm" variant="ghost" icon={I.trash} onClick={() => setDeleting(true)}>Delete</Button>}
          <Button size="sm" onClick={() => setPage('apikeys', org)}>API keys</Button>
          <Button size="sm" variant="primary" icon={I.plus} onClick={() => setInvite(true)}>Invite person</Button>
        </div>
      </div>

      {/* What this organisation runs, from the directory. Changed with Edit, as a whole set. */}
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
        <div className="p-12 border-b">
          <AddMember org={org} orgName={name ?? org} pushToast={pushToast} />
        </div>
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
                  <td className="org-chev-cell text-right">
                    <span className="row gap-4 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${u.traits?.email ?? u.id} from this organization`}
                        onClick={(e) => { e.stopPropagation(); setLeaving({ id: u.id, label: u.traits?.name || u.traits?.email || u.id }); }}
                      >Remove</Button>
                      <span className="text-disabled">{I.chev}</span>
                    </span>
                  </td>
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

      {editing && (
        <EditOrgDialog org={org} name={name} tenant={tenant} applications={services} pushToast={pushToast} onClose={() => setEditing(false)} />
      )}

      {deleting && (
        <DeleteOrgDialog
          org={org}
          name={name}
          members={total}
          pushToast={pushToast}
          onClose={() => setDeleting(false)}
          onDeleted={() => { setDeleting(false); onDeleted(); }}
        />
      )}

      {leaving && (
        <ConfirmDialog
          open
          danger
          title={`Remove ${leaving.label} from ${name ?? org}?`}
          body="Only this organization: their account, their other organizations and their site access stay."
          confirmLabel="Remove from organization"
          busy={leaveBusy}
          onCancel={() => setLeaving(null)}
          onConfirm={async () => {
            setLeaveBusy(true);
            try {
              await orgAccessApi.removeFromOrg(org, leaving.id);
              pushToast(`Removed ${leaving.label}`, { sub: 'Their other organizations and site access are unchanged.' });
              setLeaving(null);
              usersQ.refetch();
            } catch (e) {
              pushToast(...toastFor(e));
            } finally {
              setLeaveBusy(false);
            }
          }}
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

