import { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { useUsers, useGroupsMap, useUserSearch, useStats } from '../api/hooks';
import { I } from '../components/ui/Icons';
import { Avatar, Badge, Button, Card, EmptyRow, Input, PageHeader, Select, Table } from '../components/ui';
import { Pagination, usePagination } from '../components/ui/Pagination';
import { SkeletonRows } from '../components/ui/Skeleton';
import { kratosToUser, searchedToUser } from '../api/transforms';
import type { User } from '../api/types';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { takePendingChange, type PendingChange } from '../lib/pendingChange';
import { ApiErrorState } from '../components/ApiErrorState';
// The drawer lives beside its tabs; re-exported so the shell keeps one import for the people screens.
export { UserDrawer } from './users/UserDrawer';

// Small debounce so typing a name doesn't re-filter (and, for emails, re-query
// the server) on every keystroke.
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function UsersPage() {
  const { setUserDrawer, setGrant, pageParam, userDrawer } = useApp();
  const [q, setQ] = useState("");
  // A change that was refused for want of a second factor, waiting to be proposed again. Held
  // until the person it targets is on screen, because the drawer opens on a row, not on an email.
  const [resuming, setResuming] = useState<PendingChange | null>(() => takePendingChange());
  const [groupFilter, setGroupFilter] = useState("all");
  const dq = useDebounced(q.trim());

  // Search = server-side substring match over email + name (cached in-memory,
  // no directory walk). Browse (no query) = page 1 + manual load-more. Both
  // hooks always run; we render whichever mode is active. The total count comes
  // from the cached stats endpoint, not a full directory walk.
  const searching = dq.length >= 2;
  const searchQ = useUserSearch(dq);
  const browseQ = useUsers();
  const { data: stats } = useStats();
  const { data: groupsMap = {} } = useGroupsMap();

  const rows = useMemo<User[]>(
    () => (searching ? (searchQ.data ?? []).map(searchedToUser) : browseQ.users),
    [searching, searchQ.data, browseQ.users],
  );
  const filtered = useMemo(
    () => rows.filter(u => groupFilter === "all" || u.groups.includes(groupFilter)),
    [rows, groupFilter],
  );

  const pg = usePagination(filtered.length, 25);
  const paged = filtered.slice(pg.from, pg.to);

  const loading = searching ? searchQ.isLoading : browseQ.usersLoading;
  const total = stats?.total ?? browseQ.count;

  // Search for the person the interrupted change targets — page one need not hold them — then
  // reopen their drawer on the selection that was refused. It is re-PROPOSED, never re-applied:
  // the operator sees it and applies it, and every gate in jinbe runs again on that apply.
  useEffect(() => {
    if (!resuming) return;
    if (q !== resuming.email) { setQ(resuming.email); return; }
    const target = rows.find(u => u.email === resuming.email);
    if (!target) return;
    setUserDrawer({ mode: 'edit', user: target, resumeGroups: resuming.groups });
    setResuming(null);
  }, [resuming, rows, q, setUserDrawer]);

  // A link to one person (`#/people/<id>`): read them from the directory and open their drawer. The
  // row they would be clicked on need not be on page one, so the id is looked up, not the list.
  const linked = useQuery({
    queryKey: ['user-identity', pageParam],
    queryFn: () => api.getUser(pageParam as string),
    enabled: !!pageParam && userDrawer?.user?.id !== pageParam,
  });
  useEffect(() => {
    if (pageParam && linked.data && linked.data.id === pageParam && userDrawer?.user?.id !== pageParam) {
      setUserDrawer({ mode: 'edit', user: kratosToUser(linked.data) });
    }
  }, [pageParam, linked.data, userDrawer?.user?.id, setUserDrawer]);
  // Back from `#/people/<id>` to `#/users` closes the drawer the address no longer names.
  const lastParam = useRef(pageParam);
  useEffect(() => {
    if (lastParam.current && !pageParam && userDrawer?.mode === 'edit') setUserDrawer(null);
    lastParam.current = pageParam;
  }, [pageParam, userDrawer?.mode, setUserDrawer]);

  return (
    <>
      {pageParam && linked.isError && (
        <div className="mb-12"><ApiErrorState compact what="this person" error={linked.error} onRetry={() => linked.refetch()} /></div>
      )}
      <PageHeader
        title="Users"
        sub={<>{searching ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${total} identities`}{loading ? ' · loading…' : ''} · access comes from each member&apos;s groups</>}
        actions={
          <>
            <Button icon={I.shield} onClick={() => setGrant({})}>Grant access</Button>
            <Button variant="primary" icon={I.plus} onClick={() => setUserDrawer({ mode: "create" })}>Create user</Button>
          </>
        }
      />
      <Card>
        <div className="row wrap gap-12 px-12 py-8 border-b">
          <div className="flex-1 maxw-sm people-search">
            <Input size="sm" leading={I.search} type="search" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="Search name or email…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <Select size="sm" className="w-auto" value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
            <option value="all">All groups</option>
            {Object.keys(groupsMap).map(g => <option key={g} value={g}>{g}</option>)}
          </Select>
          <div className="flex-1" />
          <span className="small muted mono">{searching ? `${filtered.length} shown` : `${filtered.length} / ${total}`}</span>
        </div>
        <Table aria-busy={loading || undefined}>
          <thead><tr><th>Identity</th><th>Groups</th><th>Organizations</th><th>2FA</th><th>Last seen</th><th></th></tr></thead>
          <tbody>
            {paged.map(u => (
              <tr key={u.id} className="row-click" onClick={() => setUserDrawer({ mode: "edit", user: u })}>
                <td>
                  <div className="row gap-12">
                    <Avatar name={u.name} />
                    <div>
                      <div className="fw-medium">
                        {u.name} {!u.active && <Badge tone="warning">inactive</Badge>}
                      </div>
                      <div className="small muted mono">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {u.groups.length === 0
                    ? <span className="small muted">— no groups —</span>
                    : <span className="row wrap gap-4">{u.groups.map(g => <Badge key={g}>{g}</Badge>)}</span>}
                </td>
                <td>
                  {(() => {
                    // Effective membership we can show for this row = primary org
                    // UNION the additional list. `organizations` is undefined for
                    // search-hit rows (which omit it), so this shows at least the
                    // primary — never a misleading "none".
                    const orgs = Array.from(new Set([
                      ...(u.organizationId ? [u.organizationId] : []),
                      ...(u.organizations ?? []),
                    ]));
                    if (orgs.length === 0) return <span className="small muted">— none —</span>;
                    const preview = orgs.slice(0, 2);
                    return (
                      <span className="row wrap gap-4">
                        <span className="small muted mono" title={`${orgs.length} organization${orgs.length === 1 ? "" : "s"}`}>{orgs.length}</span>
                        {preview.map(o => <Badge key={o} title={o}>{o.length > 10 ? `${o.slice(0, 10)}…` : o}</Badge>)}
                        {orgs.length > preview.length && <Badge tone="plain" title={orgs.slice(2).join("\n")}>+{orgs.length - preview.length} more</Badge>}
                      </span>
                    );
                  })()}
                </td>
                <td>
                  {u.mfa === true && <Badge tone="success" title="Has second factor (TOTP / WebAuthn / backup codes)"><span className="chip-ico">{I.lock}</span>enabled</Badge>}
                  {u.mfa === false && <Badge tone="warning" title="No second factor — required before a group granting in every organisation"><span className="chip-ico">{I.alert}</span>off</Badge>}
                  {u.mfa === undefined && <span className="small muted">—</span>}
                </td>
                <td className="small muted nowrap">{u.last}</td>
                <td className="people-chev-col text-right"><span className="text-disabled">{I.chev}</span></td>
              </tr>
            ))}
            {loading && paged.length === 0 && <SkeletonRows rows={8} cols={6} />}
            {!loading && filtered.length === 0 && (
              <EmptyRow colSpan={6}>{searching ? `No users match "${dq}".` : "No users."}</EmptyRow>
            )}
          </tbody>
        </Table>
        {filtered.length > pg.pageSize && (
          <Pagination page={pg.page} pageSize={pg.pageSize} total={filtered.length} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
        )}
        {/* Manual load-more for very large directories: the store streams pages
            in the background, but this lets an operator pull the next page on
            demand (e.g. to widen a client-side name filter) without waiting. */}
        {!searching && browseQ.hasNextPage && (
          <div className="row justify-center px-16 py-8 border-t">
            <Button variant="ghost" size="sm" disabled={browseQ.isFetchingNextPage} onClick={() => browseQ.fetchNextPage()}>
              {browseQ.isFetchingNextPage ? "Loading…" : `Load more (${browseQ.count} loaded)`}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
