import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { accountsApi, type McpConnectionView } from '../../api/accounts';
import { ApiErrorState } from '../../components/ApiErrorState';
import { Badge, Button, Card, ConfirmDialog, EmptyRow, I, LoadingRows, RelativeTime, Table, TagList, Th } from '../../components/ui';
import { statusOf, toastFor } from '../../lib/apiError';
import { protectedWindow, remainingLabel } from '../../lib/apiKeys';
import { ExpiryCell, LastUsedCell } from './parts';

const MY_MCP_CONNECTIONS = ['my-mcp-connections'] as const;

/**
 * Signed-in apps (Connections & keys): the AI assistants and other MCP clients the person signed in
 * with a browser instead of a key. Each acts as them — with all their permissions, or the ones ticked
 * at sign-in — until disconnected or its grant expires. Disconnecting ends the consent and every
 * token under it. On a jinbe without browser sign-in (404) the card is not shown at all.
 */
function appName(c: McpConnectionView): string {
  return c.client_name?.trim() || 'Unnamed app';
}

function ProtectedCell({ c }: { c: McpConnectionView }) {
  const w = protectedWindow(c.step_up_until, c.step_up_actions);
  if (w.state === 'off') return <span className="small muted">Off</span>;
  if (w.state === 'ended') return <span className="small muted">Ended</span>;
  return (
    <Badge tone="warning" icon={I.shield} mono={false} title={new Date(w.until!).toLocaleString()}>
      {`${remainingLabel(w.until!)} left`}
    </Badge>
  );
}

export function SignedInApps() {
  const qc = useQueryClient();
  const { pushToast } = useApp();
  const q = useQuery({ queryKey: MY_MCP_CONNECTIONS, queryFn: () => accountsApi.listMcpConnections(), retry: false, staleTime: 30_000 });
  const [revoking, setRevoking] = useState<McpConnectionView | 'all' | null>(null);
  const [busy, setBusy] = useState(false);

  if (statusOf(q.error) === 404) return null;

  const apps = q.data?.data ?? [];
  const disconnect = async (target: McpConnectionView | 'all') => {
    setBusy(true);
    try {
      if (target === 'all') {
        await accountsApi.revokeAllMcpConnections(apps.map((a) => a.client_id));
        pushToast('Disconnected every signed-in app', { sub: 'Each is refused from its next call and has to sign in again.' });
      } else {
        await accountsApi.revokeMcpConnection(target.client_id);
        pushToast(`Disconnected ${appName(target)}`, { sub: 'It is refused from its next call and has to sign in again.' });
      }
    } catch (err) {
      pushToast(...toastFor(err));
    } finally {
      setBusy(false);
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: MY_MCP_CONNECTIONS });
    }
  };

  if (q.isError) return <ApiErrorState what="your signed-in apps" error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <Card
        title="Signed-in apps"
        sub={q.isLoading ? 'Loading…' : 'Apps you signed in with your browser. Each acts as you until you disconnect it or its sign-in expires.'}
        pad="none"
        actions={apps.length > 1 && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRevoking('all')}>Disconnect all</Button>}
      >
        <Table aria-label="Signed-in apps">
          <thead><tr><Th>App</Th><Th>Acts with</Th><Th>Protected actions</Th><Th>Signed in</Th><Th>Last used</Th><Th>Expires</Th><Th kind="actions"><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {q.isLoading && <LoadingRows rows={2} cols={7} />}
            {!q.isLoading && apps.length === 0 && (
              <EmptyRow colSpan={7}>No app signed in. Add the MCP server to your assistant without a key and it opens this browser to sign you in.</EmptyRow>
            )}
            {apps.map((c) => (
              <tr key={c.client_id}>
                <td className="min-w-0">
                  <div className="fw-medium">{appName(c)} <span className="small muted">(name not verified)</span></div>
                  {c.redirect_host && <div className="small muted mono break-all">{c.redirect_host}</div>}
                </td>
                <td>
                  {c.scope_mode === 'all'
                    ? <span className="small">All my permissions</span>
                    : <TagList items={c.scopes} label={`Permissions of ${appName(c)}`} />}
                </td>
                <td><ProtectedCell c={c} /></td>
                <td><span className="small muted nowrap">{c.granted_at ? <RelativeTime at={c.granted_at} /> : '—'}</span></td>
                <td><LastUsedCell at={c.last_used_at} /></td>
                <td><ExpiryCell expiresAt={c.grant_expires_at} /></td>
                <td className="actions">
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRevoking(c)} aria-label={`Disconnect ${appName(c)}`}>Disconnect</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <ConfirmDialog
        open={revoking !== null}
        title={revoking === 'all' ? `Disconnect all ${apps.length} apps?` : `Disconnect ${revoking ? appName(revoking) : 'this app'}?`}
        danger
        busy={busy}
        confirmLabel={revoking === 'all' ? 'Disconnect all' : 'Disconnect'}
        body={revoking === 'all'
          ? 'Every app you signed in with your browser is refused from its next call. Your keys are not touched. Sign in from an app again to reconnect it.'
          : 'The app is refused from its next call. Sign in from it again to reconnect.'}
        onCancel={() => setRevoking(null)}
        onConfirm={() => { if (revoking) void disconnect(revoking); }}
      />
    </>
  );
}
