import { useState } from 'react';
import { Button, Card, ConfirmDialog, RelativeTime, Table, TagList, Th } from '../../components/ui';
import { ApiErrorState } from '../../components/ApiErrorState';
import { useInvitations, useRevokeInvitation, type Invitation } from '../../api/invitations';
import { expiryLabel } from '../../lib/apiKeys';
import { makeToastErr, type PushToast } from './toastErr';

/**
 * An organization's pending invitations: who was invited, with which roles, by whom, until when. Taken
 * back one by one (org.members:write here). Nothing is shown while there are none.
 */
export function PendingInvitations({ org, orgName, mayManage, pushToast }: {
  org: string; orgName: string; mayManage: boolean; pushToast: PushToast;
}) {
  const q = useInvitations(org);
  const revoke = useRevokeInvitation(org);
  const [taking, setTaking] = useState<Invitation | null>(null);
  const list = q.data ?? [];

  if (q.isError) return <div className="mt-12"><ApiErrorState compact error={q.error} what="the invitations" onRetry={() => q.refetch()} /></div>;
  if (list.length === 0) return null;

  return (
    <Card className="mt-12" title="Pending invitations" sub={`${list.length} waiting to be accepted`} pad="none">
      <Table aria-label={`Pending invitations of ${orgName}`}>
        <thead><tr>
          <Th>Email</Th><Th>Roles</Th><Th>Invited</Th><Th>Expires</Th>{mayManage && <Th kind="actions"><span className="sr-only">Actions</span></Th>}
        </tr></thead>
        <tbody>
          {list.map((inv) => (
            <tr key={inv.id}>
              <td className="mono">{inv.email}</td>
              <td>{inv.roles.length ? <TagList items={inv.roles} label={`Roles for ${inv.email}`} /> : <span className="small muted">none</span>}</td>
              <td className="small muted">
                <div className="nowrap"><RelativeTime at={inv.createdAt} /></div>
                <div>by {inv.byPlatform ? 'platform staff' : inv.invitedBy.email}</div>
              </td>
              <td className="small muted nowrap">{expiryLabel(inv.expiresAt)}</td>
              {mayManage && (
                <td className="actions">
                  <Button variant="ghost" size="sm" onClick={() => setTaking(inv)} aria-label={`Take back the invitation of ${inv.email}`}>Take back</Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
      <ConfirmDialog
        open={!!taking}
        title="Take back this invitation?"
        body={<>{taking?.email} can no longer join {orgName} with it.</>}
        confirmLabel="Take back"
        danger
        busy={revoke.isPending}
        onCancel={() => setTaking(null)}
        onConfirm={() => {
          if (!taking) return;
          revoke.mutate(taking.id, {
            onSuccess: () => { pushToast(`Invitation of ${taking.email} taken back`); setTaking(null); },
            onError: (err) => { makeToastErr(pushToast)(err); setTaking(null); },
          });
        }}
      />
    </Card>
  );
}
