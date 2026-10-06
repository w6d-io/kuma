import { useApp } from '../contexts/AppContext';
import { useSession } from '../api/hooks';
import { useOrgCatalog } from '../api/orgCatalog';
import { OrgPicker } from '../components/OrgPicker';
import { Button, Card, EmptyState, I, PageHeader } from '../components/ui';
import { orgLabel } from '../lib/orgOptions';
import { holds } from '../policy/model';
import { OrgKeys } from './apikeys/OrgKeys';

/**
 * An organization's API keys: machine credentials that belong to the organization, not to a person,
 * valid on every site serving it. Here they are listed and revoked; platform staff create them on
 * the Organizations hub. The organization is the address (`#/apikeys/<org id>`). Personal keys are
 * not here: they belong to a person (Connections & keys).
 */
export function ApiKeysPage() {
  const { pageParam, setPage } = useApp();
  const { data: session } = useSession();
  const { orgs } = useOrgCatalog();
  const org = pageParam ?? '';
  // Staff read every organization's keys from the admin route; anybody else from the org's own.
  const from = holds(session, 'orgs:read') ? 'admin' : 'org';
  const mayCreate = holds(session, 'orgs.keys:write');

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
        ? (
          <OrgKeys
            key={org}
            org={org}
            orgName={orgLabel(org, orgs)}
            from={from}
            mayCreate={false}
            adminRevoke={mayCreate}
            actions={mayCreate && <Button size="sm" icon={I.plus} onClick={() => setPage('organizations', org)}>Create on Organizations</Button>}
          />
        )
        : <Card><EmptyState icon={I.key} title="Choose an organization">Its API keys show here.</EmptyState></Card>}
    </>
  );
}
