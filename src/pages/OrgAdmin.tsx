import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { emptyOrganisationsHint, organisationsSourceNote } from '../auth/authority';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { ConfirmDialog, EmptyHint } from '../components/ui/Primitives';
import { SkeletonPanel } from '../components/ui/Skeleton';
import { OrgPicker } from '../components/OrgPicker';
import { ApiErrorState } from '../components/ApiErrorState';
import type { KratosIdentity } from '../api/client';
import { useMyOrganizationNames, useMyOrganizationsScope, useOrgUsers } from '../api/hooks';
import { orgAccessApi, isNotAvailable } from '../api/orgAccess';
import { useOrgCatalog } from '../api/orgCatalog';
import { orgLabel } from '../lib/orgOptions';
import { useMyOrg } from '../hooks/useMyOrg';
import { GrantsMatrix } from './orgadmin/GrantsMatrix';
import { AddMember } from './orgadmin/AddMember';
import { InviteDrawer } from './orgadmin/InviteDrawer';
import { makeToastErr } from './orgadmin/toastErr';

/**
 * "My org": an org admin hands out their own org's groups to its members.
 *
 * What is granted here counts only on this org's routes, and never takes away what somebody holds on
 * the sites through their own groups. Removing somebody removes them from this org only. The org is
 * the address (`#/orgadmin/<org id>`), so the Access view in a person's drawer can link straight here.
 */
export function OrgAdminPage() {
  const { pushToast, pageParam, setPage } = useApp();
  const { show, pickAny, administered, isLoading } = useMyOrg();
  const scope = useMyOrganizationsScope().data ?? 'delegated';
  const names = useMyOrganizationNames().data ?? {};
  const { orgs: catalog } = useOrgCatalog();

  const active = pageParam || (pickAny ? '' : administered[0] ?? '');
  const orgName = pickAny ? orgLabel(active, catalog) : names[active] ?? orgLabel(active, catalog);

  if (isLoading) {
    return (
      <>
        <div className="page-head"><div><h1>My org</h1><div className="sub">Reading the organizations you administer…</div></div></div>
        <div aria-busy="true"><SkeletonPanel lines={4} /></div>
      </>
    );
  }

  if (!show) {
    return (
      <>
        <div className="page-head"><div><h1>My org</h1><div className="sub">{organisationsSourceNote(scope) ?? 'Hand out your organization\'s groups to its members'}</div></div></div>
        <div className="panel" style={{ padding: 40 }}><EmptyHint>{emptyOrganisationsHint(scope).message}</EmptyHint></div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My org</h1>
          <div className="sub">Groups you grant here count on this organization&apos;s routes only — members keep their site access</div>
        </div>
        <div className="page-actions">
          {pickAny
            ? <OrgPicker value={active} onChange={(id) => setPage('orgadmin', id || null)} style={{ minWidth: 240 }} />
            : administered.length > 1 && (
              <select className="input" aria-label="Organization" style={{ width: 'auto' }} value={active} onChange={(e) => setPage('orgadmin', e.target.value)}>
                {administered.map((o) => <option key={o} value={o}>{names[o] ?? o}</option>)}
              </select>
            )}
          {active && <button className="btn" onClick={() => setPage('apikeys', active)}><span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.key}</span> API keys</button>}
        </div>
      </div>
      {active
        ? <OrgMembers key={active} org={active} orgName={orgName} pushToast={pushToast} />
        : <div className="panel" style={{ padding: 40 }}><EmptyHint>Choose an organization to manage its members.</EmptyHint></div>}
    </>
  );
}

function OrgMembers({ org, orgName, pushToast }: { org: string; orgName: string; pushToast: ReturnType<typeof useApp>['pushToast'] }) {
  const qc = useQueryClient();
  const usersQ = useOrgUsers(org);
  const grantsQ = useQuery({ queryKey: ['org-grants', org], queryFn: () => orgAccessApi.grants(org), retry: false });
  const assignableQ = useQuery({ queryKey: ['org-assignable', org], queryFn: () => orgAccessApi.assignable(org), retry: false });
  const [invite, setInvite] = useState(false);
  const [removing, setRemoving] = useState<KratosIdentity | null>(null);
  const [busy, setBusy] = useState(false);

  const grantsMissing = isNotAvailable(grantsQ.error);
  const saved = useMemo(() => grantsQ.data ?? {}, [grantsQ.data]);
  const assignable = useMemo(() => assignableQ.data ?? [], [assignableQ.data]);
  const members = usersQ.data?.data ?? [];

  const remove = async (m: KratosIdentity) => {
    setBusy(true);
    try {
      await orgAccessApi.removeFromOrg(org, m.id);
      pushToast(`Removed ${m.traits?.email} from ${orgName}`, { sub: 'Their account, site access and other organizations stay.' });
      qc.invalidateQueries({ queryKey: ['org-users', org] });
      qc.invalidateQueries({ queryKey: ['org-grants', org] });
      setRemoving(null);
    } catch (err) {
      makeToastErr(pushToast)(err);
    } finally {
      setBusy(false);
    }
  };

  const hardError = usersQ.error ?? (grantsMissing ? null : grantsQ.error) ?? assignableQ.error;

  return (
    <>
      {grantsMissing && (
        <div className="panel mb-12" role="status" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center', color: 'var(--warn)' }}>{I.info}</span>
          <span className="small">Org grants are not available yet on this server. Members are listed; granting is off until it is.</span>
        </div>
      )}
      {hardError && <div className="mb-12"><ApiErrorState compact error={hardError} what="this organization" onRetry={() => { usersQ.refetch(); grantsQ.refetch(); assignableQ.refetch(); }} /></div>}

      <div className="panel">
        <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <AddMember org={org} orgName={orgName} pushToast={pushToast} />
          <div className="flex-1" />
          <button className="btn primary" onClick={() => setInvite(true)}>
            <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.plus}</span> Invite new person
          </button>
        </div>
        <GrantsMatrix
          org={org}
          orgName={orgName}
          members={members}
          loading={usersQ.isLoading || grantsQ.isLoading || assignableQ.isLoading}
          saved={saved}
          assignable={assignable}
          readOnly={grantsMissing || !!grantsQ.error}
          onRemove={setRemoving}
          pushToast={pushToast}
        />
      </div>

      {invite && (
        <InviteDrawer
          org={org}
          assignable={[]}
          pushToast={pushToast}
          onClose={() => setInvite(false)}
          onDone={() => { setInvite(false); usersQ.refetch(); }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        title={`Remove from ${orgName}?`}
        body={<>
          <strong>{removing?.traits?.email}</strong> leaves <strong>{orgName}</strong> and loses the groups granted here.
          Only this organization: their account, their site access from their own groups, and their other organizations stay.
        </>}
        confirmLabel="Remove from this org"
        danger
        busy={busy}
        onConfirm={() => { if (removing) void remove(removing); }}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
