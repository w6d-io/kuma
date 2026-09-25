import { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { useUsers, useGroupsMap, useUserSearch, useStats } from '../api/hooks';
import { I } from '../components/ui/Icons';
import { Chip, Avatar } from '../components/ui/Primitives';
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
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <div className="sub">{searching ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${total} identities`}{loading ? ' · loading…' : ''} · access comes from each member&apos;s groups</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setGrant({})}>
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.shield}</span>
            Grant access
          </button>
          <button className="btn primary" onClick={() => setUserDrawer({ mode: "create" })}>
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.plus}</span>
            Create user
          </button>
        </div>
      </div>
      <div className="panel">
        <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--line)" }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }}>{I.search}</span>
            <input className="input" type="search" autoComplete="off" data-1p-ignore data-lpignore="true" style={{ paddingLeft: 30 }} placeholder="Search name or email…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <select className="input" style={{ width: "auto" }} value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
            <option value="all">All groups</option>
            {Object.keys(groupsMap).map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <div className="flex-1" />
          <span className="small muted mono">{searching ? `${filtered.length} shown` : `${filtered.length} / ${total}`}</span>
        </div>
        <table className="table" aria-busy={loading || undefined}>
          <thead><tr><th>Identity</th><th>Groups</th><th>Organizations</th><th>2FA</th><th>Last seen</th><th></th></tr></thead>
          <tbody>
            {paged.map(u => (
              <tr key={u.id} className="row-click" onClick={() => setUserDrawer({ mode: "edit", user: u })}>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <Avatar name={u.name} />
                    <div>
                      <div style={{ fontWeight: 500 }}>
                        {u.name} {!u.active && <Chip tone="warn">inactive</Chip>}
                      </div>
                      <div className="small muted mono">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {u.groups.length === 0
                    ? <span className="small muted">— no groups —</span>
                    : <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{u.groups.map(g => <Chip key={g}>{g}</Chip>)}</span>}
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
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                        <span className="small muted mono" title={`${orgs.length} organization${orgs.length === 1 ? "" : "s"}`}>{orgs.length}</span>
                        {preview.map(o => <Chip key={o} title={o}>{o.length > 10 ? `${o.slice(0, 10)}…` : o}</Chip>)}
                        {orgs.length > preview.length && <Chip tone="plain" title={orgs.slice(2).join("\n")}>+{orgs.length - preview.length} more</Chip>}
                      </span>
                    );
                  })()}
                </td>
                <td>
                  {u.mfa === true && <Chip tone="ok" title="Has second factor (TOTP / WebAuthn / backup codes)"><span className="chip-ico">{I.lock}</span>enabled</Chip>}
                  {u.mfa === false && <Chip tone="warn" title="No second factor — required before a group granting in every organisation"><span className="chip-ico">{I.alert}</span>off</Chip>}
                  {u.mfa === undefined && <span className="small muted">—</span>}
                </td>
                <td className="small muted nowrap">{u.last}</td>
                <td style={{ width: 24, textAlign: "right" }}><span style={{ color: "var(--ink-4)" }}>{I.chev}</span></td>
              </tr>
            ))}
            {loading && paged.length === 0 && <SkeletonRows rows={8} cols={6} />}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="small muted" style={{ padding: 16 }}>{searching ? `No users match "${dq}".` : "No users."}</td></tr>
            )}
          </tbody>
        </table>
        {filtered.length > pg.pageSize && (
          <Pagination page={pg.page} pageSize={pg.pageSize} total={filtered.length} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
        )}
        {/* Manual load-more for very large directories: the store streams pages
            in the background, but this lets an operator pull the next page on
            demand (e.g. to widen a client-side name filter) without waiting. */}
        {!searching && browseQ.hasNextPage && (
          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "center" }}>
            <button className="btn ghost sm" disabled={browseQ.isFetchingNextPage} onClick={() => browseQ.fetchNextPage()}>
              {browseQ.isFetchingNextPage ? "Loading…" : `Load more (${browseQ.count} loaded)`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
