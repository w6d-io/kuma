import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { accountsApi, type PersonalKeySecretView } from '../../api/accounts';
import { useMcpStatus } from '../../api/hooks';
import { useOrgCatalog } from '../../api/orgCatalog';
import { OrgPicker } from '../../components/OrgPicker';
import { Button, Drawer, EmptyHint, Field, FormGrid, Input, Select } from '../../components/ui';
import { statusOf, toastFor } from '../../lib/apiError';
import { orgLabel } from '../../lib/orgOptions';
import {
  allowedScopesFrom, initialScopes, normalizeCatalog, parseScopes, PERSONAL_EXPIRY_CHOICES, PERSONAL_EXPIRY_DEFAULT, type ScopeEntry,
} from '../../lib/apiKeys';
import { personalExpiryChoices } from '../../lib/mcpSettings';
import { ScopeField } from './parts';
import { SecretDrawer } from './SecretDrawer';
import { McpHelp } from './McpHelp';

function reasonOf(err: unknown): unknown {
  const d = (err as { details?: { details?: { reason?: unknown }; reason?: unknown } } | null)?.details;
  return d?.details?.reason ?? d?.reason;
}

/** The refusal jinbe gives when the organization forbids personal keys. */
function forbiddenByOrg(err: unknown): boolean {
  return statusOf(err) === 403 && reasonOf(err) === 'personal_keys_forbidden';
}

/** The refusal jinbe gives when an administrator limited AI assistants to other organizations. */
function outsideMcpScope(err: unknown): boolean {
  return statusOf(err) === 403 && reasonOf(err) === 'mcp_org_not_allowed';
}

/**
 * A personal key: one organization it acts in, scopes among what you hold there, 30 days at most —
 * then the key, once, with how to paste it into an MCP client. The scopes come from the org's
 * catalogue when you may read it; otherwise they are typed, and a refusal lists the allowed ones.
 */
export function CreatePersonalKeyDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { pushToast } = useApp();
  const { orgs } = useOrgCatalog();
  const [org, setOrg] = useState(orgs.length === 1 ? orgs[0].id : '');
  const [label, setLabel] = useState('');
  // The administrator's maximum (Settings → AI assistants) when jinbe says it; 30 days otherwise.
  const maxDays = useMcpStatus().data?.personalKeys?.maxDays;
  const expiryChoices = maxDays ? personalExpiryChoices(maxDays, PERSONAL_EXPIRY_CHOICES) : PERSONAL_EXPIRY_CHOICES;
  const [chosenExpiry, setExpiresIn] = useState<number | null>(null);
  const expiresIn = chosenExpiry !== null && expiryChoices.includes(chosenExpiry) ? chosenExpiry : (maxDays ?? PERSONAL_EXPIRY_DEFAULT);
  const catalogue = useQuery({ queryKey: ['api-keys', org, 'scopes'], queryFn: () => accountsApi.apiKeyScopes(org), enabled: !!org, staleTime: 60_000, retry: false });
  const [refused, setRefused] = useState<{ org: string; entries: ScopeEntry[] } | null>(null);
  const entries = catalogue.data ?? (refused?.org === org ? refused.entries : null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [scopesText, setScopesText] = useState('');
  const [orgError, setOrgError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<PersonalKeySecretView | null>(null);
  useEffect(() => { setPicked(null); setOrgError(null); }, [org]);
  useEffect(() => {
    if (entries && picked === null) setPicked(initialScopes(entries.map((e) => e.scope)));
  }, [entries, picked]);
  const allowed = entries?.map((e) => e.scope);
  const scopes = allowed ? (picked ?? []).filter((s) => allowed.includes(s)) : parseScopes(scopesText);
  const ready = !!org && !!label.trim() && scopes.length > 0 && !orgError;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const res = await accountsApi.createMyApiKey({ label: label.trim(), organization_id: org, scopes, expires_in_days: expiresIn });
      setCreated(res);
      onCreated();
    } catch (err) {
      if (forbiddenByOrg(err)) {
        setOrgError('This organization does not allow personal keys. Its administrators can allow them on its API keys page.');
        return;
      }
      if (outsideMcpScope(err)) {
        setOrgError('AI assistants are not enabled for this organization. A platform administrator chooses which organizations may use them.');
        return;
      }
      const list = allowedScopesFrom(err);
      if (list) setRefused({ org, entries: normalizeCatalog(list) });
      pushToast(...toastFor(err));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <SecretDrawer eyebrow={orgLabel(created.organization_id, orgs)} title={`${created.label} created`} secretLabel="Key" secret={created.key} onClose={onClose}>
        <p className="small muted m-0">
          It acts as you in {orgLabel(created.organization_id, orgs)} until {created.expires_at ? new Date(created.expires_at).toLocaleDateString() : 'it is revoked'}.
        </p>
        <McpHelp secret={created.key} framed={false} />
      </SecretDrawer>
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Connections & keys"
      title="Create a personal key"
      footer={<>
        <span className="small muted">The key is shown once, after creating.</span>
        <div className="row gap-8">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!ready} loading={busy}>Create key</Button>
        </div>
      </>}
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <FormGrid>
          <Field label="Organization" required error={orgError ?? undefined} hint={orgError ? undefined : 'The key acts as you in this organization only.'}>
            <OrgPicker value={org} onChange={setOrg} />
          </Field>
          <Field label="Label" required hint="Where the key is used, so you can tell your keys apart.">
            <Input placeholder="e.g. Assistant on my laptop" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          {!org && <Field label="Scopes" required><EmptyHint>Choose the organization first: the scopes are among what you hold there.</EmptyHint></Field>}
          {org && (
            <ScopeField
              entries={entries}
              loading={catalogue.isLoading}
              error={catalogue.error}
              value={scopes}
              onChange={setPicked}
              text={scopesText}
              onText={setScopesText}
              hint="What the key may do, among the permissions you hold in this organization. Pick at least one."
            />
          )}
          <Field label="Expires" hint={`Personal keys always expire, ${maxDays ?? PERSONAL_EXPIRY_DEFAULT} days at most. Revoking one stops it at once.`}>
            <Select value={expiresIn} onChange={(e) => setExpiresIn(Number(e.target.value))}>
              {expiryChoices.map((d) => <option key={d} value={d}>{d === 1 ? 'In 1 day' : `In ${d} days`}</option>)}
            </Select>
          </Field>
        </FormGrid>
      </form>
    </Drawer>
  );
}
