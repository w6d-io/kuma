import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../contexts/AppContext';
import { accountsApi, type PersonalKeyView } from '../api/accounts';
import { useMcpStatus } from '../api/hooks';
import { ApiErrorState } from '../components/ApiErrorState';
import { Button, Callout, Card, ConfirmDialog, EmptyRow, EmptyState, I, LoadingRows, PageHeader, Table, TagList, Th } from '../components/ui';
import { MY_API_KEYS, personalKeysOff, useMyApiKeys } from '../hooks/usePersonalKeys';
import { toastFor } from '../lib/apiError';
import { MCP_SCOPE, PERSONAL_EXPIRY_DEFAULT } from '../lib/apiKeys';
import { CreatePersonalKeyDrawer } from './apikeys/CreatePersonalKeyDrawer';
import { McpHelp } from './apikeys/McpHelp';
import { McpKeyFacts, McpTroubleshooting } from './apikeys/McpGuide';
import { CreatorCell, ExpiryCell } from './apikeys/parts';

/**
 * Connections & keys (`#/connections`): the signed-in person's own keys, for an AI assistant or any
 * MCP client that acts as them. A key belongs to no organization: it acts with its holder's
 * permissions — all of them, or the ones chosen at creation — re-checked on every call, and expires
 * within 30 days (or the administrator's shorter maximum). When an administrator limited AI
 * assistants to some groups and the person is in none of them, the page says so. On a platform without
 * personal keys (404) the page says so calmly — "turned off by an administrator" when the deployment
 * allows them but Settings → AI assistants is off (GET /mcp/status) — and the rail does not list it.
 */
/** A key that follows its holder's permissions: said by jinbe, or read off a key with no permission of its own. */
function allPermissions(k: PersonalKeyView): boolean {
  return k.all_permissions ?? k.scopes.every((s) => s === MCP_SCOPE);
}

export function ConnectionsPage() {
  const qc = useQueryClient();
  const { pushToast } = useApp();
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
        {status.data?.allowed === false && (
          <Callout tone="info" icon={I.info} title="AI assistants are not enabled for your groups">
            <div className="small">An administrator limited AI assistants to some groups, and you are in none of them. Your keys are kept but refused until you are.</div>
          </Callout>
        )}
        {q.isError ? (
          <ApiErrorState what="your keys" error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <Card title="Your keys" sub={q.isLoading ? 'Loading…' : `${keys.length} key${keys.length === 1 ? '' : 's'}`} pad="none">
            <Table aria-label="Your personal keys">
              <thead><tr><Th>Key</Th><Th>Permissions</Th><Th>Expires</Th><Th>Created</Th><Th kind="actions"><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>
                {q.isLoading && <LoadingRows rows={2} cols={5} />}
                {!q.isLoading && keys.length === 0 && (
                  <EmptyRow colSpan={5}>No keys yet. Create one for each client you connect, so each can be revoked alone.</EmptyRow>
                )}
                {keys.map((k) => (
                  <tr key={k.client_id}>
                    <td className="min-w-0">
                      <div className="fw-medium">{k.label || 'Untitled key'}</div>
                      <div className="small muted mono break-all">{k.client_id}</div>
                    </td>
                    <td>
                      {allPermissions(k)
                        ? <span className="small">All my permissions</span>
                        : <TagList items={k.scopes.filter((s) => s !== MCP_SCOPE)} label={`Permissions of ${k.label}`} />}
                    </td>
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
        <McpKeyFacts maxDays={status.data?.personalKeys?.maxDays ?? PERSONAL_EXPIRY_DEFAULT} />
        <McpTroubleshooting />
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
