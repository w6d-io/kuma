import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { accountsApi, type PersonalKeySecretView } from '../../api/accounts';
import { useMcpStatus } from '../../api/hooks';
import { Button, ChecklistGroups, Drawer, EmptyHint, Field, FormGrid, Input, RadioGroup, Select, type ChecklistGroup } from '../../components/ui';
import { statusOf, toastFor } from '../../lib/apiError';
import { PERSONAL_EXPIRY_CHOICES, PERSONAL_EXPIRY_DEFAULT, scopeGroupLabel, scopeHint, sortScopes, type PlatformScope } from '../../lib/apiKeys';
import { personalExpiryChoices } from '../../lib/mcpSettings';
import { SecretDrawer } from './SecretDrawer';
import { McpHelp } from './McpHelp';

function reasonOf(err: unknown): unknown {
  const d = (err as { details?: { details?: { reason?: unknown }; reason?: unknown } } | null)?.details;
  return d?.details?.reason ?? d?.reason;
}

/** The refusal jinbe gives when an administrator limited AI assistants to other groups. */
function outsideMcpGroups(err: unknown): boolean {
  const reason = reasonOf(err);
  return statusOf(err) === 403 && (reason === 'mcp_group_not_allowed' || reason === 'group_not_allowed');
}

/** The permissions as the checklist's groups: one per resource, each with what it lets a program do. */
function permissionGroups(entries: readonly PlatformScope[]): ChecklistGroup[] {
  const byGroup = new Map<string, string[]>();
  for (const { scope, group } of entries) byGroup.set(group, [...(byGroup.get(group) ?? []), scope]);
  return [...byGroup.entries()]
    .sort(([a], [b]) => scopeGroupLabel(a).localeCompare(scopeGroupLabel(b)))
    .map(([group, scopes]) => ({
      id: group,
      label: scopeGroupLabel(group),
      options: sortScopes(scopes).map((s) => ({ value: s, label: <span className="mono">{s}</span>, hint: scopeHint(s), search: `${group} ${s}` })),
    }));
}

/**
 * A personal key: not tied to any organization — it acts as you, with all your permissions (the
 * default: it follows what you hold at each call) or only the ones you choose among them. 30 days at
 * most — then the key, once, with how to paste it into an MCP client.
 */
export function CreatePersonalKeyDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { pushToast } = useApp();
  const [label, setLabel] = useState('');
  // The administrator's maximum (Settings → AI assistants) when jinbe says it; 30 days otherwise.
  const maxDays = useMcpStatus().data?.personalKeys?.maxDays;
  const expiryChoices = maxDays ? personalExpiryChoices(maxDays, PERSONAL_EXPIRY_CHOICES) : PERSONAL_EXPIRY_CHOICES;
  const [chosenExpiry, setExpiresIn] = useState<number | null>(null);
  const expiresIn = chosenExpiry !== null && expiryChoices.includes(chosenExpiry) ? chosenExpiry : (maxDays ?? PERSONAL_EXPIRY_DEFAULT);
  const [mode, setMode] = useState<'all' | 'chosen'>('all');
  const catalogue = useQuery({ queryKey: ['my-api-keys', 'scopes'], queryFn: () => accountsApi.myApiKeyScopes(), enabled: mode === 'chosen', staleTime: 60_000, retry: false });
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<PersonalKeySecretView | null>(null);
  const allowed = catalogue.data?.map((e) => e.scope) ?? [];
  const scopes = picked.filter((s) => allowed.includes(s));
  const ready = !!label.trim() && (mode === 'all' || scopes.length > 0) && !error;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const res = await accountsApi.createMyApiKey({ label: label.trim(), ...(mode === 'chosen' ? { scopes } : {}), expires_in_days: expiresIn });
      setCreated(res);
      onCreated();
    } catch (err) {
      if (outsideMcpGroups(err)) {
        setError('AI assistants are not enabled for your groups. A platform administrator chooses which groups may use them.');
        return;
      }
      pushToast(...toastFor(err));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const until = created.expires_at ? new Date(created.expires_at).toLocaleDateString() : 'it is revoked';
    return (
      <SecretDrawer eyebrow="Connections & keys" title={`${created.label} created`} secretLabel="Key" secret={created.key} onClose={onClose}>
        <p className="small muted m-0">
          {created.all_permissions === false
            ? `It acts as you, with the permissions you chose, until ${until}.`
            : `It acts as you, with all your permissions, until ${until}.`}
        </p>
        <McpHelp secret={created.key} framed={false} />
      </SecretDrawer>
    );
  }

  const chooser = () => {
    if (catalogue.isLoading) return <EmptyHint>Loading your permissions…</EmptyHint>;
    if (catalogue.error) return <EmptyHint>Your permissions could not be read. Try again, or keep all your permissions.</EmptyHint>;
    if (!catalogue.data?.length) return <EmptyHint>You hold no permission a key could be narrowed to.</EmptyHint>;
    return <ChecklistGroups label="Permissions" groups={permissionGroups(catalogue.data)} value={scopes} onChange={setPicked} searchAt={10} />;
  };

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
          <Field label="Label" required error={error ?? undefined} hint={error ? undefined : 'Where the key is used, so you can tell your keys apart.'}>
            <Input placeholder="e.g. Assistant on my laptop" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Permissions" hint="Checked again on every call: when you lose a permission, the key loses it too.">
            <RadioGroup
              label="Permissions"
              name="personal-key-permissions"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'all', label: 'All my permissions', hint: 'The key can do whatever you can, now and as your access changes.' },
                { value: 'chosen', label: 'Choose permissions', hint: 'Only the ones you tick, among those you hold.' },
              ]}
            />
          </Field>
          {mode === 'chosen' && <Field label="Chosen permissions" required>{chooser()}</Field>}
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
