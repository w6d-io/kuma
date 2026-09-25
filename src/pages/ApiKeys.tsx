import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../contexts/AppContext';
import { accountsApi, type ApiKeySecretView, type ApiKeyView } from '../api/accounts';
import { useOrgCatalog } from '../api/orgCatalog';
import { OrgPicker } from '../components/OrgPicker';
import { ApiErrorState } from '../components/ApiErrorState';
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyHint, EmptyRow, Field, Input, LoadingRows, PageHeader, Table } from '../components/ui';
import { parseScopes, allowedScopesFrom } from '../lib/apiKeys';
import { orgLabel } from '../lib/orgOptions';
import { toastFor } from '../lib/apiError';
import { timeAgo } from '../api/transforms';

/**
 * An organization's API keys: machine credentials (OAuth2 client-credentials clients) that belong
 * to the organization, not to a person. Listed without secrets; a new key's secret is shown once,
 * here, and cannot be read again. The organization is the address (`#/apikeys/<org id>`).
 */
export function ApiKeysPage() {
  const { pageParam, setPage } = useApp();
  const { orgs } = useOrgCatalog();
  const org = pageParam ?? '';

  return (
    <>
      <PageHeader
        title="API keys"
        sub={<>Keys that let a program call an organization&apos;s sites without a person signing in</>}
        actions={
          <div className="settings-org-picker">
            <OrgPicker value={org} onChange={(id) => setPage('apikeys', id || null)} />
          </div>
        }
      />
      {org
        ? <OrgApiKeys key={org} org={org} orgName={orgLabel(org, orgs)} />
        : <Card pad="md"><EmptyHint>Choose an organization to see its API keys.</EmptyHint></Card>}
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

  if (q.isError) return <ApiErrorState what="API keys" error={q.error} onRetry={() => q.refetch()} />;
  const keys = q.data?.data ?? [];

  return (
    <Card
      title={orgName}
      sub={q.isLoading ? 'Loading…' : `${keys.length} key${keys.length === 1 ? '' : 's'}`}
      actions={<Button variant="primary" size="sm" onClick={() => setCreating(true)}>Create key</Button>}
      pad="none"
    >
      <Table>
        <thead><tr><th>Label</th><th>Scopes</th><th>Created</th><th /></tr></thead>
        <tbody>
          {q.isLoading && <LoadingRows rows={3} cols={4} />}
          {!q.isLoading && keys.length === 0 && (
            <EmptyRow colSpan={4}>No API keys for this organization.</EmptyRow>
          )}
          {keys.map(k => (
            <tr key={k.client_id}>
              <td>
                <div className="fw-medium">{k.label}</div>
                <div className="small muted mono">{k.client_id}</div>
              </td>
              <td><span className="row wrap gap-4">{k.scopes.map(s => <Badge key={s}>{s}</Badge>)}</span></td>
              <td className="small muted nowrap">
                {k.created_at ? timeAgo(k.created_at) : '—'}{k.created_by ? ` · ${k.created_by}` : ''}
              </td>
              <td className="align-right">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRevoking(k)}>Revoke</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {creating && (
        <CreateKeyDrawer
          org={org}
          orgName={orgName}
          onClose={() => setCreating(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: key })}
        />
      )}
      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke ${revoking?.label ?? 'this key'}?`}
        danger
        busy={busy}
        confirmLabel="Revoke key"
        body={<>Programs using this key are refused from their next call. This cannot be undone — a new key has a new secret.</>}
        onCancel={() => setRevoking(null)}
        onConfirm={() => { if (revoking) void revoke(revoking); }}
      />
    </Card>
  );
}

function CreateKeyDrawer({ org, orgName, onClose, onCreated }: {
  org: string; orgName: string; onClose: () => void; onCreated: () => void;
}) {
  const { pushToast } = useApp();
  const [label, setLabel] = useState('');
  const [scopesText, setScopesText] = useState('api:read');
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [created, setCreated] = useState<ApiKeySecretView | null>(null);
  const scopes = parseScopes(scopesText);

  const submit = async () => {
    if (!label.trim() || scopes.length === 0) return;
    setBusy(true);
    try {
      const res = await accountsApi.createApiKey(org, { label: label.trim(), scopes });
      setCreated(res);
      onCreated();
    } catch (err) {
      setAllowed(allowedScopesFrom(err));
      pushToast(...toastFor(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.client_secret);
      pushToast('Secret copied');
    } catch {
      pushToast('Could not copy — select the secret and copy it by hand', { err: true });
    }
  };

  if (created) {
    return (
      <Drawer
        open
        onClose={onClose}
        eyebrow={orgName}
        title="Key created"
        footer={<><span className="small muted">The secret is not shown again.</span><Button variant="primary" onClick={onClose}>Done</Button></>}
      >
        <div className="small muted mb-12">
          Copy the secret now and store it somewhere safe. It cannot be shown again — if it is lost,
          revoke this key and create a new one.
        </div>
        <Field label="Client ID">
          <Input mono readOnly value={created.client_id} onFocus={e => e.currentTarget.select()} />
        </Field>
        <Field label="Secret">
          <div className="row gap-8">
            <Input mono className="flex-1" readOnly value={created.client_secret} onFocus={e => e.currentTarget.select()} />
            <Button onClick={copy}>Copy</Button>
          </div>
        </Field>
      </Drawer>
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={orgName}
      title="Create API key"
      footer={
        <>
          <span className="small muted">The secret is shown once, after creating.</span>
          <div className="row">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={busy || !label.trim() || scopes.length === 0}>
              {busy ? 'Creating…' : 'Create key'}
            </Button>
          </div>
        </>
      }
    >
      <Field label="Label" required>
        <Input id="key-label" placeholder="e.g. Billing sync" value={label} maxLength={200} onChange={e => setLabel(e.target.value)} />
      </Field>
      <Field
        label="Scopes"
        required
        hint={allowed
          ? <>Allowed: {allowed.map(s => <Badge key={s}>{s}</Badge>)}</>
          : 'Separate with commas or spaces. What the key may do on the organization’s sites.'}
      >
        <Input id="key-scopes" mono value={scopesText} onChange={e => setScopesText(e.target.value)} />
      </Field>
    </Drawer>
  );
}
