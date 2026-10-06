import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../contexts/AppContext';
import { useSession } from '../api/hooks';
import { useOrgCatalog } from '../api/orgCatalog';
import { OrgPicker } from '../components/OrgPicker';
import { Button, Card, EmptyState, I, PageHeader } from '../components/ui';
import { orgLabel } from '../lib/orgOptions';
import { holds } from '../policy/model';
import { CreateOrgKeyDrawer } from './apikeys/CreateOrgKeyDrawer';
import { OrgKeys } from './apikeys/OrgKeys';

/**
 * Organizations' API keys: machine credentials that belong to an organization, not to a person, valid
 * on every site serving it. The only place keys are made: platform staff (orgs.keys:write) create one
 * for any organization, picked in the form; here they are also listed and revoked. The organization
 * shown is the address (`#/apikeys/<org id>`). Personal keys are not here: they belong to a person
 * (Connections & keys).
 */
export function ApiKeysPage() {
  const { pageParam, setPage } = useApp();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const { orgs } = useOrgCatalog();
  const org = pageParam ?? '';
  // Staff read every organization's keys from the admin route; anybody else from the org's own.
  const from = holds(session, 'orgs:read') ? 'admin' : 'org';
  const mayCreate = holds(session, 'orgs.keys:write');
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="API keys"
        sub="Keys that let a program call an organization’s sites without a person signing in"
        actions={
          <div className="row gap-8">
            <div className="settings-org-picker">
              <OrgPicker value={org} onChange={(id) => setPage('apikeys', id || null)} />
            </div>
            {mayCreate && <Button variant="primary" icon={I.plus} onClick={() => setCreating(true)}>Create key</Button>}
          </div>
        }
      />
      {org
        ? <OrgKeys key={org} org={org} orgName={orgLabel(org, orgs)} from={from} adminRevoke={mayCreate} />
        : <Card><EmptyState icon={I.key} title="Choose an organization">Its API keys show here.</EmptyState></Card>}
      {creating && (
        <CreateOrgKeyDrawer
          initialOrg={org}
          onClose={() => setCreating(false)}
          onCreated={(made) => {
            void qc.invalidateQueries({ queryKey: ['api-keys', made] });
            if (made !== org) setPage('apikeys', made);
          }}
        />
      )}
    </>
  );
}
