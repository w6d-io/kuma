import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { useApp } from '../../contexts/AppContext';
import { I } from '../../components/ui/Icons';
import { Button, Card, ConfirmDialog } from '../../components/ui';
import { ApiErrorState } from '../../components/ApiErrorState';
import type { KratosIdentity } from '../../api/client';
import { useOrgUsers } from '../../api/hooks';
import { orgAccessApi } from '../../api/orgAccess';
import { useOrgMemberRoles, useOrgRoles } from '../../api/orgRoles';
import { RolesMatrix } from './RolesMatrix';
import { AddMember } from './AddMember';
import { InviteDrawer } from './InviteDrawer';
import { makeToastErr } from './toastErr';

/**
 * One organization's people and the org roles they hold there — the same table on My org and on the
 * Organizations hub, so the two never disagree about who may do what. `mayManage` is org.members:write
 * IN this org: jinbe decides every write anyway, and refuses a role the caller does not hold.
 */
export function OrgMembers({ org, orgName, mayManage, pushToast }: {
  org: string;
  orgName: string;
  mayManage: boolean;
  pushToast: ReturnType<typeof useApp>['pushToast'];
}) {
  const qc = useQueryClient();
  const usersQ = useOrgUsers(org);
  const rolesQ = useOrgRoles(org);
  const members = useMemo(() => usersQ.data?.data ?? [], [usersQ.data]);
  const ids = useMemo(() => members.map((m) => m.id), [members]);
  const memberRoles = useOrgMemberRoles(org, ids);
  const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);
  const [invite, setInvite] = useState(false);
  const [removing, setRemoving] = useState<KratosIdentity | null>(null);
  const [busy, setBusy] = useState(false);

  const saved = memberRoles.byId;

  const remove = async (m: KratosIdentity) => {
    setBusy(true);
    try {
      await orgAccessApi.removeFromOrg(org, m.id);
      pushToast(`Removed ${m.traits?.email ?? m.id} from ${orgName}`, { sub: 'Their account, platform access and other organizations stay.' });
      qc.invalidateQueries({ queryKey: ['org-users', org] });
      qc.invalidateQueries({ queryKey: ['org-member-roles', org, m.id] });
      setRemoving(null);
    } catch (err) {
      makeToastErr(pushToast)(err);
    } finally {
      setBusy(false);
    }
  };

  const hardError = usersQ.error ?? rolesQ.error ?? memberRoles.error;
  // A role the caller may assign means they hold org.members:write here: jinbe marked it so.
  const manage = mayManage || roles.some((r) => r.assignable);

  return (
    <>
      {hardError && <div className="mb-12"><ApiErrorState compact error={hardError} what="this organization" onRetry={() => { usersQ.refetch(); rolesQ.refetch(); memberRoles.refetch(); }} /></div>}

      <Card className="pf-host">
        {manage && (
          <div className="row wrap gap-8 px-12 py-8 border-b">
            <AddMember org={org} orgName={orgName} pushToast={pushToast} />
            <div className="flex-1" />
            <Button variant="primary" size="sm" icon={I.plus} onClick={() => setInvite(true)}>Invite new person</Button>
          </div>
        )}
        <RolesMatrix
          org={org}
          orgName={orgName}
          members={members}
          loading={usersQ.isLoading || rolesQ.isLoading || memberRoles.isLoading}
          saved={saved}
          roles={roles}
          mayManage={manage}
          onRemove={setRemoving}
          pushToast={pushToast}
        />
      </Card>

      {invite && (
        <InviteDrawer
          org={org}
          assignable={roles.filter((r) => r.assignable)}
          pushToast={pushToast}
          onClose={() => setInvite(false)}
          onDone={() => { setInvite(false); usersQ.refetch(); }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        title={`Remove from ${orgName}?`}
        body={<>
          <strong>{removing?.traits?.email ?? removing?.id}</strong> leaves <strong>{orgName}</strong> and loses the roles assigned here.
          Only this organization: their account, their platform access from their groups, and their other organizations stay.
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
