import { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { AccessLevel, EmptyHint } from '../components/ui/Primitives';
import { accessLevelOf } from '../hooks/useRbac';
import { useApplyChange } from '../hooks/useApplyChange';
import { useUpdateServiceRoles } from '../api/hooks';
import { api } from '../api/client';

// ─── Permission picker ────────────────────────────────────────────────────────

interface PermPickerProps {
  svc: string;
  allRoles: Record<string, Record<string, string[]>>;  // service → role → perms
  apiPerms: string[];
  current: string[];
  onToggle: (p: string) => void;
  onAdd: (p: string) => void;
}

function PermPicker({ svc, allRoles, apiPerms, current, onToggle, onAdd }: PermPickerProps) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // All known perms: API-fetched + across every service/role, deduplicated, excluding "*"
  const allPerms = useMemo(() => {
    const set = new Set<string>(apiPerms);
    for (const roles of Object.values(allRoles)) {
      for (const perms of Object.values(roles)) {
        for (const p of perms) {
          if (p !== "*") set.add(p);
        }
      }
    }
    return Array.from(set).sort();
  }, [allRoles, apiPerms]);

  // Group by namespace prefix (before first ":")
  const groups = useMemo(() => {
    const filtered = q
      ? allPerms.filter(p => p.toLowerCase().includes(q.toLowerCase()))
      : allPerms;

    const map: Record<string, string[]> = {};
    for (const p of filtered) {
      const ns = p.includes(":") ? p.split(":")[0] : "other";
      (map[ns] ??= []).push(p);
    }
    // Sort: current service namespace first, then alphabetical
    return Object.entries(map).sort(([a], [b]) => {
      if (a === svc) return -1;
      if (b === svc) return 1;
      return a.localeCompare(b);
    });
  }, [allPerms, q, svc]);

  const customValid = q.trim().length > 0 && !allPerms.includes(q.trim()) && !current.includes(q.trim());

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
      {/* Search / custom input */}
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--line)", background: "var(--panel-2)" }}>
        <span style={{ padding: "0 10px", color: "var(--ink-3)", display: "grid", placeItems: "center", width: 14, height: 14, flexShrink: 0 }}>{I.search ?? "⌕"}</span>
        <input
          ref={inputRef}
          className="input"
          style={{ border: "none", borderRadius: 0, background: "transparent", flex: 1, fontSize: 12, padding: "8px 0" }}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && customValid) { onAdd(q.trim()); setQ(""); }
          }}
          placeholder="Filter or type new permission…"
        />
        {customValid && (
          <button
            className="btn primary sm"
            style={{ margin: "4px 6px", padding: "3px 10px", fontSize: 11 }}
            onClick={() => { onAdd(q.trim()); setQ(""); }}
          >
            Add "{q.trim()}"
          </button>
        )}
      </div>

      {/* Grouped permission list */}
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {groups.length === 0 && (
          <div style={{ padding: "12px 14px", color: "var(--ink-3)", fontSize: 12 }}>
            {q ? `No match — press Enter to add "${q}"` : "No permissions defined yet."}
          </div>
        )}
        {groups.map(([ns, perms]) => (
          <div key={ns}>
            <div style={{ padding: "5px 12px 3px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--ink-3)", borderTop: "1px solid var(--line)", background: "var(--bg)" }}>
              {ns}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "6px 10px 8px" }}>
              {perms.map(p => {
                const active = current.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => onToggle(p)}
                    style={{
                      padding: "3px 10px",
                      borderRadius: 20,
                      fontSize: 11.5,
                      fontFamily: "var(--font-mono, monospace)",
                      border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                      background: active ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "transparent",
                      color: active ? "var(--accent)" : "var(--ink-2)",
                      cursor: "pointer",
                      transition: "all 0.1s",
                    }}
                  >
                    {active && <span style={{ marginRight: 4, fontSize: 10 }}>✓</span>}
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function RolesPage() {
  const { state, setState, activeService, setActiveService, isLive } = useApp();
  const applyChange = useApplyChange();
  const svc = activeService || state.services[0].name;
  const svcRoles = state.roles[svc] || {};
  const [selectedRole, setSelectedRole] = useState(Object.keys(svcRoles)[0] || "");
  const [newRoleName, setNewRoleName] = useState("");
  const [addingRole, setAddingRole] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [apiPerms, setApiPerms] = useState<string[]>([]);

  const updateServiceRoles = useUpdateServiceRoles(svc);

  useEffect(() => {
    const keys = Object.keys(state.roles[svc] || {});
    if (!keys.includes(selectedRole)) setSelectedRole(keys[0] || "");
    setShowPicker(false);
    if (isLive) {
      api.getServicePermissions(svc).then(r => setApiPerms(r.permissions)).catch(() => setApiPerms([]));
    }
  }, [svc, isLive]);

  useEffect(() => {
    const keys = Object.keys(state.roles[svc] || {});
    if (!keys.includes(selectedRole)) setSelectedRole(keys[0] || "");
  }, [state.roles]);

  const role = svcRoles[selectedRole];

  const applyRoleUpdate = (updated: Record<string, string[]>) => {
    if (isLive) return updateServiceRoles.mutateAsync(updated).then(() => {
      setState(s => ({ ...s, roles: { ...s.roles, [svc]: updated } }));
    }) as Promise<void>;
    setState(s => ({ ...s, roles: { ...s.roles, [svc]: updated } }));
  };

  const togglePerm = (p: string) => {
    if (!role || role.includes("*")) return;
    const has = role.includes(p);
    const verb = has ? "update" : "update";
    const label = has ? `role:${svc}.${selectedRole} − "${p}"` : `role:${svc}.${selectedRole} + "${p}"`;
    applyChange(verb, label, () => {
      const newPerms = has ? role.filter(x => x !== p) : [...role, p];
      return applyRoleUpdate({ ...svcRoles, [selectedRole]: newPerms });
    });
  };

  const addNewPerm = (p: string) => {
    if (!role || role.includes("*") || role.includes(p)) return;
    applyChange("update", `role:${svc}.${selectedRole} + "${p}"`, () => {
      return applyRoleUpdate({ ...svcRoles, [selectedRole]: [...role, p] });
    });
  };

  const addRole = () => {
    const name = newRoleName.trim();
    if (!name || svcRoles[name] !== undefined) return;
    applyChange("create", `role:${svc}.${name}`, () => {
      const updated = { ...svcRoles, [name]: [] as string[] };
      if (isLive) return updateServiceRoles.mutateAsync(updated).then(() => {
        setState(s => ({ ...s, roles: { ...s.roles, [svc]: updated } }));
        setSelectedRole(name);
      }) as Promise<void>;
      setState(s => ({ ...s, roles: { ...s.roles, [svc]: updated } }));
      setSelectedRole(name);
    });
    setNewRoleName("");
    setAddingRole(false);
  };

  const validNewRole = newRoleName.trim().length > 0 && svcRoles[newRoleName.trim()] === undefined;

  return (
    <>
      <div className="page-head">
        <div><h1>Roles & permissions</h1><div className="sub"><span className="mono">roles.{svc}.json</span></div></div>
        <div className="page-actions">
          <select className="input mono" style={{ width: "auto" }} value={svc} onChange={e => setActiveService(e.target.value)}>
            {state.services.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "240px 1fr", gap: 14 }}>

        {/* ── Role list sidebar ── */}
        <div className="panel" style={{ padding: 0 }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)", flex: 1 }}>Roles</span>
            <button className="btn ghost sm" onClick={() => setAddingRole(v => !v)} title="New role" style={{ padding: "2px 6px" }}>
              <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.plus}</span>
            </button>
          </div>
          {addingRole && (
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", display: "flex", gap: 6 }}>
              <input
                className="input mono"
                style={{ flex: 1, fontSize: 12 }}
                autoFocus
                value={newRoleName}
                onChange={e => setNewRoleName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") addRole();
                  if (e.key === "Escape") { setAddingRole(false); setNewRoleName(""); }
                }}
                placeholder="role name"
              />
              <button className="btn primary sm" onClick={addRole} disabled={!validNewRole} style={{ padding: "2px 8px" }}>Add</button>
            </div>
          )}
          {Object.keys(svcRoles).map(r => {
            const on = r === selectedRole;
            const lv = svcRoles[r].includes("*") ? "admin" : accessLevelOf(svcRoles[r]);
            return (
              <button key={r} onClick={() => setSelectedRole(r)} style={{ width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: "1px solid var(--line)", background: on ? "var(--panel-2)" : "transparent", color: "var(--ink)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: on ? 600 : 400, flex: 1 }}>{r}</span>
                <AccessLevel level={lv} compact />
              </button>
            );
          })}
          {Object.keys(svcRoles).length === 0 && <EmptyHint>No roles defined.</EmptyHint>}
        </div>

        {/* ── Role detail panel ── */}
        <div className="panel">
          {!role ? <EmptyHint>Select a role.</EmptyHint> : (
            <>
              <div className="panel-head">
                <div>
                  <h3><span className="mono">{svc}.{selectedRole}</span></h3>
                  <div className="sub">{role.includes("*") ? "Wildcard — full access" : `${role.length} permission${role.length !== 1 ? "s" : ""}`}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {!role.includes("*") && (
                    <button
                      className={`btn ghost sm`}
                      onClick={() => setShowPicker(v => !v)}
                      style={{ gap: 6 }}
                    >
                      <span style={{ width: 13, height: 13, display: "grid", placeItems: "center" }}>{I.plus}</span>
                      {showPicker ? "Hide picker" : "Add permissions"}
                    </button>
                  )}
                  <AccessLevel level={role.includes("*") ? "admin" : accessLevelOf(role)} />
                </div>
              </div>
              <div className="panel-body">
                {role.includes("*") ? (
                  <div className="small muted">This role grants every permission in the service.</div>
                ) : (
                  <>
                    {/* Active permissions chips */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: showPicker ? 14 : 0 }}>
                      {role.length === 0 && !showPicker && <span className="small muted">No permissions yet — click "Add permissions" above.</span>}
                      {role.map(p => (
                        <span key={p} className="chip" style={{ paddingRight: 3 }}>
                          {p}
                          <button onClick={() => togglePerm(p)} style={{ border: "none", background: "transparent", color: "var(--ink-3)", cursor: "pointer", padding: "0 3px", display: "grid", placeItems: "center" }}>
                            <span style={{ width: 11, height: 11, display: "grid", placeItems: "center" }}>{I.close}</span>
                          </button>
                        </span>
                      ))}
                    </div>

                    {/* Permission picker */}
                    {showPicker && (
                      <PermPicker
                        svc={svc}
                        allRoles={state.roles}
                        apiPerms={apiPerms}
                        current={role}
                        onToggle={togglePerm}
                        onAdd={addNewPerm}
                      />
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
