import { emptyOrganisationsHint, organisationsSourceNote } from '../auth/authority';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Button, Card, EmptyHint, PageHeader, Select } from '../components/ui';
import { SkeletonPanel } from '../components/ui/Skeleton';
import { OrgPicker } from '../components/OrgPicker';
import { useMyOrganizationNames, useMyOrganizationsScope } from '../api/hooks';
import { useOrgCatalog } from '../api/orgCatalog';
import { orgLabel } from '../lib/orgOptions';
import { holdsIn } from '../policy/model';
import { useMyOrg } from '../hooks/useMyOrg';
import { OrgMembers } from './orgadmin/OrgMembers';
import { OrgDomains } from './orgadmin/OrgDomains';

/**
 * "My org": one organization from the inside — its members and the org roles they hold there.
 *
 * What the caller may do here is what they hold IN this org (`orgPermissions`): org.members:write to
 * assign roles (only roles whose every permission they hold), org.keys:read for its API keys. A role
 * assigned here counts only on this org's routes, and never touches what somebody holds on the
 * platform through their groups. The org is the address (`#/orgadmin/<org id>`), so the Access view in
 * a person's drawer can link straight here.
 */
export function OrgAdminPage() {
  const { pushToast, pageParam, setPage } = useApp();
  const { show, pickAny, administered, orgPermissions, isLoading } = useMyOrg();
  const scope = useMyOrganizationsScope().data ?? 'delegated';
  const names = useMyOrganizationNames().data ?? {};
  const { orgs: catalog } = useOrgCatalog();

  const active = pageParam || (pickAny ? '' : administered[0] ?? '');
  const orgName = pickAny ? orgLabel(active, catalog) : names[active] ?? orgLabel(active, catalog);

  if (isLoading) {
    return (
      <>
        <PageHeader title="My org" sub="Reading the organizations you belong to…" />
        <div aria-busy="true"><SkeletonPanel lines={4} /></div>
      </>
    );
  }

  if (!show) {
    return (
      <>
        <PageHeader title="My org" sub={organisationsSourceNote(scope) ?? 'Your organization\'s members and their roles'} />
        <Card className="p-32"><EmptyHint>{emptyOrganisationsHint(scope).message}</EmptyHint></Card>
      </>
    );
  }

  const mayManage = holdsIn(orgPermissions, active, 'org.members:write');
  // An org picked from every org that the caller's answer does not list: let jinbe decide (the
  // every-org map may reach it), and say its refusal rather than guessing one.
  const mayRead = holdsIn(orgPermissions, active, 'org.members:read') || (pickAny && !(active in orgPermissions));

  return (
    <>
      <PageHeader
        title="My org"
        sub={<>Roles you assign here count on this organization&apos;s routes only — members keep their platform access</>}
        actions={<>
          {pickAny
            ? <span className="orgs-picker"><OrgPicker value={active} onChange={(id) => setPage('orgadmin', id || null)} /></span>
            : administered.length > 1 && (
              <Select aria-label="Organization" className="w-auto" value={active} onChange={(e) => setPage('orgadmin', e.target.value)}>
                {administered.map((o) => <option key={o} value={o}>{names[o] ?? o}</option>)}
              </Select>
            )}
          {active && holdsIn(orgPermissions, active, 'org.keys:read') && <Button icon={I.key} onClick={() => setPage('apikeys', active)}>API keys</Button>}
        </>}
      />
      {!active
        ? <Card className="p-32"><EmptyHint>Choose an organization to see its members.</EmptyHint></Card>
        : mayRead
          ? <div className="stack gap-16">
              <OrgMembers key={active} org={active} orgName={orgName} mayManage={mayManage} pushToast={pushToast} />
              <OrgDomains key={`d-${active}`} org={active} mayManage={mayManage} pushToast={pushToast} />
            </div>
          : <Card className="p-32"><EmptyHint>You hold no role here that shows its members (org.members:read in {orgName}).</EmptyHint></Card>}
    </>
  );
}
