import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../contexts/AppContext';
import { accountsApi, type PersonalKeyView } from '../api/accounts';
import { useOrgCatalog } from '../api/orgCatalog';
import { useMcpStatus } from '../api/hooks';
import { ApiErrorState } from '../components/ApiErrorState';
import { Button, Card, ConfirmDialog, EmptyRow, EmptyState, I, LoadingRows, PageHeader, Table, TagList, Th } from '../components/ui';
import { MY_API_KEYS, personalKeysOff, useMyApiKeys } from '../hooks/usePersonalKeys';
import { toastFor } from '../lib/apiError';
import { MCP_SCOPE } from '../lib/apiKeys';
import { orgLabel } from '../lib/orgOptions';
import { CreatePersonalKeyDrawer } from './apikeys/CreatePersonalKeyDrawer';
import { McpHelp } from './apikeys/McpHelp';
import { CreatorCell, ExpiryCell } from './apikeys/parts';

/**
 * Connections & keys (`#/connections`): the signed-in person's own keys, for an AI assistant or any
 * MCP client that acts as them. Each key acts in one organization, never with more than they hold
 * there, and expires within 30 days (or the administrator's shorter maximum). On a platform without
 * personal keys (404) the page says so calmly — "turned off by an administrator" when the deployment
 * allows them but Settings → AI assistants is off (GET /mcp/status) — and the rail does not list it.
 */
export function ConnectionsPage() {
  const qc = useQueryClient();
  const { pushToast } = useApp();
  const { orgs } = useOrgCatalog();
  const q = useMyApiKeys();
  const status = useMcpStatus();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<PersonalKeyView | null>(null);
  const [busy, setBusy] = useState(false);
  const header = (
    <PageHeader
      title="Connections & keys"
      sub="Keys you create for yourself, so an AI assistant or another MCP client can act as you"
      actions={!q.isError && status.data?.off !== 'administrator' && <Button variant="primary" icon={I.plus} onClick={() => setCreating(true)}>Create key</Button>}
    />
  );

  if (personalKeysOff(q.error) || status.data?.off === 'administrator') {
    const byAdmin = status.data?.off === 'administrator';
    return (
      <>
        {header}
        <Card>
          {byAdmin ? (
            <EmptyState icon={I.info} title="AI assistants are turned off by an administrator">
              Personal keys cannot be created or used for now; keys you already have are kept and work again
              when an administrator turns AI assistants back on. Nothing is wrong with your account.
            </EmptyState>
          ) : (
            <EmptyState icon={I.info} title="Personal keys aren’t enabled on this platform">
              An administrator of the platform can switch them on. Nothing is wrong with your account.
            </EmptyState>
          )}
        </Card>
      </>
    );
  }

  const revoke = async (k: PersonalKeyView) => {
    setBusy(true);
    try {
      await accountsApi.revokeMyApiKey(k.client_id);
      pushToast(`Revoked ${k.label}`, { sub: 'Clients using it are refused from their next call.' });
    } catch (err) {
      pushToast(...toastFor(err));
    } finally {
      setBusy(false);
      setRevoking(null);
      qc.invalidateQueries({ queryKey: MY_API_KEYS });
    }
  };

  const keys = q.data?.data ?? [];
  return (
    <>
      {header}
      <div className="stack gap-16">
        {q.isError ? (
          <ApiErrorState what="your keys" error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <Card title="Your keys" sub={q.isLoading ? 'Loading…' : `${keys.length} key${keys.length === 1 ? '' : 's'}`} pad="none">
            <Table aria-label="Your personal keys">
              <thead><tr><Th>Key</Th><Th>Organization</Th><Th>Scopes</Th><Th>Expires</Th><Th>Created</Th><Th kind="actions"><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>
                {q.isLoading && <LoadingRows rows={2} cols={6} />}
                {!q.isLoading && keys.length === 0 && (
                  <EmptyRow colSpan={6}>No keys yet. Create one for each client you connect, so each can be revoked alone.</EmptyRow>
                )}
                {keys.map((k) => (
                  <tr key={k.client_id}>
                    <td className="min-w-0">
                      <div className="fw-medium">{k.label || 'Untitled key'}</div>
                      <div className="small muted mono break-all">{k.client_id}</div>
                    </td>
                    <td className="small">{orgLabel(k.organization_id, orgs)}</td>
                    <td><TagList items={k.scopes.filter((s) => s !== MCP_SCOPE)} label={`Scopes of ${k.label}`} /></td>
                    <td><ExpiryCell expiresAt={k.expires_at} /></td>
                    <td><CreatorCell id={null} at={k.created_at} /></td>
                    <td className="actions">
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRevoking(k)} aria-label={`Revoke ${k.label}`}>Revoke</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
        <McpHelp />
      </div>
      {creating && <CreatePersonalKeyDrawer onClose={() => setCreating(false)} onCreated={() => qc.invalidateQueries({ queryKey: MY_API_KEYS })} />}
      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke ${revoking?.label || 'this key'}?`}
        danger
        busy={busy}
        confirmLabel="Revoke key"
        body="Clients using this key are refused from their next call. This cannot be undone — create a new key to connect again."
        onCancel={() => setRevoking(null)}
        onConfirm={() => { if (revoking) void revoke(revoking); }}
      />
    </>
  );
}
