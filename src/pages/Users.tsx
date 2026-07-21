import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession, useUsers, useGroupsMap, useUserSearch, useStats, useMyOrganizations, useUserIdentity } from '../api/hooks';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Drawer, PermTree, Switch, ConfirmDialog, EmptyHint } from '../components/ui/Primitives';
import { Pagination, usePagination } from '../components/ui/Pagination';
import { isPrivilegedGroup, ORG_ADMIN_FLAG_GROUP } from '../hooks/useRbac';
import { useApplyChange } from '../hooks/useApplyChange';
import { searchedToUser } from '../api/transforms';
import type { User } from '../api/types';

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
  const { setUserDrawer, setGrant } = useApp();
  const [q, setQ] = useState("");
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <div className="sub">{searching ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${total} identities`}{loading ? ' · loading…' : ''} · Kratos <span className="mono">metadata_admin.groups</span></div>
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
        <table className="table">
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
                  {u.mfa === true && <Chip tone="ok" title="Has second factor (TOTP / WebAuthn / backup codes)">🔐 enabled</Chip>}
                  {u.mfa === false && <Chip tone="warn" title="No second factor — required before admin / super_admin assignment">⚠️ off</Chip>}
                  {u.mfa === undefined && <span className="small muted">—</span>}
                </td>
                <td className="small muted nowrap">{u.last}</td>
                <td style={{ width: 24, textAlign: "right" }}><span style={{ color: "var(--ink-4)" }}>{I.chev}</span></td>
              </tr>
            ))}
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

export function UserDrawer() {
  const { userDrawer, setUserDrawer, state, pushToast, apiSetUserGroups, apiCreateUser, apiDeleteUser, apiSetUserState, apiSendRecoveryEmail } = useApp();
  const applyChange = useApplyChange();
  const { data: session } = useSession();
  // Privilege-escalation guard mirror: only super_admin actors can grant
  // groups that confer admin / super_admin power. Frontend disables the
  // checkboxes; jinbe rejects the mutation as 422 either way.
  const actorIsSuperAdmin = (session?.roles || []).includes('super_admin');

  // edit state
  const editing = userDrawer?.user;
  const user = editing;
  const [groups, setGroups] = useState(user?.groups || []);
  const [drawerTab, setDrawerTab] = useState("groups");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const [sendingRecovery, setSendingRecovery] = useState(false);

  // create state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newGroups, setNewGroups] = useState<string[]>([]);
  const [sendInvite, setSendInvite] = useState(true);

  // Seed the form from the user ONLY when the drawer targets a different user
  // (keyed on id). Deliberately NOT on user?.groups/organizationId: those change
  // on optimistic refetch, and re-seeding would wipe the operator's in-progress
  // edits. eslint-disable is the correct call here, not adding the deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setGroups(user?.groups || []); }, [user?.id]);
  useEffect(() => {
    setDrawerTab("groups");
    setConfirmDelete(false);
    setNewEmail(""); setNewName(""); setNewGroups([]); setSendInvite(true);
  }, [userDrawer?.mode, user?.id]);

  if (!userDrawer) return null;

  const toggleGroup = (g: string) => setGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  const toggleNewGroup = (g: string) => setNewGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  const saveGroups = () => {
    if (!user) return;
    const changed = JSON.stringify(groups.sort()) !== JSON.stringify((user.groups || []).sort());
    if (!changed) { setUserDrawer(null); return; }
    const summary = `${user.email} → [${groups.join(", ") || "no groups"}]`;
    const ok = applyChange("assign", summary, () => apiSetUserGroups(user.email, groups));
    if (ok) setUserDrawer(null);
  };

  const create = () => {
    if (!newEmail || !newName) return;
    const ok = applyChange("create", newEmail, () => apiCreateUser({ email: newEmail, name: newName, groups: newGroups, sendInvite }));
    if (ok) setUserDrawer(null);
  };

  const toggleActive = () => {
    if (!user) return;
    const next: 'active' | 'inactive' = user.active ? 'inactive' : 'active';
    const verb = next === 'inactive' ? 'deactivate' : 'reactivate';
    applyChange(verb, user.email, () => apiSetUserState(user.id, next));
  };

  const doDelete = () => {
    if (!user) return;
    const ok = applyChange("delete", user.email, () => apiDeleteUser(user.id));
    if (ok) setUserDrawer(null);
  };

  const groupRows = (checked: string[], toggle: (g: string) => void, targetMfa?: boolean) =>
    Object.entries(state.groups).map(([g, map], i) => {
      const on = checked.includes(g);
      const privileged = isPrivilegedGroup(g, state);
      // MFA gate (frontend mirror of jinbe's backend refusal): a privileged
      // group cannot be picked for a target user without a second factor.
      const blockedByMfa = privileged && targetMfa === false && !on;
      // Privilege-escalation guard: only super_admin actors can grant a
      // privileged group. Non-super_admins see the box disabled with
      // explanation; backend enforces it via 422 either way.
      const blockedByActor = privileged && !actorIsSuperAdmin && !on;
      const blocked = blockedByMfa || blockedByActor;
      const title = blockedByActor
        ? `Group '${g}' grants admin privileges. Only super_admins may assign it.`
        : blockedByMfa
        ? `Group '${g}' grants admin privileges. Target user must enroll a second factor (TOTP / security key / backup codes) before assignment.`
        : undefined;
      return (
        <label
          key={g}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderBottom: i < Object.keys(state.groups).length - 1 ? "1px solid var(--line)" : "none",
            cursor: blocked ? "not-allowed" : "pointer",
            background: on ? "var(--accent-soft)" : "transparent",
            opacity: blocked ? 0.55 : 1,
          }}
          title={title}
        >
          <input
            type="checkbox"
            checked={on}
            disabled={blocked}
            onChange={() => { if (!blocked) toggle(g); }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
              {g === ORG_ADMIN_FLAG_GROUP ? 'Org admin' : g}
              {g === ORG_ADMIN_FLAG_GROUP && <Chip tone="warn">org-scoped</Chip>}
              {privileged && <Chip tone="warn">🔒 privileged</Chip>}
              {blockedByActor && <Chip tone="err">super_admin only</Chip>}
              {blockedByMfa && !blockedByActor && <Chip tone="err">MFA required</Chip>}
            </div>
            <div className="small muted mono">{g === ORG_ADMIN_FLAG_GROUP
              ? 'manages the members of their own org(s), scoped to each org’s service bundle'
              : Object.entries(map).map(([s, rs]) => `${s}: ${rs.join(",")}`).join(" · ")}</div>
          </div>
        </label>
      );
    });

  if (userDrawer.mode === 'create') {
    return (
      <Drawer
        open={true}
        onClose={() => setUserDrawer(null)}
        eyebrow="POST /admin/users"
        title="Create user"
        footer={
          <>
            <span className="small muted mono">POST /admin/identities · Kratos</span>
            <div className="row">
              <button className="btn" onClick={() => setUserDrawer(null)}>Cancel</button>
              <button className="btn primary" onClick={create} disabled={!newEmail || !newName}>Create user</button>
            </div>
          </>
        }
      >
        <div className="mb-12">
          <label className="input-label">Email *</label>
          <input className="input mono" type="text" inputMode="email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="user@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
        </div>
        <div className="mb-12">
          <label className="input-label">Full name *</label>
          <input className="input" placeholder="Jane Doe" value={newName} onChange={e => setNewName(e.target.value)} />
        </div>
        {Object.keys(state.groups).length > 0 && (
          <div className="mb-12">
            <label className="input-label">Groups <span className="muted">(optional)</span></label>
            <div className="panel" style={{ padding: 0 }}>{groupRows(newGroups, toggleNewGroup, undefined)}</div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 13 }}>Send invite email</div>
            <div className="small muted">Generates a recovery link via Kratos</div>
          </div>
          <Switch on={sendInvite} onChange={setSendInvite} />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      open={!!userDrawer}
      onClose={() => setUserDrawer(null)}
      size="lg"
      eyebrow="Edit user"
      title={`Edit · ${user?.name}`}
      footer={
        <>
          <span className="small muted">Changes apply immediately.</span>
          <div className="row">
            <button className="btn" onClick={() => setUserDrawer(null)}>Cancel</button>
            {drawerTab === "groups" && <button className="btn primary" onClick={saveGroups} disabled={!user}>Apply change</button>}
          </div>
        </>
      }
    >
      {user && (
        <>
          <div className="panel mb-12" style={{ padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
            <Avatar name={user.name} size={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{user.name}</div>
              <div className="small muted mono">{user.email}</div>
            </div>
            {!user.active && <Chip tone="warn">inactive</Chip>}
          </div>
          {editing && (
            <div className="drawer-tabs">
              <button className={drawerTab === "groups" ? "on" : ""} onClick={() => setDrawerTab("groups")}>Access</button>
              <button className={drawerTab === "orgs" ? "on" : ""} onClick={() => setDrawerTab("orgs")}>Organizations</button>
              <button className={drawerTab === "danger" ? "on" : ""} onClick={() => { setDrawerTab("danger"); setConfirmDelete(false); }}>Danger</button>
            </div>
          )}
          {drawerTab === "groups" && (
            <>
              <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12, alignItems: "start" }}>
                <div>
                  <label className="input-label">Groups</label>
                  <div className="panel" style={{ padding: 0 }}>{groupRows(groups, toggleGroup, user?.mfa)}</div>
                </div>
                <div>
                  <label className="input-label">Resulting access</label>
                  <div className="panel" style={{ padding: 12 }}><PermTree user={{ ...user, groups }} state={state} /></div>
                </div>
              </div>
              <div className="panel" style={{ padding: 14, marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 12.5 }}>Recovery email</div>
                  <div className="small muted">Send a password-reset link.</div>
                </div>
                <button
                  className="btn"
                  disabled={sendingRecovery}
                  onClick={async () => {
                    if (!user) return;
                    setSendingRecovery(true);
                    try {
                      await apiSendRecoveryEmail(user.id);
                      pushToast(`Recovery email sent to ${user.email}`);
                    } catch {
                      pushToast("Failed to send recovery email", { err: true });
                    } finally {
                      setSendingRecovery(false);
                    }
                  }}
                >
                  {sendingRecovery ? "Sending…" : "Send recovery email"}
                </button>
              </div>
            </>
          )}
          {drawerTab === "orgs" && <OrgMembershipTab user={user} />}
          {drawerTab === "danger" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="panel" style={{ padding: 14 }}>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>{user.active ? "Deactivate account" : "Reactivate account"}</div>
                <div className="small muted" style={{ marginBottom: 10 }}>
                  {user.active
                    ? "Blocks login. Identity and data are preserved."
                    : "Restores login access for this identity."}
                </div>
                <button className="btn" onClick={user.active ? () => setConfirmDeactivate(true) : toggleActive}>
                  {user.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
              <div className="panel" style={{ padding: 14 }}>
                <div style={{ fontWeight: 500, marginBottom: 4, color: "var(--red, #ef4444)" }}>Delete account</div>
                <div className="small muted" style={{ marginBottom: 10 }}>
                  Permanently removes this identity from Kratos. Cannot be undone.
                </div>
                {!confirmDelete
                  ? (
                    <button
                      className="btn"
                      style={{ borderColor: "var(--red, #ef4444)", color: "var(--red, #ef4444)" }}
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete user
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="small" style={{ flex: 1, color: "var(--red, #ef4444)" }}>Delete {user.email}?</span>
                      <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
                      <button
                        className="btn primary"
                        style={{ background: "var(--red, #ef4444)", borderColor: "var(--red, #ef4444)" }}
                        onClick={doDelete}
                      >
                        Delete
                      </button>
                    </div>
                  )}
              </div>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirmDeactivate}
        title={`Deactivate ${user?.email ?? "user"}?`}
        danger
        confirmLabel="Deactivate"
        body={<>This blocks login for the account. Their identity and data are preserved — you can reactivate them later.</>}
        onCancel={() => setConfirmDeactivate(false)}
        onConfirm={() => { setConfirmDeactivate(false); toggleActive(); }}
      />
    </Drawer>
  );
}

// Multi-organization membership editor (Users drawer · Organizations tab).
//
// A user's EFFECTIVE membership = the native primary `organization_id` UNION the
// additional `metadata_admin.organizations` list — the exact union jinbe folds
// into OPA's `user_organizations`. Both are edited against EXISTING endpoints:
//   • primary    → PATCH /admin/users/:id/organization  (native, UUID-checked)
//   • additional → PATCH /admin/users/:id/metadata       (merge; refuses groups)
// The org catalog for the picker comes from GET /me/organizations (a super_admin
// sees every org).
//
// Editors seed from the AUTHORITATIVE identity (useUserIdentity), never the
// directory row: a search-hit row omits the multi-org list, and a merge-write
// built on that false-empty base would wipe real memberships. Membership grants
// NO permission on its own (permissions come from groups, gated separately) —
// but it is a sensitive tenant-scoping action, so the additional-org write
// mirrors the super_admin gate as defence in depth. The backend independently
// enforces admin on the metadata endpoint and refuses any group change (422).
function OrgMembershipTab({ user }: { user: User }) {
  const { apiSetUserOrganization, apiSetUserOrganizations } = useApp();
  const applyChange = useApplyChange();
  const { data: session } = useSession();
  const actorIsSuperAdmin = (session?.roles || []).includes('super_admin');

  const identityQ = useUserIdentity(user.id);
  const identity = identityQ.data;
  const catalogQ = useMyOrganizations();
  const catalog = useMemo(() => catalogQ.data ?? [], [catalogQ.data]);
  const baselineAdditional = useMemo(
    () => (Array.isArray(identity?.metadata_admin?.organizations)
      ? (identity!.metadata_admin!.organizations as string[])
      : []),
    [identity],
  );

  const [primary, setPrimary] = useState("");
  const [additional, setAdditional] = useState<string[]>([]);
  const [addId, setAddId] = useState("");
  const [seeded, setSeeded] = useState(false);

  // Seed once, from the source of truth, when it lands. The `seeded` guard keeps
  // a post-save refetch (or a realtime invalidation) from wiping in-progress edits.
  useEffect(() => {
    if (!identity || seeded) return;
    setPrimary(identity.organization_id ?? "");
    setAdditional(baselineAdditional);
    setSeeded(true);
  }, [identity, baselineAdditional, seeded]);

  if (identityQ.isLoading || !seeded) {
    return (
      <div className="panel" style={{ padding: 24, textAlign: "center" }}>
        <span className="small muted">Loading organization membership…</span>
      </div>
    );
  }
  if (identityQ.isError) {
    return (
      <div className="panel" style={{ padding: 20 }}>
        <EmptyHint>Couldn&apos;t load this user&apos;s organizations — {(identityQ.error as Error).message}</EmptyHint>
      </div>
    );
  }

  const baselinePrimary = identity?.organization_id ?? "";
  const toggle = (o: string) =>
    setAdditional(prev => (prev.includes(o) ? prev.filter(x => x !== o) : [...prev, o]));
  const addById = () => {
    const v = addId.trim();
    if (!v) return;
    setAdditional(prev => (prev.includes(v) ? prev : [...prev, v]));
    setAddId("");
  };

  // Candidate rows = catalog ∪ drafted additional, minus the primary (managed in
  // its own section, always part of the effective set).
  const candidates = Array.from(new Set([...catalog, ...additional]))
    .filter(o => o && o !== primary.trim())
    .sort();
  const effective = Array.from(new Set([...(primary.trim() ? [primary.trim()] : []), ...additional]));

  const primaryChanged = primary.trim() !== baselinePrimary;
  const additionalChanged =
    JSON.stringify([...additional].sort()) !== JSON.stringify([...baselineAdditional].sort());

  const savePrimary = () =>
    applyChange("organization", user.email, () => apiSetUserOrganization(user.id, primary.trim() || undefined));
  const saveAdditional = () => {
    if (!actorIsSuperAdmin) return;
    applyChange("organizations", user.email, () => apiSetUserOrganizations(user.id, additional));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="small muted">
        Effective membership is the primary organization UNION the additional
        organizations — the same union jinbe resolves into OPA&apos;s{" "}
        <span className="mono">user_organizations</span>. Membership scopes a user
        to a tenant; it grants no permissions on its own (those come from groups).
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <div className="input-label">Effective organizations</div>
        {effective.length === 0
          ? <span className="small muted">— none —</span>
          : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {effective.map(o => (
                <Chip key={o} tone={o === primary.trim() ? "accent" : ""} title={o === primary.trim() ? `${o} · primary` : o}>{o}</Chip>
              ))}
            </div>
          )}
      </div>

      <div>
        <label className="input-label">Primary organization</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input mono"
            style={{ flex: 1 }}
            placeholder="e.g. acme-corp (empty for none)"
            value={primary}
            onChange={e => setPrimary(e.target.value)}
          />
          <button className="btn" onClick={savePrimary} disabled={!primaryChanged}>Save primary</button>
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          Native <span className="mono">organization_id</span> — the org the scoped delegated endpoints key on.
        </div>
      </div>

      <div>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <label className="input-label" style={{ margin: 0 }}>Additional organizations</label>
          <span className="small muted mono">metadata_admin.organizations</span>
        </div>
        {candidates.length === 0
          ? (
            <div className="panel" style={{ padding: 14, marginTop: 6 }}>
              <span className="small muted">No other organizations known. Add one by ID below.</span>
            </div>
          )
          : (
            <div className="panel" style={{ padding: 0, marginTop: 6 }}>
              {candidates.map((o, i) => {
                const on = additional.includes(o);
                return (
                  <label
                    key={o}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                      borderBottom: i < candidates.length - 1 ? "1px solid var(--line)" : "none",
                      cursor: actorIsSuperAdmin ? "pointer" : "not-allowed",
                      background: on ? "var(--accent-soft)" : "transparent",
                      opacity: actorIsSuperAdmin ? 1 : 0.6,
                    }}
                    title={o}
                  >
                    <input type="checkbox" checked={on} disabled={!actorIsSuperAdmin} onChange={() => toggle(o)} />
                    <span className="mono small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{o}</span>
                    {on && <Chip tone="ok">member</Chip>}
                  </label>
                );
              })}
            </div>
          )}

        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <input
            className="input mono"
            style={{ flex: 1 }}
            placeholder="Add organization by ID…"
            value={addId}
            disabled={!actorIsSuperAdmin}
            onChange={e => setAddId(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addById(); } }}
          />
          <button className="btn" onClick={addById} disabled={!actorIsSuperAdmin || !addId.trim()}>Add</button>
        </div>

        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <span className="small muted">
            {actorIsSuperAdmin
              ? "Replaces the additional-org list; the primary org is unaffected."
              : "Multi-org assignment requires super_admin."}
          </span>
          <button
            className="btn primary"
            onClick={saveAdditional}
            disabled={!actorIsSuperAdmin || !additionalChanged}
            title={!actorIsSuperAdmin ? "Requires super_admin" : undefined}
          >
            Apply additional orgs
          </button>
        </div>
      </div>
    </div>
  );
}
