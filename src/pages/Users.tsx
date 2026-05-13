import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession } from '../api/hooks';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Drawer, PermTree, Switch } from '../components/ui/Primitives';
import { Pagination, usePagination } from '../components/ui/Pagination';
import { useApplyChange } from '../hooks/useApplyChange';

export function UsersPage() {
  const { state, setUserDrawer } = useApp();
  const [q, setQ] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");

  const filtered = state.users.filter(u => {
    if (q && !`${u.name} ${u.email} ${u.title}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (groupFilter !== "all" && !u.groups.includes(groupFilter)) return false;
    return true;
  });

  const pg = usePagination(filtered.length, 25);
  const paged = filtered.slice(pg.from, pg.to);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <div className="sub">{state.users.length} identities · Kratos <span className="mono">metadata_admin.groups</span></div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setUserDrawer({ mode: "assign" })}>
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.plus}</span>
            Assign to group
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
            <input className="input" style={{ paddingLeft: 30 }} placeholder="Search name, email, title…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <select className="input" style={{ width: "auto" }} value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
            <option value="all">All groups</option>
            {Object.keys(state.groups).map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <div className="flex-1" />
          <span className="small muted mono">{filtered.length} / {state.users.length}</span>
        </div>
        <table className="table">
          <thead><tr><th>Identity</th><th>Groups</th><th>Organizations</th><th>2FA</th><th>Last seen</th><th></th></tr></thead>
          <tbody>
            {paged.map(u => {
              // `organizations` is normalised to [] by the mapper but the
              // seed fixture omits it; default defensively here.
              const orgs = u.organizations ?? [];
              const orgPreview = orgs.slice(0, 2);
              const orgOverflow = orgs.length - orgPreview.length;
              return (
                <tr key={u.id} className="row-click" onClick={() => setUserDrawer({ mode: "edit", user: u })}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <Avatar name={u.name} src={u.picture ?? undefined} />
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
                    {orgs.length === 0
                      ? <span className="small muted">— none —</span>
                      : (
                        <span style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                          <span className="small muted mono" title={`${orgs.length} organization${orgs.length === 1 ? "" : "s"}`}>{orgs.length}</span>
                          {orgPreview.map(o => (
                            <Chip key={o} title={o}>{o.length > 8 ? `${o.slice(0, 8)}…` : o}</Chip>
                          ))}
                          {orgOverflow > 0 && (
                            <Chip tone="plain" title={orgs.slice(2).join("\n")}>+{orgOverflow} more</Chip>
                          )}
                        </span>
                      )}
                  </td>
                  <td>
                    {u.mfa === true && <Chip tone="ok" title="Has second factor (TOTP / WebAuthn / backup codes)">🔐 enabled</Chip>}
                    {u.mfa === false && <Chip tone="warn" title="No second factor — required before admin / super_admin assignment">⚠️ off</Chip>}
                    {u.mfa === undefined && <span className="small muted">—</span>}
                  </td>
                  <td className="small muted nowrap">{u.last}</td>
                  <td style={{ width: 24, textAlign: "right" }}><span style={{ color: "var(--ink-4)" }}>{I.chev}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > pg.pageSize && (
          <Pagination page={pg.page} pageSize={pg.pageSize} total={filtered.length} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
        )}
      </div>
    </>
  );
}

export function UserDrawer() {
  const { userDrawer, setUserDrawer, state, setState, isLive, pushToast, apiSetUserGroups, apiCreateUser, apiDeleteUser, apiSetUserState, apiSetUserOrganization, apiSetUserOrganizations, apiSendRecoveryEmail } = useApp();
  const applyChange = useApplyChange();
  const { data: session } = useSession();
  // Privilege-escalation guard mirror: only super_admin actors can grant
  // groups that confer admin / super_admin power. Frontend disables the
  // checkboxes; jinbe rejects the mutation as 422 either way.
  const actorIsSuperAdmin = (session?.roles || []).includes('super_admin');

  // edit/assign state
  const editing = userDrawer?.user;
  const [selectedUserId, setSelectedUserId] = useState(editing?.id || "");
  const user = editing || state.users.find(u => u.id === selectedUserId);
  const [groups, setGroups] = useState(user?.groups || []);
  const [drawerTab, setDrawerTab] = useState("groups");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // metadata state
  const [organizationId, setOrganizationId] = useState(editing?.organizationId || "");

  // multi-org state (authoritative, mirrors backend `metadata_admin.organizations`)
  const [organizations, setOrganizationsState] = useState<string[]>(editing?.organizations ?? []);
  const [orgNewUuid, setOrgNewUuid] = useState("");

  const [sendingRecovery, setSendingRecovery] = useState(false);

  // create state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newGroups, setNewGroups] = useState<string[]>([]);
  const [sendInvite, setSendInvite] = useState(true);

  useEffect(() => { setGroups(user?.groups || []); }, [user?.id]);
  useEffect(() => { setOrganizationId(user?.organizationId || ""); }, [user?.id]);
  useEffect(() => { setOrganizationsState(user?.organizations ?? []); setOrgNewUuid(""); }, [user?.id]);
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
    const mutator = isLive
      ? () => apiSetUserGroups(user.email, groups)
      : () => { setState(s => ({ ...s, users: s.users.map(x => x.id === user.id ? { ...x, groups } : x) })); };
    const ok = applyChange("assign", summary, mutator);
    if (ok) setUserDrawer(null);
  };

  const create = () => {
    if (!newEmail || !newName) return;
    const mutator = isLive
      ? () => apiCreateUser({ email: newEmail, name: newName, groups: newGroups, sendInvite })
      : () => { setState(s => ({ ...s, users: [...s.users, { id: `local-${Date.now()}`, name: newName, email: newEmail, groups: newGroups, title: "", active: true, last: "just now" }] })); };
    const ok = applyChange("create", newEmail, mutator);
    if (ok) setUserDrawer(null);
  };

  const toggleActive = () => {
    if (!user) return;
    const next: 'active' | 'inactive' = user.active ? 'inactive' : 'active';
    const verb = next === 'inactive' ? 'deactivate' : 'reactivate';
    const mutator = isLive
      ? () => apiSetUserState(user.id, next)
      : () => { setState(s => ({ ...s, users: s.users.map(x => x.id === user.id ? { ...x, active: next === 'active' } : x) })); };
    applyChange(verb, user.email, mutator);
  };

  const saveMetadata = () => {
    if (!user) return;
    const mutator = isLive
      ? () => apiSetUserOrganization(user.id, organizationId || undefined)
      : () => { setState(s => ({ ...s, users: s.users.map(x => x.id === user.id ? { ...x, organizationId: organizationId || undefined } : x) })); };
    const ok = applyChange("metadata", user.email, mutator);
    if (ok) setUserDrawer(null);
  };

  // Pre-multi-org backends return 404 on the new endpoint. The toast
  // path below surfaces the server message verbatim so the operator
  // can tell "user not found" from "endpoint not available" from
  // "invalid UUID" without losing their drafted org list.
  const toggleOrganization = (orgId: string) => {
    setOrganizationsState(prev =>
      prev.includes(orgId) ? prev.filter(x => x !== orgId) : [...prev, orgId],
    );
  };

  const addOrganization = () => {
    const trimmed = orgNewUuid.trim();
    if (!trimmed) return;
    setOrganizationsState(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setOrgNewUuid("");
  };

  const saveOrganizations = async () => {
    if (!user) return;
    const current = user.organizations ?? [];
    const changed = JSON.stringify([...organizations].sort()) !== JSON.stringify([...current].sort());
    if (!changed) {
      setUserDrawer(null);
      return;
    }
    const summary = `${user.email} → orgs [${organizations.join(", ") || "none"}]`;
    if (!isLive) {
      const mutator = () => {
        setState(s => ({
          ...s,
          users: s.users.map(x => (x.id === user.id ? { ...x, organizations: [...organizations] } : x)),
        }));
      };
      const ok = applyChange("organizations", summary, mutator);
      if (ok) setUserDrawer(null);
      return;
    }
    // Live: call jinbe directly so we can keep the drafted list on
    // failure instead of bouncing through applyChange's optimistic path.
    try {
      await apiSetUserOrganizations(user.email, organizations);
      pushToast(`Organizations updated for ${user.email}`);
      setUserDrawer(null);
    } catch (err) {
      const e = err as Error & { status?: number };
      const sub =
        e.status === 404
          ? "Endpoint not available — backend may predate multi-org support"
          : e.status === 400
            ? "Invalid UUID in the list"
            : e.message;
      pushToast("Failed to update organizations", { err: true, sub });
    }
  };

  const doDelete = () => {
    if (!user) return;
    const mutator = isLive
      ? () => apiDeleteUser(user.id)
      : () => { setState(s => ({ ...s, users: s.users.filter(x => x.id !== user.id) })); };
    const ok = applyChange("delete", user.email, mutator);
    if (ok) setUserDrawer(null);
  };

  // A group is "privileged" when its mapping yields the global super_admin
  // role OR a service-scoped admin role. Membership grants admin power, so
  // jinbe will refuse to add an MFA-less identity to it.
  const isPrivilegedGroup = (g: string): boolean => {
    const meta = state.groupsMeta?.[g];
    if (!meta?.system) return false;
    const map = state.groups[g] || {};
    if ((map.global ?? []).includes('super_admin')) return true;
    for (const [svc, roles] of Object.entries(map)) {
      if (svc === 'global' || !roles?.length) continue;
      const allRoles = state.roles[svc] || {};
      for (const r of roles) {
        if ((allRoles[r] ?? []).includes('*')) return true;
      }
    }
    return false;
  };

  const groupRows = (checked: string[], toggle: (g: string) => void, targetMfa?: boolean) =>
    Object.entries(state.groups).map(([g, map], i) => {
      const on = checked.includes(g);
      const privileged = isPrivilegedGroup(g);
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
              {g}
              {privileged && <Chip tone="warn">🔒 privileged</Chip>}
              {blockedByActor && <Chip tone="err">super_admin only</Chip>}
              {blockedByMfa && !blockedByActor && <Chip tone="err">MFA required</Chip>}
            </div>
            <div className="small muted mono">{Object.entries(map).map(([s, rs]) => `${s}: ${rs.join(",")}`).join(" · ")}</div>
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
          <input className="input mono" type="email" placeholder="user@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
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
      eyebrow="PATCH /admin/identities/{id}"
      title={editing ? `Edit · ${user?.name}` : "Assign user to group"}
      footer={
        <>
          <span className="small muted mono">
            {drawerTab === "orgs" ? "metadata_admin.organizations" : "metadata_admin.groups"}
          </span>
          <div className="row">
            <button className="btn" onClick={() => setUserDrawer(null)}>Cancel</button>
            {drawerTab === "groups" && <button className="btn primary" onClick={saveGroups} disabled={!user}>Apply change</button>}
            {drawerTab === "orgs" && (
              <button
                className="btn primary"
                onClick={saveOrganizations}
                disabled={!user || !actorIsSuperAdmin}
                title={!actorIsSuperAdmin ? "Multi-org assignment requires super_admin" : undefined}
              >
                Apply change
              </button>
            )}
          </div>
        </>
      }
    >
      {!editing && (
        <div className="mb-12">
          <label className="input-label">Identity</label>
          <select className="input mono" value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
            <option value="">Select a user…</option>
            {state.users.map(u => <option key={u.id} value={u.id}>{u.email} — {u.name}</option>)}
          </select>
        </div>
      )}
      {user && (
        <>
          <div className="panel mb-12" style={{ padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
            <Avatar name={user.name} src={user.picture ?? undefined} size={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{user.name}</div>
              <div className="small muted mono">{user.email}</div>
            </div>
            {!user.active && <Chip tone="warn">inactive</Chip>}
          </div>
          {editing && (
            <div className="drawer-tabs">
              <button className={drawerTab === "groups" ? "on" : ""} onClick={() => setDrawerTab("groups")}>Groups</button>
              <button className={drawerTab === "orgs" ? "on" : ""} onClick={() => setDrawerTab("orgs")}>Organizations</button>
              <button className={drawerTab === "tree" ? "on" : ""} onClick={() => setDrawerTab("tree")}>Access</button>
              <button className={drawerTab === "metadata" ? "on" : ""} onClick={() => setDrawerTab("metadata")}>Metadata</button>
              <button className={drawerTab === "danger" ? "on" : ""} onClick={() => { setDrawerTab("danger"); setConfirmDelete(false); }}>Danger</button>
            </div>
          )}
          {drawerTab === "groups" && (
            <>
              <div className="panel" style={{ padding: 0 }}>{groupRows(groups, toggleGroup, user?.mfa)}</div>
              <div className="panel" style={{ padding: 14, marginTop: 8, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 12.5 }}>Recovery email</div>
                  <div className="small muted">Send password-reset link via Kratos</div>
                </div>
                <button
                  className="btn"
                  disabled={!isLive || sendingRecovery}
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
          {drawerTab === "orgs" && (() => {
            // Available orgs = union of all known org UUIDs across users.
            // Until jinbe ships `GET /admin/organizations`, this is the
            // best source of suggestion; admins can still paste a fresh
            // UUID below to assign one that no one else has yet.
            const knownOrgs = Array.from(
              new Set(state.users.flatMap(x => x.organizations ?? [])),
            ).sort();
            // Selection set = drafted state + anything already on the user
            // but not yet in the union (defensive).
            const candidates = Array.from(new Set([...knownOrgs, ...organizations])).sort();
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="small muted">
                  Multi-tenant membership. Authoritative list of organization UUIDs the user
                  belongs to (stored in <span className="mono">metadata_admin.organizations</span>).
                </div>
                {candidates.length === 0
                  ? (
                    <div className="panel" style={{ padding: 14 }}>
                      <span className="small muted">No organizations known yet. Paste a UUID below to assign one.</span>
                    </div>
                  )
                  : (
                    <div className="panel" style={{ padding: 0 }}>
                      {candidates.map((orgId, i) => {
                        const on = organizations.includes(orgId);
                        return (
                          <label
                            key={orgId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "10px 14px",
                              borderBottom: i < candidates.length - 1 ? "1px solid var(--line)" : "none",
                              cursor: "pointer",
                              background: on ? "var(--accent-soft)" : "transparent",
                            }}
                            title={orgId}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggleOrganization(orgId)}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="mono small" style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{orgId}</div>
                            </div>
                            {on && <Chip tone="ok">member</Chip>}
                          </label>
                        );
                      })}
                    </div>
                  )}
                <div className="panel" style={{ padding: 12 }}>
                  <div className="input-label">Add by UUID</div>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="input mono"
                      style={{ flex: 1 }}
                      placeholder="e.g. 8f3a1c2e-…"
                      value={orgNewUuid}
                      onChange={e => setOrgNewUuid(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addOrganization(); } }}
                    />
                    <button className="btn" onClick={addOrganization} disabled={!orgNewUuid.trim()}>
                      Add
                    </button>
                  </div>
                  <div className="small muted" style={{ marginTop: 6 }}>
                    Backend validates the UUID format; invalid entries are rejected with a 400.
                    {/*
                     * TODO follow-up: when jinbe exposes
                     * `GET /admin/organizations` (org catalog with display
                     * names), replace this free-text input with a typeahead
                     * picker keyed on display name.
                     */}
                  </div>
                </div>
              </div>
            );
          })()}
          {drawerTab === "tree" && <PermTree user={{ ...user, groups }} state={state} />}
          {drawerTab === "metadata" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label className="input-label">Organization ID</label>
                <input
                  className="input mono"
                  placeholder="e.g. acme-corp"
                  value={organizationId}
                  onChange={e => setOrganizationId(e.target.value)}
                />
                <div className="small muted" style={{ marginTop: 4 }}>Stored as <span className="mono">organization_id</span> in Kratos (native field)</div>
              </div>
              <div>
                <button className="btn primary" onClick={saveMetadata}>Save metadata</button>
              </div>
            </div>
          )}
          {drawerTab === "danger" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="panel" style={{ padding: 14 }}>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>{user.active ? "Deactivate account" : "Reactivate account"}</div>
                <div className="small muted" style={{ marginBottom: 10 }}>
                  {user.active
                    ? "Blocks login. Identity and data are preserved."
                    : "Restores login access for this identity."}
                </div>
                <button className="btn" onClick={toggleActive}>
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
    </Drawer>
  );
}
