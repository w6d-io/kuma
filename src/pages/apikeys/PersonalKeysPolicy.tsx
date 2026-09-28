import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { accountsApi, type ApiKeyPolicy } from '../../api/accounts';
import { Card, ConfirmDialog, Field, Switch } from '../../components/ui';
import { statusOf, toastFor } from '../../lib/apiError';

/**
 * Whether members may create personal keys — keys that act as them in this organization, for an MCP
 * client. Same permission as the org's API keys. On a platform without personal keys (404) there is
 * nothing to decide, so nothing is shown. Forbidding them stops the keys already issued, so it asks.
 */
export function PersonalKeysPolicy({ org, orgName }: { org: string; orgName: string }) {
  const qc = useQueryClient();
  const { pushToast } = useApp();
  const key = ['api-key-policy', org];
  const q = useQuery({ queryKey: key, queryFn: () => accountsApi.apiKeyPolicy(org), retry: false, staleTime: 30_000 });
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  if (statusOf(q.error) === 404) return null;
  const allowed = q.data?.personal_keys === 'allowed';

  const save = async (next: ApiKeyPolicy['personal_keys']) => {
    setBusy(true);
    try {
      const saved = await accountsApi.setApiKeyPolicy(org, { personal_keys: next });
      qc.setQueryData(key, saved);
      pushToast(next === 'allowed' ? `Personal keys allowed in ${orgName}` : `Personal keys forbidden in ${orgName}`,
        { sub: next === 'allowed' ? 'Members can create them from Connections & keys.' : 'Keys already issued are refused from their next call.' });
    } catch (err) {
      pushToast(...toastFor(err));
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };

  return (
    <Card title="Personal keys" sub="Keys members create for themselves, to connect an AI assistant (an MCP client) that acts as them here">
      <Field
        label="Members may create personal keys"
        inline
        hint={q.isError
          ? 'The current setting could not be read.'
          : allowed
            ? 'A personal key acts as its member in this organization only, never with more than they hold, and expires within 30 days.'
            : 'Nobody can create one here, and keys created before are refused.'}
      >
        <Switch
          id="personal-keys-policy"
          on={allowed}
          disabled={q.isLoading || q.isError || busy}
          label="Members may create personal keys"
          onChange={(on) => (on ? void save('allowed') : setAsking(true))}
        />
      </Field>
      <ConfirmDialog
        open={asking}
        title={`Forbid personal keys in ${orgName}?`}
        body="Every personal key already issued for this organization is refused from its next call, and members can no longer create one. Their keys stay listed for them to revoke."
        confirmLabel="Forbid personal keys"
        danger
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={() => void save('forbidden')}
      />
    </Card>
  );
}
