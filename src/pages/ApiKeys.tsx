import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../contexts/AppContext';
import { accountsApi, type ApiKeySecretView, type ApiKeyView } from '../api/accounts';
import { useOrgCatalog } from '../api/orgCatalog';
import { OrgPicker } from '../components/OrgPicker';
import { ApiErrorState } from '../components/ApiErrorState';
import { Chip, Drawer, ConfirmDialog, EmptyHint } from '../components/ui/Primitives';
import { SkeletonRows } from '../components/ui/Skeleton';
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
      <div className="page-head">
        <div>
          <h1>API keys</h1>
          <div className="sub">Keys that let a program call an organization&apos;s sites without a person signing in</div>
        </div>
        <div className="page-actions">
          <OrgPicker value={org} onChange={(id) => setPage('apikeys', id || null)} style={{ minWidth: 240 }} />
        </div>
      </div>
      {org
        ? <OrgApiKeys key={org} org={org} orgName={orgLabel(org, orgs)} />
        : <div className="panel" style={{ padding: 40 }}><EmptyHint>Choose an organization to see its API keys.</EmptyHint></div>}
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
    <div className="panel">
      <div className="panel-head">
        <div><h3>{orgName}</h3><div className="sub">{q.isLoading ? 'Loading…' : `${keys.length} key${keys.length === 1 ? '' : 's'}`}</div></div>
        <button className="btn primary" onClick={() => setCreating(true)}>Create key</button>
      </div>
      <table className="table">
        <thead><tr><th>Label</th><th>Scopes</th><th>Created</th><th></th></tr></thead>
        <tbody>
          {q.isLoading && <SkeletonRows rows={3} cols={4} />}
          {!q.isLoading && keys.length === 0 && (
            <tr><td colSpan={4}><EmptyHint>No API keys for this organization.</EmptyHint></td></tr>
          )}
          {keys.map(k => (
            <tr key={k.client_id}>
              <td>
                <div style={{ fontWeight: 500 }}>{k.label}</div>
                <div className="small muted mono">{k.client_id}</div>
              </td>
              <td><span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{k.scopes.map(s => <Chip key={s}>{s}</Chip>)}</span></td>
              <td className="small muted nowrap">
                {k.created_at ? timeAgo(k.created_at) : '—'}{k.created_by ? ` · ${k.created_by}` : ''}
              </td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn ghost sm" disabled={busy} onClick={() => setRevoking(k)}>Revoke</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
    </div>
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
        footer={<><span className="small muted">The secret is not shown again.</span><button className="btn primary" onClick={onClose}>Done</button></>}
      >
        <div className="small muted mb-12">
          Copy the secret now and store it somewhere safe. It cannot be shown again — if it is lost,
          revoke this key and create a new one.
        </div>
        <label className="input-label">Client ID</label>
        <input className="input mono mb-12" readOnly value={created.client_id} onFocus={e => e.currentTarget.select()} />
        <label className="input-label">Secret</label>
        <div className="row" style={{ gap: 8 }}>
          <input className="input mono" style={{ flex: 1 }} readOnly value={created.client_secret} onFocus={e => e.currentTarget.select()} />
          <button className="btn" onClick={copy}>Copy</button>
        </div>
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
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={submit} disabled={busy || !label.trim() || scopes.length === 0}>
              {busy ? 'Creating…' : 'Create key'}
            </button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <label className="input-label" htmlFor="key-label">Label *</label>
        <input id="key-label" className="input" placeholder="e.g. Billing sync" value={label} maxLength={200} onChange={e => setLabel(e.target.value)} />
      </div>
      <div className="mb-12">
        <label className="input-label" htmlFor="key-scopes">Scopes *</label>
        <input id="key-scopes" className="input mono" value={scopesText} onChange={e => setScopesText(e.target.value)} />
        <div className="small muted" style={{ marginTop: 4 }}>
          {allowed
            ? <>Allowed: {allowed.map(s => <Chip key={s}>{s}</Chip>)}</>
            : 'Separate with commas or spaces. What the key may do on the organization’s sites.'}
        </div>
      </div>
    </Drawer>
  );
}
