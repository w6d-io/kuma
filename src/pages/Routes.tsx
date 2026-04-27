import { useState, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Pagination, usePagination } from '../components/ui/Pagination';
import { Chip, Method, EmptyHint } from '../components/ui/Primitives';
import { useApplyChange } from '../hooks/useApplyChange';
import { useUpdateServiceRoutes } from '../api/hooks';
import type { RouteEntry } from '../api/types';

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// ─── Permission select: known perms + free-text ───────────────────────────────

function PermSelect({ value, onChange, perms }: { value: string; onChange: (v: string) => void; perms: string[] }) {
  const [custom, setCustom] = useState(!perms.includes(value) && value !== "");

  const handleSelect = (v: string) => {
    if (v === "__custom__") { setCustom(true); onChange(""); }
    else { setCustom(false); onChange(v); }
  };

  if (custom) {
    return (
      <div style={{ display: "flex", gap: 4 }}>
        <input
          className="input mono"
          style={{ flex: 1 }}
          autoFocus
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="resource:action"
        />
        <button className="btn ghost sm" onClick={() => { setCustom(false); onChange(""); }} title="Back to list">
          <span style={{ width: 12, height: 12, display: "grid", placeItems: "center" }}>{I.close}</span>
        </button>
      </div>
    );
  }

  return (
    <select className="input mono" value={value} onChange={e => handleSelect(e.target.value)}>
      <option value="">— public (no auth) —</option>
      {perms.map(p => <option key={p} value={p}>{p}</option>)}
      <option value="__custom__">✎ custom…</option>
    </select>
  );
}

// ─── Inline edit row ──────────────────────────────────────────────────────────

interface EditRowProps {
  route: RouteEntry;
  perms: string[];
  onSave: (r: RouteEntry) => void;
  onCancel: () => void;
}

function EditRow({ route, perms, onSave, onCancel }: EditRowProps) {
  const [d, setD] = useState<RouteEntry>({ ...route });
  return (
    <tr style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}>
      <td>
        <select className="input mono" style={{ width: "100%" }} value={d.method} onChange={e => setD(v => ({ ...v, method: e.target.value }))}>
          {METHODS.map(m => <option key={m}>{m}</option>)}
        </select>
      </td>
      <td>
        <input className="input mono" style={{ width: "100%" }} value={d.path} onChange={e => setD(v => ({ ...v, path: e.target.value }))} />
      </td>
      <td colSpan={2}>
        <PermSelect value={d.permission || ""} onChange={v => setD(prev => ({ ...prev, permission: v || undefined }))} perms={perms} />
      </td>
      <td>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="btn primary sm" onClick={() => onSave(d)} disabled={!d.path}>
            <span style={{ width: 13, height: 13, display: "grid", placeItems: "center" }}>{I.check}</span>
          </button>
          <button className="btn ghost sm" onClick={onCancel}>
            <span style={{ width: 13, height: 13, display: "grid", placeItems: "center" }}>{I.close}</span>
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function RoutesPage() {
  const { state, setState, activeService, setActiveService, isLive } = useApp();
  const applyChange = useApplyChange();
  const svc = activeService && state.routeMaps[activeService] ? activeService : "jinbe";
  const routes = state.routeMaps[svc] || [];
  const pg = usePagination(routes.length, 25);
  const [draft, setDraft] = useState({ method: "GET", path: "", permission: "" });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const updateRoutes = useUpdateServiceRoutes(svc);
  const svcRoles = state.roles[svc] || {};
  const hasWildcard = Object.values(svcRoles).some(ps => ps.includes("*"));

  // All unique non-wildcard permissions defined in this service's roles
  const availablePerms = useMemo(() => {
    const set = new Set<string>();
    for (const perms of Object.values(svcRoles)) {
      for (const p of perms) if (p !== "*") set.add(p);
    }
    return Array.from(set).sort();
  }, [svcRoles]);

  const persistRoutes = (newRoutes: RouteEntry[]) => {
    if (isLive) return updateRoutes.mutateAsync(newRoutes).then(() => {
      setState(s => ({ ...s, routeMaps: { ...s.routeMaps, [svc]: newRoutes } }));
    }) as Promise<void>;
    setState(s => ({ ...s, routeMaps: { ...s.routeMaps, [svc]: newRoutes } }));
  };

  const addRoute = () => {
    if (!draft.path || !draft.method) return;
    const payload: RouteEntry = { method: draft.method, path: draft.path };
    if (draft.permission) payload.permission = draft.permission;
    applyChange("add", `route_map.${svc}: ${draft.method} ${draft.path}`, () => {
      return persistRoutes([...routes, payload]);
    });
    setDraft({ method: "GET", path: "", permission: "" });
  };

  const saveEdit = (i: number, updated: RouteEntry) => {
    const newRoutes = routes.map((r, j) => j === i ? updated : r);
    applyChange("update", `route_map.${svc}: ${updated.method} ${updated.path}`, () => {
      return persistRoutes(newRoutes);
    });
    setEditIdx(null);
  };

  const removeRoute = (i: number) => {
    const r = routes[i];
    applyChange("delete", `route_map.${svc} − ${r.method} ${r.path}`, () => {
      return persistRoutes(routes.filter((_, j) => j !== i));
    });
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Route map</h1><div className="sub"><span className="mono">route_map.{svc}.json</span></div></div>
        <div className="page-actions">
          <select className="input mono" style={{ width: "auto" }} value={svc} onChange={e => { setActiveService(e.target.value); setEditIdx(null); }}>
            {state.services.filter(s => s.name !== "global").map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div className="panel mb-12">
        <div className="panel-head"><div><h3>Add route</h3></div></div>
        <div style={{ padding: 14, display: "grid", gridTemplateColumns: "120px 2fr 1.8fr auto", gap: 8 }}>
          <select className="input mono" value={draft.method} onChange={e => setDraft(d => ({ ...d, method: e.target.value }))}>
            {METHODS.map(m => <option key={m}>{m}</option>)}
          </select>
          <input className="input mono" value={draft.path} onChange={e => setDraft(d => ({ ...d, path: e.target.value }))} onKeyDown={e => e.key === "Enter" && addRoute()} placeholder="/api/reports/:id" />
          <PermSelect value={draft.permission} onChange={v => setDraft(d => ({ ...d, permission: v }))} perms={availablePerms} />
          <button className="btn primary" onClick={addRoute} disabled={!draft.path}>Add</button>
        </div>
      </div>
      <div className="panel">
        <table className="table">
          <thead><tr><th style={{ width: 100 }}>Method</th><th>Path</th><th>Permission</th><th>Granted by</th><th style={{ width: 72 }}></th></tr></thead>
          <tbody>
            {routes.slice(pg.from, pg.to).map((r, _pi) => {
              const i = pg.from + _pi; // real index for edit/delete
              if (editIdx === i) {
                return <EditRow key={i} route={r} perms={availablePerms} onSave={u => saveEdit(i, u)} onCancel={() => setEditIdx(null)} />;
              }
              const granted = r.permission ? (hasWildcard ? ["admin (wildcard)"] : Object.entries(svcRoles).filter(([, ps]) => ps.includes(r.permission!)).map(([n]) => n)) : null;
              const orphan = r.permission && (granted || []).length === 0 && !hasWildcard;
              return (
                <tr key={i}>
                  <td><Method m={r.method} /></td>
                  <td className="mono">{r.path}</td>
                  <td>{r.permission ? <Chip tone={orphan ? "err" : ""}>{r.permission}</Chip> : <Chip tone="info">public</Chip>}</td>
                  <td>{!r.permission ? <span className="small muted">no auth required</span> : granted && granted.length > 0 ? <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{granted.map(g => <Chip key={g}>{g}</Chip>)}</span> : orphan ? <Chip tone="err">orphan — no role grants this</Chip> : null}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn ghost sm" onClick={() => setEditIdx(i)} title="Edit">
                        <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.edit}</span>
                      </button>
                      <button className="btn ghost sm" onClick={() => removeRoute(i)} title="Delete">
                        <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.trash}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {routes.length === 0 && <tr><td colSpan={5}><EmptyHint>No routes.</EmptyHint></td></tr>}
          </tbody>
        </table>
        {routes.length > pg.pageSize && (
          <Pagination page={pg.page} pageSize={pg.pageSize} total={routes.length} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
        )}
      </div>
    </>
  );
}
