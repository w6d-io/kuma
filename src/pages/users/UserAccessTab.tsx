import { useQuery } from '@tanstack/react-query';
import { orgAccessApi, isNotAvailable, type UserAccess } from '../../api/orgAccess';
import { useOrgCatalog } from '../../api/orgCatalog';
import { useUserIdentity } from '../../api/hooks';
import { membershipsOf } from '../../api/transforms';
import { orgLabel } from '../../lib/orgOptions';
import { sameGroups } from '../../lib/orgGrants';
import { Chip, PermTree } from '../../components/ui/Primitives';
import { ApiErrorState } from '../../components/ApiErrorState';
import { I } from '../../components/ui/Icons';
import type { User } from '../../api/types';
import type { RouteTable } from '../../policy/model';
import { SiteGroupRows } from './SiteGroupRows';
import { UserOrgsTab } from './UserOrgsTab';

type SiteRowsProps = Omit<React.ComponentProps<typeof SiteGroupRows>, 'checked' | 'toggle' | 'targetMfa'>;

/**
 * A person's access in one place, in its two layers side by side.
 *
 * Site access (left) comes from their own groups and holds everywhere — edited here. Org access
 * (right) is what each org's admin granted them in that org; it counts on that org's routes only and
 * never removes site access — edited on that org's My org page, linked from each row. Membership of
 * orgs is changed at the bottom of the right column (it used to be a tab of its own).
 */
export function UserAccessTab({ user, groups, toggle, siteRows, assignable, chain, onOpenOrg }: {
  user: User;
  groups: string[];
  toggle: (g: string) => void;
  siteRows: SiteRowsProps;
  assignable: { isError: boolean; isLoading: boolean };
  chain: { model: { groups: Record<string, Record<string, string[]>>; roles: Record<string, string[]> }; routeTables?: RouteTable[] };
  onOpenOrg: (orgId: string) => void;
}) {
  const accessQ = useQuery({ queryKey: ['user-access', user.id], queryFn: () => orgAccessApi.userAccess(user.id), retry: false });
  const missing = isNotAvailable(accessQ.error);
  const changed = !sameGroups(groups, user.groups);

  return (
    <div className="drawer-split">
      <section aria-labelledby="site-access-h">
        <h3 id="site-access-h" style={{ margin: '0 0 2px', fontSize: 13 }}>Site access <span className="muted" style={{ fontWeight: 400 }}>(everywhere)</span></h3>
        <div className="small muted" style={{ marginBottom: 8 }}>From their groups. Holds on every site, whatever org they are in.</div>
        {/* "You may not" and "I could not tell" must not look alike: one is an answer, the other a failure. */}
        {assignable.isError ? (
          <div className="small" style={{ color: 'var(--err)', marginBottom: 8 }}>
            The authorization model could not be read, so what you may assign is unknown.
          </div>
        ) : !assignable.isLoading && !siteRows.mayAssign ? (
          <div className="small muted" style={{ marginBottom: 8 }}>
            You cannot assign groups: your roles do not include managing members. Below is what this person already holds.
          </div>
        ) : null}
        <div className="panel mb-12" style={{ padding: 0 }}>
          <SiteGroupRows {...siteRows} checked={groups} toggle={toggle} targetMfa={user.mfa} />
        </div>
        <label className="input-label">Roles per site{changed ? ' · after this change' : ''}</label>
        {!changed && accessQ.data && Object.keys(accessQ.data.site.byService).length > 0 ? (
          <SiteRoles byService={accessQ.data.site.byService} />
        ) : (
          <div className="panel" style={{ padding: 12 }}><PermTree user={{ ...user, groups }} model={chain.model} routeTables={chain.routeTables} /></div>
        )}
      </section>

      <section aria-labelledby="org-access-h">
        <h3 id="org-access-h" style={{ margin: '0 0 2px', fontSize: 13 }}>Org access</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>Granted by each org&apos;s admin. Counts on that org&apos;s routes only; never removes site access.</div>
        {missing
          ? <OrgsWithoutGrants user={user} />
          : accessQ.isError
          ? <ApiErrorState compact what="org access" error={accessQ.error} onRetry={() => accessQ.refetch()} />
          : accessQ.isLoading
          ? <div className="panel small muted" style={{ padding: 14 }}>Loading org access…</div>
          : <OrgList orgs={accessQ.data?.orgs ?? []} onOpenOrg={onOpenOrg} />}
        <details style={{ marginTop: 12 }}>
          <summary className="small" style={{ cursor: 'pointer' }}>Change which orgs they belong to</summary>
          <div style={{ marginTop: 10 }}><UserOrgsTab user={user} /></div>
        </details>
      </section>
    </div>
  );
}

function SiteRoles({ byService }: { byService: Record<string, string[]> }) {
  const sites = Object.keys(byService).sort();
  return (
    <div className="panel" style={{ padding: 0 }}>
      {sites.map((s, i) => (
        <div key={s} style={{ display: 'flex', gap: 10, padding: '8px 14px', alignItems: 'center', borderBottom: i < sites.length - 1 ? '1px solid var(--line)' : 'none' }}>
          <span style={{ fontWeight: 500, minWidth: 90 }}>{s}</span>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {byService[s].length ? byService[s].map((r) => <Chip key={r}>{r}</Chip>) : <span className="small muted">no role</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function OrgList({ orgs, onOpenOrg }: { orgs: UserAccess['orgs']; onOpenOrg: (orgId: string) => void }) {
  if (orgs.length === 0) return <div className="panel small muted" style={{ padding: 14 }}>Not in any org. Their site access is all they have.</div>;
  return (
    <div className="panel" style={{ padding: 0 }}>
      {orgs.map((o, i) => (
        <div key={o.orgId} style={{ padding: '10px 14px', borderBottom: i < orgs.length - 1 ? '1px solid var(--line)' : 'none' }}>
          <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
            <span className="row" style={{ gap: 6, minWidth: 0 }}>
              <span style={{ fontWeight: 500 }} title={o.orgId}>{o.name}</span>
              <Chip tone={o.admin ? 'accent' : 'plain'} mono={false}>{o.admin ? 'org admin' : 'member'}</Chip>
            </span>
            <button className="btn ghost sm" onClick={() => onOpenOrg(o.orgId)} title="Grant or remove groups in this org">
              Manage <span style={{ width: 12, height: 12, display: 'inline-grid', placeItems: 'center' }}>{I.chev}</span>
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {o.grants.length
              ? o.grants.map((g) => <Chip key={g}>{g}</Chip>)
              : <span className="small muted">No groups granted in this org — site access only.</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Before the server answers org grants: the orgs they belong to, without what is granted in each. */
function OrgsWithoutGrants({ user }: { user: User }) {
  const identity = useUserIdentity(user.id).data;
  const { orgs: catalog } = useOrgCatalog();
  const ids = identity ? membershipsOf(identity) : [];
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="small" style={{ marginBottom: 6 }}>Org grants are not available yet on this server.</div>
      {ids.length
        ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{ids.map((o) => <Chip key={o} mono={false} title={o}>{orgLabel(o, catalog)} · member</Chip>)}</div>
        : <span className="small muted">Not in any org.</span>}
    </div>
  );
}
