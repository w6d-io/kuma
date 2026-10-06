import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { accountsApi, type ApiKeySecretView } from '../../api/accounts';
import { useOrgCatalog } from '../../api/orgCatalog';
import { Button, Drawer, Field, FormGrid, Input, Select } from '../../components/ui';
import { orgLabel } from '../../lib/orgOptions';
import { toastFor } from '../../lib/apiError';
import { stepUpOnRefusal } from '../../lib/resume';
import { allowedScopesFrom, initialScopes, KEY_EXPIRY_CHOICES, normalizeCatalog, parseScopes, type ScopeEntry } from '../../lib/apiKeys';
import { ScopeField } from './parts';
import { SecretDrawer } from './SecretDrawer';

/**
 * A new machine key for an organization, made by platform staff (orgs.keys:write, a recent second
 * factor) from Create key on the API keys page (CreateKeyDrawer, whose "For" field is `ownerField`):
 * a label, scopes ticked by kind (permissions, site roles, groups), an expiry — then its secret, once.
 * The key works on every site serving the organization. The catalogue is the organization's, from
 * jinbe; when it cannot be read, the scopes are typed. No organization yet: the scopes wait for one.
 */
export function CreateOrgKeyDrawer({ org, ownerField, onClose, onCreated }: {
  org: string; ownerField?: ReactNode; onClose: () => void; onCreated: (org: string) => void;
}) {
  const { pushToast } = useApp();
  const { orgs } = useOrgCatalog();
  const orgName = org ? orgLabel(org, orgs) : '';
  const [label, setLabel] = useState('');
  const catalogue = useQuery({ queryKey: ['api-keys', org, 'scopes'], queryFn: () => accountsApi.apiKeyScopes(org), staleTime: 60_000, retry: false, enabled: !!org });
  const [refusedWith, setRefusedWith] = useState<ScopeEntry[] | null>(null);
  const entries = catalogue.data ?? refusedWith;
  const [expiresIn, setExpiresIn] = useState<number | null>(90);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [scopesText, setScopesText] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ApiKeySecretView | null>(null);
  useEffect(() => {
    if (entries && picked === null) setPicked(initialScopes(entries.map((e) => e.scope)));
  }, [entries, picked]);
  const allowed = entries?.map((e) => e.scope);
  const scopes = allowed ? (picked ?? []).filter((s) => allowed.includes(s)) : parseScopes(scopesText);
  const ready = !!org && !!label.trim() && scopes.length > 0;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const res = await accountsApi.createApiKey(org, { label: label.trim(), scopes, ...(expiresIn ? { expires_in_days: expiresIn } : {}) });
      setCreated(res);
      onCreated(org);
    } catch (err) {
      const refused = allowedScopesFrom(err);
      if (refused) setRefusedWith(normalizeCatalog(refused));
      if (stepUpOnRefusal(err, pushToast, { redo: 'Create the key again: your second factor is confirmed for the next 15 minutes.' })) return;
      pushToast(...toastFor(err));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <SecretDrawer
        eyebrow={orgName}
        title={`${created.label} created`}
        secretLabel="Client secret"
        secret={created.client_secret}
        details={[{ label: 'Client ID', value: created.client_id }]}
        onClose={onClose}
      >
        <p className="small muted m-0">
          A program exchanges the client ID and secret for a token (OAuth2 client credentials), then calls
          any site serving the organization with it. {created.expires_at ? <>The key stops working on {new Date(created.expires_at).toLocaleDateString()}.</> : <>The key does not expire; revoke it when it is no longer needed.</>}
        </p>
      </SecretDrawer>
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={orgName || undefined}
      title="Create API key"
      footer={<>
        <span className="small muted">The secret is shown once, after creating.</span>
        <div className="row gap-8">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!ready} loading={busy}>Create key</Button>
        </div>
      </>}
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <FormGrid>
          {ownerField}
          <Field label="Label" required hint="What the key is for, so it can be told apart later.">
            <Input placeholder="e.g. Billing sync" value={label} maxLength={200} autoFocus onChange={(e) => setLabel(e.target.value)} />
          </Field>
          {org ? <ScopeField
            entries={entries}
            loading={catalogue.isLoading}
            error={catalogue.error}
            value={scopes}
            onChange={setPicked}
            text={scopesText}
            onText={setScopesText}
          /> : <Field label="Scopes" hint="Choose the organization first: the scopes are those of the sites serving it."><span className="small muted">—</span></Field>}
          <Field label="Expires" hint="The key stops working after this. Revoking it stops it at once.">
            <Select value={expiresIn ?? ''} onChange={(e) => setExpiresIn(e.target.value ? Number(e.target.value) : null)}>
              {KEY_EXPIRY_CHOICES.map((d) => <option key={d ?? 'never'} value={d ?? ''}>{d ? `In ${d} days` : 'Never'}</option>)}
            </Select>
          </Field>
        </FormGrid>
      </form>
    </Drawer>
  );
}
