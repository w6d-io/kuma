import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../contexts/AppContext';
import { useSession } from '../api/hooks';
import { useOrgCatalog } from '../api/orgCatalog';
import { OrgPicker } from '../components/OrgPicker';
import { Button, I, PageHeader } from '../components/ui';
import { MY_API_KEYS, usePersonalKeysAvailable } from '../hooks/usePersonalKeys';
import { orgLabel } from '../lib/orgOptions';
import { holds } from '../policy/model';
import { CreateKeyDrawer } from './apikeys/CreateKeyDrawer';
import { OrgKeys } from './apikeys/OrgKeys';
import { PersonalKeys } from './apikeys/PersonalKeys';

/**
 * Every API key, and the one place keys are made. It opens on My keys: the person's own keys, acting
 * as them. The picker shows an organization's keys instead — machine credentials of the organization,
 * valid on every site serving it (`#/apikeys/<org id>`). Create key makes either: for me, or, for
 * platform staff (orgs.keys:write), for any organization picked in the form.
 */
export function ApiKeysPage() {
  const { pageParam, setPage } = useApp();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const { orgs } = useOrgCatalog();
  const org = pageParam ?? '';
  // Staff read every organization's keys from the admin route; anybody else from the org's own.
  const from = holds(session, 'orgs:read') ? 'admin' : 'org';
  const mayCreateOrgKeys = holds(session, 'orgs.keys:write');
  const personalAvailable = usePersonalKeysAvailable();
  const [creating, setCreating] = useState(false);
  const mayCreate = mayCreateOrgKeys || personalAvailable;

  return (
    <>
      <PageHeader
        title="API keys"
        sub="Keys that let a program call the platform: as you, or for an organization’s sites"
        actions={
          <div className="row gap-8">
            <div className="settings-org-picker">
              <OrgPicker value={org} onChange={(id) => setPage('apikeys', id || null)} ariaLabel="Show keys of" noneLabel="My keys" />
            </div>
            {mayCreate && <Button variant="primary" icon={I.plus} onClick={() => setCreating(true)}>Create key</Button>}
          </div>
        }
      />
      {org
        ? <OrgKeys key={org} org={org} orgName={orgLabel(org, orgs)} from={from} adminRevoke={mayCreateOrgKeys} />
        : <PersonalKeys />}
      {creating && (
        <CreateKeyDrawer
          initialOwner={org}
          mayCreateOrgKeys={mayCreateOrgKeys}
          personalAvailable={personalAvailable}
          onClose={() => setCreating(false)}
          onCreated={(owner) => {
            void qc.invalidateQueries({ queryKey: owner ? ['api-keys', owner] : MY_API_KEYS });
            if (owner !== org) setPage('apikeys', owner || null);
          }}
        />
      )}
    </>
  );
}
