import { useQuery } from '@tanstack/react-query';
import { orgAccessApi, isNotAvailable, OWNER_ROLE, type UserAccess } from '../../api/orgAccess';
import { useOrgCatalog } from '../../api/orgCatalog';
import { useUserIdentity } from '../../api/hooks';
import { membershipsOf } from '../../api/transforms';
import { orgLabel } from '../../lib/orgOptions';
import { roleLabel, sameSet } from '../../lib/orgRoles';
import { Badge, Button, Card, TwoFactorBadge } from '../../components/ui';
import { ApiErrorState } from '../../components/ApiErrorState';
import { I } from '../../components/ui/Icons';
import type { User } from '../../api/types';
import { SiteAccessTree } from '../access/SiteAccessTree';
import { SiteGroupRows } from './SiteGroupRows';
import { UserOrgsTab } from './UserOrgsTab';

type SiteRowsProps = Omit<React.ComponentProps<typeof SiteGroupRows>, 'checked' | 'toggle' | 'targetMfa'>;

/**
 * A person's access in one place, in its two layers side by side.
 *
 * Site access (left) comes from their own groups and holds everywhere — edited here. Org access
 * (right) is the org roles assigned to them in each org and the org permissions those give; it counts
 * on that org's routes only and never removes site access — edited on that org's My org page, linked
 * from each row. Membership of
 * orgs is changed at the bottom of the right column (it used to be a tab of its own).
 */
export function UserAccessTab({ user, groups, toggle, siteRows, onOpenOrg }: {
  user: User;
  groups: string[];
  toggle: (g: string) => void;
  siteRows: SiteRowsProps;
  onOpenOrg: (orgId: string) => void;
}) {
  const accessQ = useQuery({ queryKey: ['user-access', user.id], queryFn: () => orgAccessApi.userAccess(user.id), retry: false });
  const missing = isNotAvailable(accessQ.error);
  const changed = !sameSet(groups, user.groups);

  return (
    <div className="drawer-split">
      <section aria-labelledby="site-access-h">
        <h3 id="site-access-h" className="mt-0 mb-2 text-base">Site access <span className="muted fw-regular">(everywhere)</span></h3>
        <div className="small muted mb-8">From their groups. Holds on every site, whatever org they are in.</div>
        {accessQ.data?.secondFactor && <TheirSecondFactor sf={accessQ.data.secondFactor} />}
        {!siteRows.mayAssign ? (
          <div className="small muted mb-8">
            You cannot assign groups (groups.members:write). Below is what this person already holds.
          </div>
        ) : null}
        <Card className="mb-12">
          <SiteGroupRows {...siteRows} checked={groups} toggle={toggle} targetMfa={user.mfa} />
        </Card>
        <label className="input-label">Roles per site{changed ? ' · after this change' : ''}</label>
        {!changed && accessQ.data && Object.keys(accessQ.data.site.byService).length > 0 ? (
          <SiteRoles byService={accessQ.data.site.byService} />
        ) : (
          <Card pad="sm"><SiteAccessTree user={{ ...user, groups }} /></Card>
        )}
      </section>

      <section aria-labelledby="org-access-h">
        <h3 id="org-access-h" className="mt-0 mb-2 text-base">Org access</h3>
        <div className="small muted mb-8">Roles assigned in each org by its owners. Count on that org&apos;s routes only; never remove site access.</div>
        {missing
          ? <OrgsWithoutGrants user={user} />
          : accessQ.isError
          ? <ApiErrorState compact what="org access" error={accessQ.error} onRetry={() => accessQ.refetch()} />
          : accessQ.isLoading
          ? <Card pad="md" className="small muted">Loading org access…</Card>
          : <OrgList orgs={accessQ.data?.orgs ?? []} onOpenOrg={onOpenOrg} />}
        <details className="mt-12">
          <summary className="small cursor-pointer">Change which orgs they belong to</summary>
          <div className="mt-12"><UserOrgsTab user={user} /></div>
        </details>
      </section>
    </div>
  );
}

function SiteRoles({ byService }: { byService: Record<string, string[]> }) {
  const sites = Object.keys(byService).sort();
  return (
    <Card>
      {sites.map((s) => (
        <div key={s} className="people-sep people-row row gap-12">
          <span className="fw-medium people-site-name">{s}</span>
          <span className="row wrap gap-4">
            {byService[s].length ? byService[s].map((r) => <Badge key={r}>{r}</Badge>) : <span className="small muted">no role</span>}
          </span>
        </div>
      ))}
    </Card>
  );
}

function OrgList({ orgs, onOpenOrg }: { orgs: UserAccess['orgs']; onOpenOrg: (orgId: string) => void }) {
  if (orgs.length === 0) return <Card pad="md" className="small muted">Not in any org. Their site access is all they have.</Card>;
  return (
    <Card>
      {orgs.map((o) => (
        <div key={o.orgId} className="people-sep people-row roomy">
          <div className="row gap-8 justify-between">
            <span className="row gap-8 min-w-0">
              <span className="fw-medium" title={o.orgId}>{o.name}</span>
              <Badge tone={o.roles.includes(OWNER_ROLE) ? 'accent' : 'plain'} mono={false}>{o.roles.includes(OWNER_ROLE) ? 'owner' : 'member'}</Badge>
            </span>
            <Button variant="ghost" size="sm" trailing={I.chev} onClick={() => onOpenOrg(o.orgId)} title="Assign or remove roles in this org">
              Manage
            </Button>
          </div>
          <div className="row wrap gap-4 mt-8">
            {o.roles.length
              ? o.roles.map((r) => { const l = roleLabel(r); return <Badge key={r} title={r}>{l.site ? `${l.site} · ${l.name}` : l.name}</Badge>; })
              : <span className="small muted">No role assigned in this org — site access only.</span>}
          </div>
          {o.permissions.length > 0 && (
            <div className="small muted mt-4 mono" title="Org permissions held here, as the policy decides them (assigned roles and the every-org map)">
              {o.permissions.join(' · ')}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

/** Before the server answers org access: the orgs they belong to, without the roles in each. */
function OrgsWithoutGrants({ user }: { user: User }) {
  const identity = useUserIdentity(user.id).data;
  const { orgs: catalog } = useOrgCatalog();
  const ids = identity ? membershipsOf(identity) : [];
  return (
    <Card pad="md">
      <div className="small mb-8">Org roles are not available yet on this server.</div>
      {ids.length
        ? <div className="row wrap gap-4">{ids.map((o) => <Badge key={o} mono={false} title={o}>{orgLabel(o, catalog)} · member</Badge>)}</div>
        : <span className="small muted">Not in any org.</span>}
    </Card>
  );
}

/** Whether their groups make two-step sign-in mandatory for them, and whether they are ready for it. */
function TheirSecondFactor({ sf }: { sf: NonNullable<UserAccess['secondFactor']> }) {
  const n = sf.stepUpPermissions?.length ?? 0;
  return (
    <div className="row gap-8 items-center wrap small mb-8">
      {sf.required ? <TwoFactorBadge kind="required" title={`Required by ${sf.requiredBecause.join(', ')}`} /> : <span className="muted">Two-step sign-in optional</span>}
      {sf.required && <span>as a member of {sf.requiredBecause.join(', ')}</span>}
      {sf.enrolled === true && <Badge tone="success" mono={false}>enrolled</Badge>}
      {sf.enrolled === false && <TwoFactorBadge kind="needs-enrol" title="No second factor enrolled: groups that require one cannot be given to them." />}
      {n > 0 && <span className="muted">{n} permission{n === 1 ? '' : 's'} need a recent second factor</span>}
    </div>
  );
}
