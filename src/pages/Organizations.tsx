import { useEffect, useRef, useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { MultiSelectPills } from '../components/ui/Primitives';
import { Badge, Button, ButtonBase, Card, Drawer, EmptyHint, Field, Input, PageHeader, cx } from '../components/ui';
import { useAllOrganizations, useOrgUsers, useSession } from '../api/hooks';
import { useMyOrgPermissions, useOrgMemberRoles, useOrgRoles } from '../api/orgRoles';
import { OrgMembers } from './orgadmin/OrgMembers';
import { CreateOrgDialog, DeleteOrgDialog, EditOrgDialog } from './organizations/OrgDialogs';
import { orgAccessApi, OWNER_ROLE } from '../api/orgAccess';
import { entitledSites, ownersOf } from '../lib/orgRoles';
import { toastFor } from '../lib/apiError';
import { ApiErrorState } from '../components/ApiErrorState';
import { holds, holdsIn } from '../policy/model';
import { stepUpAndResume, useResume } from '../lib/resume';

// The Organizations hub — the platform-level view of EVERY tenant, as opposed to "My org" (one
// organization from the inside). jinbe owns the records (name, tenant), the memberships and the org
// roles; this screen creates, renames and deletes organisations, names their owners, and shows their
// people and roles in one place. Which sites an organization may use is each site's intent, shown here
// read-only. Each control asks the permission its route declares, exactly.

export function OrganizationsPage() {
  const { pageParam, setPage, pushToast } = useApp();
  const { data: session } = useSession();
  const mayWrite = holds(session, 'orgs:write');
  const mayDelete = holds(session, 'orgs:delete');
  const [creating, setCreating] = useState(false);
  // EVERY organisation, from the route that answers that question and refuses when the caller may
  // not ask it. This page used to call `/me/organizations`, which widened to everything for an
  // administrator and returned only theirs otherwise — the same call meaning two different things.
  const orgsQ = useAllOrganizations();
  const names = useMemo(
    () => Object.fromEntries((orgsQ.data?.organizations ?? []).map((o) => [o.id, o.name])),
    [orgsQ.data],
  );
  const owners = useMemo(
    () => Object.fromEntries((orgsQ.data?.organizations ?? []).map((o) => [o.id, o.owners])),
    [orgsQ.data],
  );
  const entitled = useMemo(
    () => Object.fromEntries((orgsQ.data?.organizations ?? []).map((o) => [o.id, o.sites])),
    [orgsQ.data],
  );
  const tenants = useMemo(
    () => Object.fromEntries((orgsQ.data?.organizations ?? []).map((o) => [o.id, o.tenant])),
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
      sub={<>Every organization, its owners, its members and their roles — in one place{orgs ? ` · ${orgs.length} org${orgs.length === 1 ? '' : 's'}` : ''}</>}
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
              ? <>No organization yet. Create one, then name its owners.</>
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
        {/* Left rail — one row per org */}
        <Card>
          <div className="p-8 border-b">
            <Input placeholder="Search organizations…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {filtered.map((o) => {
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
                  {tenants[o] && <div className="small muted mt-4 mono">{tenants[o]}</div>}
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
              listedOwners={owners[activeOrg]}
              listedSites={entitled[activeOrg]}
              mayWrite={mayWrite}
              mayDelete={mayDelete}
              onDeleted={() => setPage('organizations', null)}
            />
          )}
        </div>
      </div>
      {createDialog}

    </>
  );
}


function OrgDetail({ org, name, tenant, listedOwners, listedSites, mayWrite, mayDelete, onDeleted }: {
  org: string; name?: string; tenant?: string;
  /** From the organisations list (jinbe:owner holders, org_sites); absent on an older jinbe, then read off the roles. */
  listedOwners?: string[]; listedSites?: string[];
  mayWrite: boolean; mayDelete: boolean; onDeleted: () => void;
}) {
  const { pushToast, setPage } = useApp();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { data: session } = useSession();
  const mayNameOwners = holds(session, 'orgs.owners:write');
  const orgPermissions = useMyOrgPermissions().data;
  // Inside the org the platform list means nothing: what the caller holds HERE decides (the org
  // roles assigned to them, or the every-org map). An org their answer does not list is left to jinbe.
  const unlisted = !!orgPermissions && !(org in orgPermissions);
  const mayManage = holdsIn(orgPermissions, org, 'org.members:write');
  const mayReadMembers = holdsIn(orgPermissions, org, 'org.members:read') || unlisted;
  const mayKeys = holdsIn(orgPermissions, org, 'org.keys:read') || unlisted;

  const usersQ = useOrgUsers(org);
  const users = useMemo(() => usersQ.data?.data ?? [], [usersQ.data]);
  const total = usersQ.data?.total ?? users.length;
  const rolesQ = useOrgRoles(org, mayReadMembers);
  const memberRoles = useOrgMemberRoles(org, users.map((u) => u.id), mayReadMembers);
  const owners = listedOwners ?? ownersOf(memberRoles.byId);
  const sites = listedSites ?? entitledSites(rolesQ.data ?? []);
  const ownersKnown = !!listedOwners || (mayReadMembers && !memberRoles.isLoading);
  const sitesKnown = !!listedSites || !rolesQ.isLoading;
  const label = (id: string) => users.find((u) => u.id === id)?.traits?.email ?? id;

  const [editOwners, setEditOwners] = useState(false);
  const [resumeOwners, setResumeOwners] = useState<{ owners: string[]; auto: boolean } | undefined>();
  // Back from the step-up an owners save needed: the same list saved again, once, if nobody changed
  // it meanwhile. Otherwise the drawer opens on what was chosen, to be checked and saved by hand.
  useResume<OwnersResume>(mayNameOwners ? `${ORG_OWNERS}:${org}` : null, ownersKnown && usersQ.isSuccess, (p) => {
    setResumeOwners({ owners: p.owners, auto: sameSet(owners, p.was) });
    setEditOwners(true);
    if (!sameSet(owners, p.was)) pushToast('The owners changed meanwhile', { sub: 'Nothing was saved. Your choice is back in the drawer — check it and save.', ttl: 8000 });
  });

  return (
    <>
      <div className="panel-head mb-12">
        <div className="min-w-0">
          <h3 className="row gap-8">
            <span className={name ? '' : 'mono'}>{name ?? org}</span>
          </h3>
          <div className="sub">
            {total} member{total === 1 ? '' : 's'}
            {name && <> · <span className="mono">{org}</span></>}
          </div>
        </div>
        <div className="row gap-8">
          {mayWrite && <Button size="sm" variant="ghost" icon={I.edit} onClick={() => setEditing(true)}>Edit</Button>}
          {mayDelete && <Button size="sm" variant="ghost" icon={I.trash} onClick={() => setDeleting(true)}>Delete</Button>}
          {mayKeys && <Button size="sm" onClick={() => setPage('apikeys', org)}>API keys</Button>}
        </div>
      </div>

      {/* Which sites' roles this organization may hold: each site's intent lists the orgs it serves.
          Read-only here — it changes by publishing the site. */}
      <Card pad="md" className="mb-12">
        <div className="fw-medium text-base">Sites</div>
        <div className="small muted mt-2">
          The sites whose roles can be assigned here. Each site&apos;s intent lists the organizations it serves; change it on the site.
        </div>
        <div className="row wrap gap-4 mt-8">
          {!sitesKnown
            ? <span className="small muted">reading…</span>
            : sites.length
              ? sites.map((s) => <Badge key={s} tone="success">{s}</Badge>)
              : <span className="small muted">none — only this organization&apos;s own roles</span>}
        </div>
      </Card>

      {/* Owners: the members holding jinbe:owner here — every org permission, assigning roles
          included. Named from the platform (orgs.owners:write, a recent second factor). */}
      <Card pad="md" className="mb-12">
        <div className="row justify-between items-start gap-12">
          <div className="min-w-0 flex-1">
            <div className="fw-medium text-base">Owners</div>
            <div className="small muted mt-2">
              Owners hold every permission of this organization and assign its roles to its members.
            </div>
            <div className="row wrap gap-4 mt-8">
              {!ownersKnown
                ? <span className="small muted">{mayReadMembers ? 'reading…' : 'You cannot see this organization\'s members.'}</span>
                : owners.length === 0
                    ? <span className="small muted">No owner yet — nobody assigns roles here.</span>
                    : owners.map((id) => <Badge key={id} tone="accent">{label(id)}</Badge>)}
            </div>
          </div>
          {mayNameOwners && (
            <Button variant="ghost" size="sm" onClick={() => setEditOwners(true)}>{owners.length ? 'Change owners' : 'Name owners'}</Button>
          )}
        </div>
      </Card>

      {mayReadMembers
        ? <OrgMembers org={org} orgName={name ?? org} mayManage={mayManage} pushToast={pushToast} />
        : <Card className="p-32"><EmptyHint>Its members and their roles are visible to whoever holds org.members:read in this organization.</EmptyHint></Card>}

      {editing && (
        <EditOrgDialog org={org} name={name} tenant={tenant} pushToast={pushToast} onClose={() => setEditing(false)} />
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

      {editOwners && (
        <OwnersDrawer
          org={org}
          name={name}
          current={owners}
          members={users.map((u) => ({ id: u.id, label: u.traits?.email ?? u.id }))}
          resume={resumeOwners}
          onClose={() => { setEditOwners(false); setResumeOwners(undefined); }}
        />
      )}
    </>
  );
}

// The owners editor. A PUT names the org's owners by identity id: each joins the org if needed and
// holds jinbe:owner there, everyone else loses it. orgs.owners:write and a recent second factor are
// enforced by jinbe; a stale factor returns reauth_required, handled with a step-up bounce. The
// picker offers the members, plus anyone already an owner, plus an identity id typed in (onboarding
// an org that has nobody yet).
const ORG_OWNERS = 'org-owners';
type OwnersResume = { owners: string[]; was: string[] };
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `resume`: back from the step-up — the owners chosen, saved once by itself on open when `auto`. */
function OwnersDrawer({ org, name, current, members, onClose, resume }: {
  org: string; name?: string; current: string[]; members: { id: string; label: string }[];
  onClose: () => void; resume?: { owners: string[]; auto: boolean };
}) {
  const { pushToast } = useApp();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>(resume?.owners ?? current);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const labels = useMemo(() => new Map(members.map((m) => [m.id, m.label])), [members]);
  const options = useMemo(() => [...new Set([...members.map((m) => m.id), ...current, ...selected])], [members, current, selected]);
  const resumed = useRef(false);
  useEffect(() => {
    if (!resume?.auto || resumed.current) return;
    resumed.current = true;
    void save();
  });
  const dirty = !sameSet(selected, current);

  const toggle = (id: string) => setSelected(prev => (prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]));

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      await orgAccessApi.setOwners(org, selected);
      pushToast(`Owners of ${name ?? org} updated`, { sub: `${selected.length} owner${selected.length === 1 ? '' : 's'}` });
      qc.invalidateQueries({ queryKey: ['org-member-roles', org] });
      qc.invalidateQueries({ queryKey: ['all-orgs'] });
      qc.invalidateQueries({ queryKey: ['org-users', org] });
      onClose();
    } catch (e) {
      const err = e as Error & { code?: string };
      // Step-up: re-verify a recent second factor, then return to retry.
      if (err.code === 'reauth_required') {
        const going = stepUpAndResume(`${ORG_OWNERS}:${org}`, { owners: selected, was: current } satisfies OwnersResume);
        pushToast('Two-factor re-verification required', { err: true, sub: going
          ? 'Nothing was saved yet. You will be sent to re-verify your second factor; back here the owners are saved by themselves. This is not a sign-out.'
          : 'Nothing was saved. Re-verify your second factor, then save again.' });
        return;
      }
      pushToast(...toastFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      eyebrow="Organization owners"
      title="Name owners"
      footer={
        <>
          <span className="small muted">Needs orgs.owners:write and a recent second factor.</span>
          <div className="row">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!dirty || busy}>{busy ? 'Saving…' : `Save ${OWNER_ROLE.split(':')[1]}s`}</Button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <div className="input-label">Organization</div>
        <div className={cx('text-base', !name && 'mono')}>{name ?? org}</div>
      </div>
      <Field
        label="Owners"
        hint="Each selected person holds jinbe:owner here (joining the organization if needed). Saving replaces the whole list; deselect everyone to leave it without an owner."
      >
        <Card pad="sm">
          <MultiSelectPills
            options={options.map((id) => labels.get(id) ?? id)}
            selected={selected.map((id) => labels.get(id) ?? id)}
            onToggle={(l) => toggle(options.find((id) => (labels.get(id) ?? id) === l) ?? l)}
            empty="No members yet — add an owner by identity id below."
          />
        </Card>
      </Field>
      <form className="row gap-8 mt-8" onSubmit={(e) => { e.preventDefault(); const v = extra.trim().toLowerCase(); if (UUID.test(v)) { setSelected((s) => [...new Set([...s, v])]); setExtra(''); } }}>
        <Input size="sm" mono aria-label="Add an owner by identity id" placeholder="identity id (not yet a member)" value={extra} onChange={(e) => setExtra(e.target.value)} />
        <Button size="sm" type="submit" disabled={!UUID.test(extra.trim())}>Add</Button>
      </form>
    </Drawer>
  );
}
