import { useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession } from '../api/hooks';
import { useAllGrants, useRemoveGrant } from '../api/grants';
import { isNotAvailable } from '../api/orgAccess';
import { useOrgCatalog } from '../api/orgCatalog';
import { useMyOrgPermissions } from '../api/orgRoles';
import { ApiErrorState } from '../components/ApiErrorState';
import { ExpiresBadge } from '../components/grants/ExpiryPicker';
import { Avatar, Badge, Button, ButtonBase, Callout, Card, ConfirmDialog, EmptyRow, I, Input, LoadingRows, PageHeader, Segmented, Stat, Table, Toolbar, ToolbarSpacer } from '../components/ui';
import { describeApiError } from '../lib/apiError';
import { GRANT_PERMISSION, ORG_GRANT_PERMISSION, grantLabel, matchesFilter, type GrantFilter, type HeldGrant } from '../lib/grants';
import { orgLabel } from '../lib/orgOptions';
import { stepUpOnRefusal } from '../lib/resume';
import { holds, holdsIn } from '../policy/model';

const FILTERS: { value: GrantFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expiring', label: 'Expiring in 7 days' },
  { value: 'expired', label: 'Expired' },
  { value: 'permanent', label: 'No expiry' },
  { value: 'no-reason', label: 'No reason' },
];

/**
 * Everyone holding individual access: each single role or permission given to one person, where it
 * counts, why, who granted it and when it ends. A review page — the place to find grants that outlived
 * their reason, never expire, or were given without one.
 */
export function DirectGrantsPage() {
  const { setPage, pushToast } = useApp();
  const { data: session } = useSession();
  const q = useAllGrants();
  const { orgs } = useOrgCatalog();
  const orgPermissions = useMyOrgPermissions().data;
  const [filter, setFilter] = useState<GrantFilter>('all');
  const [needle, setNeedle] = useState('');
  const [removing, setRemoving] = useState<HeldGrant | null>(null);

  const grants = useMemo(() => q.data ?? [], [q.data]);
  const now = Date.now();
  const count = (f: GrantFilter) => grants.filter((g) => matchesFilter(g, f, now)).length;
  const low = needle.trim().toLowerCase();
  const shown = grants
    .filter((g) => matchesFilter(g, filter, now))
    .filter((g) => !low || [g.subject.email, g.subject.name, g.name, g.service, g.reason, g.grantedBy].some((v) => v?.toLowerCase().includes(low)))
    .sort((a, b) => (a.expiresAt ?? '9').localeCompare(b.expiresAt ?? '9') || (a.subject.email ?? '').localeCompare(b.subject.email ?? ''));
  const people = new Set(grants.map((g) => g.subject.id)).size;
  const mayRemove = (g: HeldGrant) => (g.org ? holdsIn(orgPermissions, g.org, ORG_GRANT_PERMISSION) : holds(session, GRANT_PERMISSION));

  const header = <PageHeader title="Direct grants" sub="Everyone holding individual access — single roles or permissions given to one person" />;
  if (isNotAvailable(q.error)) {
    return <>{header}<Callout tone="neutral" icon={I.info}>Individual access is not available yet on this server.</Callout></>;
  }
  if (q.isError) return <>{header}<ApiErrorState what="direct grants" error={q.error} onRetry={() => q.refetch()} /></>;

  return (
    <>
      {header}
      <div className="grid g4 mb-12">
        <Stat label="People" value={q.isLoading ? '…' : people} sub={`${grants.length} grant${grants.length === 1 ? '' : 's'}`} />
        <Stat label="Expiring in 7 days" value={q.isLoading ? '…' : count('expiring')} tone={count('expiring') ? 'warning' : undefined} onClick={() => setFilter('expiring')} />
        <Stat label="No expiry" value={q.isLoading ? '…' : count('permanent')} onClick={() => setFilter('permanent')} />
        <Stat label="No reason" value={q.isLoading ? '…' : count('no-reason')} tone={count('no-reason') ? 'warning' : undefined} onClick={() => setFilter('no-reason')} />
      </div>
      <Card pad="none">
        <Toolbar inset label="Filter grants">
          <Segmented label="Show" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, count: f.value === 'all' ? grants.length : count(f.value) }))} />
          <ToolbarSpacer />
          <Input size="sm" aria-label="Search grants" leading={I.search} placeholder="Person, grant, reason…" value={needle} onChange={(e) => setNeedle(e.target.value)} />
        </Toolbar>
        <Table className="rb-stack">
          <thead>
            <tr><th>Person</th><th>Grant</th><th>Where</th><th>Reason</th><th>Granted by</th><th>Expires</th><th className="actions" aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {q.isLoading && <LoadingRows rows={4} cols={7} />}
            {!q.isLoading && shown.length === 0 && <EmptyRow colSpan={7}>{grants.length ? 'No grant matches.' : 'Nobody holds individual access: everything comes from groups and roles.'}</EmptyRow>}
            {!q.isLoading && shown.map((g) => (
              <tr key={`${g.subject.id}:${g.id}`}>
                <td data-label="Person">
                  <ButtonBase className="row gap-8 rb-row-link" onClick={() => setPage('users', g.subject.id)}>
                    <Avatar name={g.subject.name || g.subject.email || g.subject.id} />
                    <span className="stack">
                      <span className="fw-medium">{g.subject.name || g.subject.email || g.subject.id}</span>
                      {g.subject.email && g.subject.name && <span className="small muted mono">{g.subject.email}</span>}
                    </span>
                  </ButtonBase>
                </td>
                <td data-label="Grant">
                  <span className="row wrap gap-4">
                    <Badge tone={g.kind === 'role' ? 'info' : 'plain'} mono={false}>{g.kind}</Badge>
                    <span className="mono">{g.name}</span>
                    {g.service !== 'jinbe' && <span className="small muted">on {g.service}</span>}
                  </span>
                </td>
                <td data-label="Where">{g.org ? orgLabel(g.org, orgs) : <span className="muted">platform</span>}</td>
                <td data-label="Reason">{g.reason ? <span className="small">{g.reason}</span> : <Badge tone="warning" mono={false}>no reason</Badge>}</td>
                <td data-label="Granted by"><span className="small muted">{g.grantedBy ?? '—'}</span></td>
                <td data-label="Expires"><ExpiresBadge expiresAt={g.expiresAt} /></td>
                <td className="actions">
                  {mayRemove(g) && <Button size="sm" variant="ghost" iconOnly icon={I.trash} aria-label={`Remove ${g.name} from ${g.subject.email ?? g.subject.id}`} onClick={() => setRemoving(g)} />}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {removing && <RemoveGrant grant={removing} pushToast={pushToast} onDone={() => setRemoving(null)} />}
    </>
  );
}

function RemoveGrant({ grant, pushToast, onDone }: { grant: HeldGrant; pushToast: ReturnType<typeof useApp>['pushToast']; onDone: () => void }) {
  const remove = useRemoveGrant(grant.subject.id, grant.org);
  const who = grant.subject.email ?? grant.subject.id;
  return (
    <ConfirmDialog
      open
      danger
      title={`Remove ${grantLabel(grant)} from ${who}?`}
      body="They lose what it gave them, unless a group or role gives the same."
      confirmLabel="Remove"
      busy={remove.isPending}
      onCancel={onDone}
      onConfirm={async () => {
        try {
          await remove.mutateAsync(grant.id);
          pushToast(`Removed ${grantLabel(grant)} from ${who}`);
          onDone();
        } catch (e) {
          if (stepUpOnRefusal(e, pushToast, { redo: `Remove ${grantLabel(grant)} from ${who} again (Direct grants): nothing was removed.` })) return;
          pushToast('The grant was not removed', { err: true, sub: describeApiError(e).detail });
        }
      }}
    />
  );
}
