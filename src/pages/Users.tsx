import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Drawer, PermTree } from '../components/ui/Primitives';
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
          <button className="btn primary" onClick={() => setUserDrawer({ mode: "assign" })}>
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.plus}</span>
            Assign to group
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
          <thead><tr><th>Identity</th><th>Groups</th><th>Last seen</th><th></th></tr></thead>
          <tbody>
            {paged.map(u => (
              <tr key={u.id} className="row-click" onClick={() => setUserDrawer({ mode: "edit", user: u })}>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <Avatar name={u.name} />
                    <div>
                      <div style={{ fontWeight: 500 }}>{u.name} {!u.active && <Chip tone="warn">pending</Chip>}</div>
                      <div className="small muted mono">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {u.groups.length === 0
                    ? <span className="small muted">— no groups —</span>
                    : <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{u.groups.map(g => <Chip key={g}>{g}</Chip>)}</span>}
                </td>
                <td className="small muted nowrap">{u.last}</td>
                <td style={{ width: 24, textAlign: "right" }}><span style={{ color: "var(--ink-4)" }}>{I.chev}</span></td>
              </tr>
            ))}
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
  const { userDrawer, setUserDrawer, state, setState, isLive, apiSetUserGroups } = useApp();
  const applyChange = useApplyChange();
  const editing = userDrawer?.user;
  const [selectedUserId, setSelectedUserId] = useState(editing?.id || "");
  const user = editing || state.users.find(u => u.id === selectedUserId);
  const [groups, setGroups] = useState(user?.groups || []);
  const [drawerTab, setDrawerTab] = useState("groups");

  useEffect(() => { setGroups(user?.groups || []); }, [user?.id]);
  useEffect(() => { setDrawerTab("groups"); }, [userDrawer?.mode, user?.id]);

  if (!userDrawer) return null;

  const toggleGroup = (g: string) => setGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  const save = () => {
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

  return (
    <Drawer
      open={!!userDrawer}
      onClose={() => setUserDrawer(null)}
      eyebrow="PATCH /admin/identities/{id}"
      title={editing ? `Edit groups · ${user?.name}` : "Assign user to group"}
      footer={
        <>
          <span className="small muted mono">metadata_admin.groups</span>
          <div className="row">
            <button className="btn" onClick={() => setUserDrawer(null)}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={!user}>Apply change</button>
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
            <Avatar name={user.name} size={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{user.name}</div>
              <div className="small muted mono">{user.email}</div>
            </div>
          </div>
          <div className="drawer-tabs">
            <button className={drawerTab === "groups" ? "on" : ""} onClick={() => setDrawerTab("groups")}>Edit groups</button>
            <button className={drawerTab === "tree" ? "on" : ""} onClick={() => setDrawerTab("tree")}>Effective access</button>
          </div>
          {drawerTab === "groups" && (
            <div className="panel" style={{ padding: 0 }}>
              {Object.entries(state.groups).map(([g, map], i) => {
                const on = groups.includes(g);
                return (
                  <label key={g} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i < Object.keys(state.groups).length - 1 ? "1px solid var(--line)" : "none", cursor: "pointer", background: on ? "var(--accent-soft)" : "transparent" }}>
                    <input type="checkbox" checked={on} onChange={() => toggleGroup(g)} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 12.5 }}>{g}</div>
                      <div className="small muted mono">{Object.entries(map).map(([s, rs]) => `${s}: ${rs.join(",")}`).join(" · ")}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          {drawerTab === "tree" && <PermTree user={{ ...user, groups }} state={state} />}
        </>
      )}
    </Drawer>
  );
}
