import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Chip, Drawer, AccessLevel } from '../components/ui/Primitives';
import { accessLevelOf } from '../hooks/useRbac';
import { useApplyChange } from '../hooks/useApplyChange';
import { api } from '../api/client';

export function ServicesPage() {
  const { state, setServiceDrawer, setPage, setActiveService } = useApp();
  return (
    <>
      <div className="page-head">
        <div><h1>Services</h1><div className="sub">Protected upstreams behind Oathkeeper</div></div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setServiceDrawer({ mode: "create" })}>
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.plus}</span> Register service
          </button>
        </div>
      </div>
      <div className="grid g2">
        {state.services.map(s => {
          const roles = Object.keys(state.roles[s.name] || {});
          const routes = (state.routeMaps[s.name] || []).length;
          const perms = Object.values(state.roles[s.name] || {}).flat();
          const level = perms.length === 0 ? "none" : accessLevelOf(perms);
          const groupsTargeting = Object.entries(state.groups).filter(([, m]) => m[s.name]).length;
          const usersTargeting = state.users.filter(u => u.groups.some(g => state.groups[g]?.[s.name])).length;
          return (
            <div key={s.name} className="panel" style={{ padding: 0 }}>
              <div style={{ padding: 14, display: "flex", gap: 12, alignItems: "flex-start", borderBottom: "1px solid var(--line)" }}>
                <span style={{ width: 36, height: 36, borderRadius: 8, background: "var(--panel-2)", border: "1px solid var(--line)", display: "grid", placeItems: "center", color: "var(--ink-2)", flexShrink: 0 }}>{s.name === "global" ? I.globe : I.box}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</span>
                    {s.name === "global" && <Chip tone="info">virtual</Chip>}
                    <div className="flex-1" />
                    <AccessLevel level={level} compact />
                  </div>
                  <div className="small muted mt-4">{s.description}</div>
                  {s.upstreamUrl && <div className="small mono muted mt-4">↗ {s.upstreamUrl}</div>}
                </div>
              </div>
              <div className="svc-stats">
                <div className="svc-stat"><span className="n">{roles.length}</span><span className="l">roles</span></div>
                <div className="svc-stat"><span className="n">{routes}</span><span className="l">routes</span></div>
                <div className="svc-stat"><span className="n">{groupsTargeting}</span><span className="l">groups</span></div>
                <div className="svc-stat"><span className="n">{usersTargeting}</span><span className="l">users</span></div>
              </div>
              <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 6, fontSize: 12, borderTop: "1px solid var(--line)" }}>
                <button className="btn ghost sm" onClick={() => { setActiveService(s.name); setPage("roles"); }}>
                  <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.shield}</span> Roles
                </button>
                <button className="btn ghost sm" onClick={() => { setActiveService(s.name); setPage("routes"); }} disabled={s.name === "global"}>
                  <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.route}</span> Routes
                </button>
                <div className="flex-1" />
                {s.name !== "global" && (
                  <button className="btn ghost sm" onClick={() => setServiceDrawer({ mode: "edit", serviceName: s.name })}>
                    <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.edit}</span> Edit
                  </button>
                )}
                <span className="small muted mono">since {s.createdAt}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function ServiceDrawer() {
  const { serviceDrawer, setServiceDrawer, state, setState, isLive, apiCreateService, pushToast, refetch } = useApp();
  const applyChange = useApplyChange();
  const [name, setName] = useState("");
  const [upstream, setUpstream] = useState("");
  const [description, setDescription] = useState("");

  const isEdit = serviceDrawer?.mode === "edit";
  const editSvc = isEdit && serviceDrawer?.serviceName ? state.services.find(s => s.name === serviceDrawer.serviceName) : null;

  useEffect(() => {
    if (serviceDrawer?.mode === "create") {
      setName(""); setUpstream(""); setDescription("");
    } else if (isEdit && editSvc) {
      setUpstream(editSvc.upstreamUrl || "");
      setDescription(editSvc.description || "");
    }
  }, [serviceDrawer]);

  if (!serviceDrawer) return null;

  const validName = /^[a-z0-9_]+$/.test(name) && !state.services.some(s => s.name === name);
  const validUrl = /^https?:\/\//.test(upstream);

  const saveCreate = () => {
    if (!validName || !validUrl) return;
    const mutator = isLive
      ? () => apiCreateService({ name, upstreamUrl: upstream, matchUrl: `<https?://${name}\\.example\\.io/.*>`, matchMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"] })
      : () => {
          setState(s => ({
            ...s,
            services: [...s.services, { name, upstreamUrl: upstream, description, createdAt: new Date().toISOString().slice(0, 10), routes: 1, roles: 3 }],
            roles: { ...s.roles, [name]: { admin: ["*"], editor: [], viewer: [] } },
            routeMaps: { ...s.routeMaps, [name]: [{ method: "GET", path: "/api/health" }] },
            accessRules: [...s.accessRules, {
              id: `${name}-authenticated`, service: name,
              match: { url: `<http|https>://api.example.io/${name}/<**>`, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
              authenticators: ["cookie_session", "bearer_token"], authorizer: "remote_json",
              opaUrl: "http://opa:8181/v1/data/authz/allow", mutators: ["header"], upstream,
            }],
          }));
        };
    const ok = applyChange("create", `service:${name} registered`, mutator);
    if (ok) setServiceDrawer(null);
  };

  const saveEdit = async () => {
    if (!editSvc) return;
    const svcName = editSvc.name;
    // Find and update the main access rule for this service
    const rule = state.accessRules.find(r => r.service === svcName && !r.id.endsWith('-health'));
    if (isLive && rule) {
      try {
        await api.updateAccessRule(rule.id, { upstream: { url: upstream } } as any);
        setState(s => ({
          ...s,
          services: s.services.map(sv => sv.name === svcName ? { ...sv, upstreamUrl: upstream, description } : sv),
          accessRules: s.accessRules.map(r => r.id === rule.id ? { ...r, upstream } : r),
        }));
        if (refetch) refetch();
        pushToast?.(`service:${svcName} updated`);
      } catch (err: any) {
        pushToast?.(`Failed: ${err.message}`, { err: true });
        return;
      }
    } else {
      setState(s => ({
        ...s,
        services: s.services.map(sv => sv.name === svcName ? { ...sv, upstreamUrl: upstream, description } : sv),
      }));
    }
    setServiceDrawer(null);
  };

  if (isEdit) {
    return (
      <Drawer open={!!serviceDrawer} onClose={() => setServiceDrawer(null)} eyebrow={`PATCH /api/admin/rbac/access-rules/${editSvc?.name}`} title={`Edit ${editSvc?.name}`}
        footer={<><span className="small muted mono">updates upstream URL and description</span><div className="row"><button className="btn" onClick={() => setServiceDrawer(null)}>Cancel</button><button className="btn primary" onClick={saveEdit} disabled={!validUrl}>Save</button></div></>}>
        <div className="mb-12">
          <label className="input-label">Upstream URL</label>
          <input className="input mono" value={upstream} onChange={e => setUpstream(e.target.value)} placeholder="http://service.namespace:8080" />
          <div className="input-hint">{upstream && !validUrl ? <span style={{ color: "var(--err)" }}>Must start with http:// or https://</span> : "Base URL of the upstream service."}</div>
        </div>
        <div className="mb-12">
          <label className="input-label">Description</label>
          <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer open={!!serviceDrawer} onClose={() => setServiceDrawer(null)} eyebrow="POST /api/admin/rbac/services" title="Register service"
      footer={<><span className="small muted mono">creates roles + route_map + oathkeeper rule</span><div className="row"><button className="btn" onClick={() => setServiceDrawer(null)}>Cancel</button><button className="btn primary" onClick={saveCreate} disabled={!validName || !validUrl}>Register</button></div></>}>
      <div className="mb-12">
        <label className="input-label">Service name</label>
        <input className="input mono" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. reporting" />
        <div className="input-hint">{name && !validName ? <span style={{ color: "var(--err)" }}>Invalid or already exists</span> : "Lowercase, alphanumeric and underscores."}</div>
      </div>
      <div className="mb-12">
        <label className="input-label">Upstream URL</label>
        <input className="input mono" value={upstream} onChange={e => setUpstream(e.target.value)} placeholder="http://reporting.local:8080" />
      </div>
      <div className="mb-12">
        <label className="input-label">Description</label>
        <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" />
      </div>
    </Drawer>
  );
}
