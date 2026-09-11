import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession, useUsers, useGroupsMap, useUserSearch, useStats, useMyOrganizations, useUserIdentity, useAuditEvents, useAuthorizationModel } from '../api/hooks';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Drawer, PermTree, Switch, ConfirmDialog, EmptyHint } from '../components/ui/Primitives';
import { Pagination, usePagination } from '../components/ui/Pagination';
import { isPrivilegedGroup } from '../hooks/useRbac';
import { useApplyChange } from '../hooks/useApplyChange';
import { membershipsOf, searchedToUser } from '../api/transforms';
import { RiskBadge, riskOf } from './Audit';
import type { User, AuditEvent } from '../api/types';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { PRIVILEGED_MUTATION, permits } from '../policy/model';

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
                  {u.mfa === false && <Chip tone="warn" title="No second factor — required before a group granting in every organisation"><span className="chip-ico">{I.alert}</span>off</Chip>}
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
  /**
   * What this actor may hand out, asked of the model the engine decides against.
   *
   * What this replaced offered `state.groups` — the previous model's catalogue, read from a cache —
   * and greyed the privileged ones when the session did NOT carry a role literally called
   * `super_admin`. Neither survives: the policy defines no such role (global power is a group
   * granting in every organisation, read off the shape), so every privileged row was greyed for
   * everybody; and the names on offer were not the ones the policy knows, so assigning one wrote a
   * membership that granted nothing while looking like it had worked.
   */
  // "Privileged" means what it means to the engine: granting in every organisation. Read from the
  // same model, so the warning on a row and the refusal behind it cannot disagree.
  const modelGroups = useAuthorizationModel().data?.groups ?? {};
  const assignable = useQuery({
    queryKey: ['assignable-groups'],
    queryFn: () => api.assignableGroups(),
    staleTime: 30_000,
  });
  const offered = assignable.data?.groups ?? [];
  const mayAssign = assignable.data?.mayAssign ?? false;

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

  const groupRows = (checked: string[], toggle: (g: string) => void, targetMfa?: boolean) => {
    // Everything the model declares, plus anything the target already holds — a membership the
    // catalogue no longer offers must stay visible and removable, or it becomes invisible and
    // permanent.
    const rows = [...new Set([...offered, ...checked])].sort();
    return rows.map((g, i) => {
      const on = checked.includes(g);
      const known = offered.includes(g);
      const privileged = isPrivilegedGroup(g, modelGroups);
      // MFA gate (frontend mirror of jinbe's backend refusal): a privileged group cannot be picked
      // for a target user without a second factor.
      const blockedByMfa = privileged && targetMfa === false && !on;
      // Whether this actor may hand out anything at all is the model's answer, not a role name.
      const blockedByActor = !mayAssign && !on;
      const blocked = blockedByMfa || blockedByActor;
      const title = blockedByActor
        ? 'Assigning a group needs a group that grants in every organisation.'
        : blockedByMfa
        ? `Group '${g}' grants admin privileges. Target user must enroll a second factor (TOTP / security key / backup codes) before assignment.`
        : !known
        ? `Group '${g}' is held but is not declared in the enforced model, so it grants nothing. It can be removed.`
        : undefined;
      const map = state.groups[g] ?? {};
      return (
        <label
          key={g}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderBottom: i < rows.length - 1 ? "1px solid var(--line)" : "none",
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
            <div style={{ fontWeight: 500, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {g}
              {privileged && <Chip tone="warn" title="Grants in every organisation"><span className="chip-ico">{I.lock}</span>privileged</Chip>}
              {!known && <Chip tone="err">not in the model</Chip>}
              {blockedByMfa && !blockedByActor && <Chip tone="err">MFA required</Chip>}
            </div>
            {/* What the PREVIOUS model mapped this group to, when it mapped anything. Silent
                otherwise: an empty mapping says nothing about the enforced model, and printing
                "declared in the enforced model" here contradicted the badge above on the one row
                that is not — and said it of every other row without knowing. */}
            {Object.keys(map).length > 0 && (
              <div className="small muted mono" style={{ overflowWrap: 'anywhere' }}>
                {Object.entries(map).map(([s, rs]) => `${s}: ${rs.join(",")}`).join(" · ")}
              </div>
            )}
          </div>
        </label>
      );
    });
  };

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
              <button className={drawerTab === "activity" ? "on" : ""} onClick={() => setDrawerTab("activity")}>Activity</button>
              <button className={drawerTab === "danger" ? "on" : ""} onClick={() => { setDrawerTab("danger"); setConfirmDelete(false); }}>Danger</button>
            </div>
          )}
          {drawerTab === "groups" && (
            <>
              <div className="drawer-split">
                <div>
                  <label className="input-label">Groups</label>
                  {/* A screen offering nothing must say why — and must not make "you may not" and
                      "I could not tell" look alike: one is an answer, the other is a failure. */}
                  {assignable.isError ? (
                    <div className="small" style={{ color: 'var(--err)', marginBottom: 8 }}>
                      The authorization model could not be read, so what you may assign is unknown.
                    </div>
                  ) : !assignable.isLoading && !mayAssign ? (
                    <div className="small muted" style={{ marginBottom: 8 }}>
                      You cannot assign groups: it needs <span className="mono">admin.membership:write</span>.
                      Below is what this person already holds.
                    </div>
                  ) : null}
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
          {drawerTab === "activity" && <UserTrail user={user} />}
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
// additional list. jinbe OWNS that set now and answers it as `organizations`;
// `metadata_admin.organizations` is the write path and the fallback, no longer
// the truth. Both halves are edited against EXISTING endpoints:
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
  // Editing somebody's organisations is gated on the permission the mutation checks. A role NAME
  // this model does not define greyed the whole tab for the very people who may change it.
  const mayEditMemberships = permits(session?.permissions, PRIVILEGED_MUTATION);

  const identityQ = useUserIdentity(user.id);
  const identity = identityQ.data;
  const catalogQ = useMyOrganizations();
  const catalog = useMemo(() => catalogQ.data ?? [], [catalogQ.data]);
  // The starting point of an EDIT, which is why the source matters more here than anywhere else:
  // this screen saves what it is showing. jinbe answers `organizations` from the records it owns —
  // the effective set, primary included — so the additional list is that set minus the primary.
  // Only when the field is absent (a backend that does not own membership) does what was written on
  // the identity stand in. Seeding from the identity while the truth lived elsewhere would have
  // shown an empty list to somebody who belongs to three, and saving it would have made that true.
  const baselineAdditional = useMemo(() => {
    if (!identity) return [];
    const primaryId = identity.organization_id ?? "";
    return membershipsOf(identity).filter(o => o && o !== primaryId);
  }, [identity]);

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
    if (!mayEditMemberships) return;
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
          <span className="small muted" title="Read from the membership records jinbe owns; written through metadata_admin.organizations">held by jinbe</span>
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
                      cursor: mayEditMemberships ? "pointer" : "not-allowed",
                      background: on ? "var(--accent-soft)" : "transparent",
                      opacity: mayEditMemberships ? 1 : 0.6,
                    }}
                    title={o}
                  >
                    <input type="checkbox" checked={on} disabled={!mayEditMemberships} onChange={() => toggle(o)} />
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
            disabled={!mayEditMemberships}
            onChange={e => setAddId(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addById(); } }}
          />
          <button className="btn" onClick={addById} disabled={!mayEditMemberships || !addId.trim()}>Add</button>
        </div>

        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <span className="small muted">
            {mayEditMemberships
              ? "Replaces the additional-org list; the primary org is unaffected."
              : "Multi-org assignment requires super_admin."}
          </span>
          <button
            className="btn primary"
            onClick={saveAdditional}
            disabled={!mayEditMemberships || !additionalChanged}
            title={!mayEditMemberships ? "Needs admin.membership:write" : undefined}
          >
            Apply additional orgs
          </button>
        </div>
      </div>
    </div>
  );
}

// One row of a per-user trail. Renders the plain event + group-diff chips from
// the `changes` envelope (added/removed groups) + a risk badge.
function TrailRow({ e }: { e: AuditEvent }) {
  const isFail = e.status === "failed" || e.verb === "fail" || e.verb === "deny";
  const risk = riskOf(e);
  const added = e.changes?.added ?? [];
  const removed = e.changes?.removed ?? [];
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderBottom: "1px solid var(--line)", borderLeft: risk.level !== "none" ? `2px solid var(--${risk.tone})` : "2px solid transparent" }}>
      <span className="small muted mono nowrap" style={{ width: 60, flexShrink: 0 }}>{e.when}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Chip tone={isFail ? "err" : ""}>{e.verb}</Chip>
          <span className="small mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{e.changes?.summary || e.target || e.path || e.category}</span>
          <RiskBadge e={e} />
          {isFail && <Chip tone="err">{e.verb === "deny" ? "denied" : "failed"}</Chip>}
        </div>
        {(added.length > 0 || removed.length > 0) && (
          <div className="row mt-4" style={{ gap: 4, flexWrap: "wrap" }}>
            {added.map(a => <Chip key={`a-${a}`} tone="ok">+ {a}</Chip>)}
            {removed.map(r => <Chip key={`r-${r}`} tone="err">− {r}</Chip>)}
          </div>
        )}
        {(e.service || e.who) && <div className="small muted mono mt-4">{[e.service, e.who].filter(Boolean).join(" · ")}</div>}
      </div>
    </div>
  );
}

// Per-user trail (Part D): "Did" (actor == email) + "Done to them"
// (target == user:<email>, matched via the emit-time targetEmail). Fail-closed:
// react-query's isError distinguishes a load failure from an empty trail.
function UserTrail({ user }: { user: User }) {
  const didQ = useAuditEvents({ actor: user.email, limit: 50 });
  const doneQ = useAuditEvents({ target: `user:${user.email}`, limit: 50 });
  const did = didQ.data ?? [];
  const done = doneQ.data ?? [];

  const section = (title: string, sub: string, q: ReturnType<typeof useAuditEvents>, rows: AuditEvent[]) => (
    <div className="panel">
      <div className="panel-head"><div><h3>{title}</h3><div className="sub">{sub}</div></div><Chip>{rows.length}</Chip></div>
      <div style={{ padding: 0 }}>
        {q.isError ? (
          <div style={{ padding: 16 }}><span className="small" style={{ color: "var(--danger, #c0392b)" }}>Couldn&apos;t load this trail — load error, not "no activity". Reload to retry.</span></div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 14 }}><EmptyHint>{q.isLoading ? "Loading…" : "Nothing recorded in the retained window."}</EmptyHint></div>
        ) : rows.map(e => <TrailRow key={e.id} e={e} />)}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {section("What they did", `Actions by ${user.email}`, didQ, did)}
      {section("What was done to them", "Access & privilege changes targeting this user", doneQ, done)}
      <div className="small muted" style={{ textAlign: "center", opacity: 0.7 }}>
        Bounded by the audit stream cap (Redis-only store) — older activity may have aged out.
      </div>
    </div>
  );
}
