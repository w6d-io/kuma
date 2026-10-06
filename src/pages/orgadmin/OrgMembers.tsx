import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { useApp } from '../../contexts/AppContext';
import { I } from '../../components/ui/Icons';
import { Button, Card, ConfirmDialog, Drawer } from '../../components/ui';
import { ApiErrorState } from '../../components/ApiErrorState';
import type { KratosIdentity } from '../../api/client';
import { useOrgUsers } from '../../api/hooks';
import { orgAccessApi } from '../../api/orgAccess';
import { useOrgMemberRoles, useOrgRoles } from '../../api/orgRoles';
import { RolesMatrix } from './RolesMatrix';
import { AddMember } from './AddMember';
import { InviteDrawer } from './InviteDrawer';
import { PendingInvitations } from './PendingInvitations';
import { makeToastErr } from './toastErr';
import { IndividualAccess } from '../../components/grants/IndividualAccess';

/**
 * One organization's people, the org roles they hold there, and who is invited — the same table on My
 * org and on the Organizations hub, so the two never disagree about who may do what. `mayManage` is
 * org.members:write IN this org: jinbe decides every write anyway, and refuses a role the caller does
 * not hold. Somebody new joins only through an invitation they accept.
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
  // jinbe lists each member's roles on the member list; only an older one needs a read per member.
  const listed = members.length > 0 && members.every((m) => Array.isArray(m.roles));
  const ids = useMemo(() => members.map((m) => m.id), [members]);
  const perMember = useOrgMemberRoles(org, ids, !listed);
  const memberRoles = useMemo(
    () => (listed ? { byId: Object.fromEntries(members.map((m) => [m.id, m.roles ?? []])), isLoading: false, error: null, refetch: () => {} } : perMember),
    [listed, members, perMember],
  );
  const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);
  const [invite, setInvite] = useState(false);
  const [removing, setRemoving] = useState<KratosIdentity | null>(null);
  const [individual, setIndividual] = useState<KratosIdentity | null>(null);
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
            <Button variant="primary" size="sm" icon={I.plus} onClick={() => setInvite(true)}>Invite by email</Button>
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
          onIndividual={setIndividual}
          pushToast={pushToast}
        />
      </Card>

      <PendingInvitations org={org} orgName={orgName} mayManage={manage} pushToast={pushToast} />

      {invite && (
        <InviteDrawer
          org={org}
          assignable={roles.filter((r) => r.assignable)}
          pushToast={pushToast}
          onClose={() => setInvite(false)}
          onDone={() => usersQ.refetch()}
        />
      )}
      {individual && (
        <Drawer open size="lg" onClose={() => setIndividual(null)} eyebrow={orgName} title={individual.traits?.name || individual.traits?.email || individual.id}>
          <IndividualAccess
            userId={individual.id}
            who={individual.traits?.email ?? individual.id}
            org={org}
            mayGrant={manage}
            pushToast={pushToast}
          />
        </Drawer>
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
