import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { accountsApi, type ApiKeyView } from '../../api/accounts';
import { ApiErrorState } from '../../components/ApiErrorState';
import { Button, Card, ConfirmDialog, EmptyRow, I, LoadingRows, Table, TagList, Th } from '../../components/ui';
import { toastFor } from '../../lib/apiError';
import { stepUpOnRefusal } from '../../lib/resume';
import { CreateOrgKeyDrawer } from './CreateOrgKeyDrawer';
import { CreatorCell, ExpiryCell, LastUsedCell } from './parts';

/**
 * One organization's API keys: machine credentials (OAuth2 client-credentials clients) that belong to
 * the organization, valid on every site serving it. Listed without secrets, revoked one by one.
 * Platform staff list them from the admin route, create them (`mayCreate`) and revoke them there
 * (`adminRevoke`: both orgs.keys:write); the organization itself lists and revokes through its own.
 * `actions` replaces the create button (a link elsewhere).
 */
export function OrgKeys({ org, orgName, from, mayCreate, adminRevoke = mayCreate, actions }: {
  org: string;
  orgName: string;
  from: 'admin' | 'org';
  mayCreate: boolean;
  adminRevoke?: boolean;
  actions?: ReactNode;
}) {
  const qc = useQueryClient();
  const { pushToast } = useApp();
  const key = ['api-keys', org, from];
  const q = useQuery({ queryKey: key, queryFn: () => accountsApi.listApiKeys(org, from), staleTime: 10_000 });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['api-keys', org] });

  const revoke = async (k: ApiKeyView) => {
    setBusy(true);
    try {
      await accountsApi.revokeApiKey(org, k.client_id, adminRevoke ? 'admin' : 'org');
      pushToast(`Revoked ${k.label}`, { sub: 'Programs using it are refused from their next call.' });
    } catch (err) {
      if (stepUpOnRefusal(err, pushToast, { redo: `Revoke ${k.label} again: nothing was revoked before the check.` })) return;
      pushToast(...toastFor(err));
    } finally {
      setBusy(false);
      setRevoking(null);
      refresh();
    }
  };

  const keys = q.data?.data ?? [];
  // A column only once jinbe says when a key was last used: a column of dashes informs nobody.
  const lastUsed = keys.some((k) => k.last_used_at !== undefined);
  const cols = lastUsed ? 6 : 5;
  const create = mayCreate
    ? <Button variant="primary" size="sm" icon={I.plus} onClick={() => setCreating(true)}>Create key</Button>
    : actions;

  return (
    <>
      {q.isError ? (
        <ApiErrorState what="API keys" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Card
          title="API keys"
          sub={q.isLoading ? 'Loading…' : `${keys.length} key${keys.length === 1 ? '' : 's'} · valid on every site serving ${orgName}`}
          actions={create}
          pad="none"
        >
          <Table aria-label={`API keys of ${orgName}`}>
            <thead><tr>
              <Th>Key</Th><Th>Scopes</Th><Th>Expires</Th><Th>Created</Th>{lastUsed && <Th>Last used</Th>}<Th kind="actions"><span className="sr-only">Actions</span></Th>
            </tr></thead>
            <tbody>
              {q.isLoading && <LoadingRows rows={3} cols={cols} />}
              {!q.isLoading && keys.length === 0 && (
                <EmptyRow colSpan={cols}>
                  {mayCreate
                    ? 'No API keys yet. Create one per program, so each can be revoked alone.'
                    : 'No API keys yet. Platform staff create them.'}
                </EmptyRow>
              )}
              {keys.map((k) => (
                <tr key={k.client_id}>
                  <td className="min-w-0">
                    <div className="fw-medium">{k.label || 'Untitled key'}</div>
                    <div className="small muted mono break-all">{k.client_id}</div>
                  </td>
                  <td><TagList items={k.scopes} label={`Scopes of ${k.label}`} /></td>
                  <td><ExpiryCell expiresAt={k.expires_at} /></td>
                  <td><CreatorCell id={k.created_by} at={k.created_at} email={k.created_by_email} /></td>
                  {lastUsed && <td><LastUsedCell at={k.last_used_at} /></td>}
                  <td className="actions">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRevoking(k)} aria-label={`Revoke ${k.label}`}>Revoke</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {creating && (
        <CreateOrgKeyDrawer
          org={org}
          orgName={orgName}
          onClose={() => setCreating(false)}
          onCreated={refresh}
        />
      )}
      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke ${revoking?.label || 'this key'}?`}
        danger
        busy={busy}
        confirmLabel="Revoke key"
        body="Programs using this key are refused from their next call. This cannot be undone — a new key has a new secret."
        onCancel={() => setRevoking(null)}
        onConfirm={() => { if (revoking) void revoke(revoking); }}
      />
    </>
  );
}
