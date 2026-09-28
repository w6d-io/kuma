import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../contexts/AppContext';
import { accountsApi, type ApiKeyView } from '../api/accounts';
import { useOrgCatalog } from '../api/orgCatalog';
import { OrgPicker } from '../components/OrgPicker';
import { ApiErrorState } from '../components/ApiErrorState';
import { Button, Card, ConfirmDialog, EmptyRow, EmptyState, I, LoadingRows, PageHeader, Table, TagList, Th } from '../components/ui';
import { orgLabel } from '../lib/orgOptions';
import { toastFor } from '../lib/apiError';
import { CreateOrgKeyDrawer } from './apikeys/CreateOrgKeyDrawer';
import { PersonalKeysPolicy } from './apikeys/PersonalKeysPolicy';
import { CreatorCell, ExpiryCell, LastUsedCell } from './apikeys/parts';

/**
 * An organization's API keys: machine credentials (OAuth2 client-credentials clients) that belong
 * to the organization, not to a person. Listed without secrets; a new key's secret is shown once,
 * in the create drawer, and cannot be read again. The organization is the address
 * (`#/apikeys/<org id>`). Below the keys, whether members may create personal keys here.
 */
export function ApiKeysPage() {
  const { pageParam, setPage } = useApp();
  const { orgs } = useOrgCatalog();
  const org = pageParam ?? '';

  return (
    <>
      <PageHeader
        title="API keys"
        sub="Keys that let a program call an organization’s sites without a person signing in"
        actions={
          <div className="settings-org-picker">
            <OrgPicker value={org} onChange={(id) => setPage('apikeys', id || null)} />
          </div>
        }
      />
      {org
        ? <OrgApiKeys key={org} org={org} orgName={orgLabel(org, orgs)} />
        : <Card><EmptyState icon={I.key} title="Choose an organization">Its API keys, and whether its members may create personal keys, show here.</EmptyState></Card>}
    </>
  );
}

function OrgApiKeys({ org, orgName }: { org: string; orgName: string }) {
  const qc = useQueryClient();
  const { pushToast } = useApp();
  const key = ['api-keys', org];
  const q = useQuery({ queryKey: key, queryFn: () => accountsApi.listApiKeys(org), staleTime: 10_000 });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const [busy, setBusy] = useState(false);

  const revoke = async (k: ApiKeyView) => {
    setBusy(true);
    try {
      await accountsApi.revokeApiKey(org, k.client_id);
      pushToast(`Revoked ${k.label}`, { sub: 'Programs using it are refused from their next call.' });
    } catch (err) {
      pushToast(...toastFor(err));
    } finally {
      setBusy(false);
      setRevoking(null);
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const keys = q.data?.data ?? [];
  // A column only once jinbe says when a key was last used: a column of dashes informs nobody.
  const lastUsed = keys.some((k) => k.last_used_at !== undefined);
  const cols = lastUsed ? 6 : 5;
  const create = <Button variant="primary" size="sm" icon={I.plus} onClick={() => setCreating(true)}>Create key</Button>;

  return (
    <div className="stack gap-16">
      {q.isError ? (
        <ApiErrorState what="API keys" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Card
          title={orgName}
          sub={q.isLoading ? 'Loading…' : `${keys.length} key${keys.length === 1 ? '' : 's'}`}
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
                <EmptyRow colSpan={cols}>No API keys yet. Create one for each program that calls this organization’s sites, so each can be revoked alone.</EmptyRow>
              )}
              {keys.map((k) => (
                <tr key={k.client_id}>
                  <td className="min-w-0">
                    <div className="fw-medium">{k.label || 'Untitled key'}</div>
                    <div className="small muted mono break-all">{k.client_id}</div>
                  </td>
                  <td><TagList items={k.scopes} label={`Scopes of ${k.label}`} /></td>
                  <td><ExpiryCell expiresAt={k.expires_at} /></td>
                  <td><CreatorCell id={k.created_by} at={k.created_at} /></td>
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
      <PersonalKeysPolicy org={org} orgName={orgName} />
      {creating && (
        <CreateOrgKeyDrawer
          org={org}
          orgName={orgName}
          onClose={() => setCreating(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: key })}
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
    </div>
  );
}
