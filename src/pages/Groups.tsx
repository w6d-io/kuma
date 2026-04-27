import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Chip, Drawer, AccessLevel } from '../components/ui/Primitives';
import { accessLevelOf } from '../hooks/useRbac';
import { useApplyChange } from '../hooks/useApplyChange';

export function GroupsPage() {
  const { state, setGroupDrawer } = useApp();
  const services = state.services.map(s => s.name);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Groups</h1>
          <div className="sub"><span className="mono">groups.json</span> · group → roles per service</div>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setGroupDrawer({ mode: "create" })}>
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.plus}</span> New group
          </button>
        </div>
      </div>
      <div className="panel" style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 180 }}>Group</th>
              <th style={{ width: 70 }}>Users</th>
              {services.map(s => <th key={s}>{s}</th>)}
              <th style={{ width: 1 }}></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(state.groups).map(([g, map]) => {
              const users = state.users.filter(u => u.groups.includes(g)).length;
              return (
                <tr key={g}>
                  <td style={{ fontWeight: 500 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{g}</span>
                      {Object.values(map).some(rs => rs.includes("*")) && <Chip tone="accent">wildcard</Chip>}
                    </div>
                  </td>
                  <td><span className="mono small">{users}</span></td>
                  {services.map(s => {
                    const roles = map[s] || [];
                    const perms = roles.flatMap(r => (state.roles[s]?.[r]) || []);
                    const level = roles.length === 0 ? "none" : accessLevelOf(perms);
                    return (
                      <td key={s} className={`matrix-cell lv-${level}`}>
                        {roles.length === 0 ? <span className="small muted">—</span> : (
                          <div className="matrix-stack">
                            <AccessLevel level={level} compact />
                            <span className="small mono" style={{ color: "var(--ink-2)" }}>{roles.join(" · ")}</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <button className="btn ghost sm" onClick={() => setGroupDrawer({ mode: "edit", name: g })}>
                      <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.edit}</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function GroupDrawer() {
  const { groupDrawer, setGroupDrawer, state, setState, isLive, apiCreateGroup, apiUpdateGroup, apiDeleteGroup } = useApp();
  const applyChange = useApplyChange();
  const isEdit = groupDrawer?.mode === "edit";
  const existing = isEdit && groupDrawer.name ? state.groups[groupDrawer.name] : null;
  const [name, setName] = useState(isEdit && groupDrawer?.name ? groupDrawer.name : "");
  const [mapping, setMapping] = useState<Record<string, string[]>>(existing || {});

  useEffect(() => {
    setName(isEdit && groupDrawer?.name ? groupDrawer.name : "");
    setMapping(existing || {});
  }, [groupDrawer?.name, groupDrawer?.mode]);

  if (!groupDrawer) return null;
  const services = state.services.map(s => s.name);
  const validName = /^[a-z0-9_]+$/.test(name);

  const toggle = (svc: string, role: string) => {
    setMapping(prev => {
      const cur = prev[svc] || [];
      const on = cur.includes(role);
      const next = on ? cur.filter(r => r !== role) : [...cur, role];
      const out = { ...prev };
      if (next.length === 0) delete out[svc]; else out[svc] = next;
      return out;
    });
  };

  const save = () => {
    if (!validName) return;
    const summary = isEdit ? `group:${name} updated` : `group:${name} created`;
    const mutator = isLive
      ? () => isEdit ? apiUpdateGroup(name, mapping) : apiCreateGroup(name, mapping)
      : () => {
          setState(s => {
            const next = { ...s.groups };
            if (isEdit && groupDrawer.name && name !== groupDrawer.name) delete next[groupDrawer.name];
            next[name] = mapping;
            return { ...s, groups: next };
          });
        };
    const ok = applyChange(isEdit ? "update" : "create", summary, mutator);
    if (ok) setGroupDrawer(null);
  };

  const remove = () => {
    if (!groupDrawer.name) return;
    const gName = groupDrawer.name;
    const mutator = isLive
      ? () => apiDeleteGroup(gName)
      : () => {
          setState(s => {
            const next = { ...s.groups };
            delete next[gName];
            return { ...s, groups: next, users: s.users.map(u => ({ ...u, groups: u.groups.filter(g => g !== gName) })) };
          });
        };
    const ok = applyChange("delete", `group:${gName} removed`, mutator);
    if (ok) setGroupDrawer(null);
  };

  return (
    <Drawer
      open={!!groupDrawer} onClose={() => setGroupDrawer(null)} size="lg"
      eyebrow={isEdit ? "PUT /api/admin/rbac/groups/{name}" : "POST /api/admin/rbac/groups"}
      title={isEdit ? `Edit group · ${groupDrawer.name}` : "New group"}
      footer={
        <>
          {isEdit ? <button className="btn danger sm" onClick={remove}><span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.trash}</span> Delete group</button> : <div />}
          <div className="row">
            <button className="btn" onClick={() => setGroupDrawer(null)}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={!validName || Object.keys(mapping).length === 0}>{isEdit ? "Apply change" : "Create group"}</button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <label className="input-label">Group name</label>
        <input className="input mono" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. qa, security_reviewers" disabled={isEdit} />
        <div className="input-hint">{name && !validName ? <span style={{ color: "var(--err)" }}>Must match ^[a-z0-9_]+$</span> : "Lowercase, alphanumeric and underscores."}</div>
      </div>
      <label className="input-label">Roles per service</label>
      <div className="panel" style={{ padding: 0 }}>
        {services.map((svc, i) => {
          const roles = Object.keys(state.roles[svc] || {});
          const current = mapping[svc] || [];
          const perms = current.flatMap(r => (state.roles[svc]?.[r]) || []);
          const level = current.length === 0 ? "none" : accessLevelOf(perms);
          return (
            <div key={svc} style={{ padding: 12, borderBottom: i < services.length - 1 ? "1px solid var(--line)" : "none" }}>
              <div className="row mb-8" style={{ justifyContent: "space-between" }}>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{svc}</span>
                <AccessLevel level={level} compact />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {roles.map(r => {
                  const on = current.includes(r);
                  return (
                    <button key={r} onClick={() => toggle(svc, r)} className="chip" style={{ cursor: "pointer", fontWeight: 500, background: on ? "var(--accent)" : "var(--panel-2)", color: on ? "white" : "var(--ink-2)", borderColor: on ? "var(--accent)" : "var(--line)" }}>
                      {on && <span style={{ fontSize: 10 }}>✓</span>} {r}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Drawer>
  );
}
