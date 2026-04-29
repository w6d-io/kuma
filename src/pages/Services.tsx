import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Chip, Drawer, AccessLevel } from '../components/ui/Primitives';
import { accessLevelOf } from '../hooks/useRbac';
import { useApplyChange } from '../hooks/useApplyChange';

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

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
  const { serviceDrawer, setServiceDrawer, state, setState, isLive, apiCreateService, apiUpdateService, apiDeleteService, setPage } = useApp();
  const applyChange = useApplyChange();

  const isEdit = serviceDrawer?.mode === "edit";
  const editSvc = isEdit && serviceDrawer?.serviceName ? state.services.find(s => s.name === serviceDrawer.serviceName) : null;
  const editRule = editSvc ? state.accessRules.find(r => r.service === editSvc.name) : null;

  // create fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // shared fields (create + edit)
  const [upstream, setUpstream] = useState("");
  const [matchUrl, setMatchUrl] = useState("");
  const [matchMethods, setMatchMethods] = useState<string[]>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  const [stripPath, setStripPath] = useState("");

  // edit danger
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!serviceDrawer) return;
    setConfirmDelete(false);
    if (serviceDrawer.mode === "create") {
      setName(""); setUpstream(""); setDescription(""); setMatchUrl(""); setStripPath("");
      setMatchMethods(["GET", "POST", "PUT", "PATCH", "DELETE"]);
    } else if (isEdit && editSvc) {
      setUpstream(editSvc.upstreamUrl || "");
      setDescription(editSvc.description || "");
      setMatchUrl(editRule?.match.url || "");
      setMatchMethods(editRule?.match.methods || ["GET", "POST", "PUT", "PATCH", "DELETE"]);
      setStripPath(editRule?.stripPath || "");
    }
  }, [serviceDrawer?.mode, serviceDrawer?.serviceName]);

  if (!serviceDrawer) return null;

  const validName = /^[a-z0-9_]+$/.test(name) && !state.services.some(s => s.name === name);
  const validUrl = /^https?:\/\//.test(upstream);

  const toggleMethod = (m: string) =>
    setMatchMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);

  const saveCreate = () => {
    if (!validName || !validUrl) return;
    const mutator = isLive
      ? () => apiCreateService({
          name, upstreamUrl: upstream,
          matchUrl: matchUrl || `<https?://${name}\\.example\\.io/.*>`,
          matchMethods,
          stripPath: stripPath || undefined,
        })
      : () => {
          setState(s => ({
            ...s,
            services: [...s.services, { name, upstreamUrl: upstream, description, createdAt: new Date().toISOString().slice(0, 10), routes: 1, roles: 3 }],
            roles: { ...s.roles, [name]: { admin: ["*"], editor: [], viewer: [] } },
            routeMaps: { ...s.routeMaps, [name]: [{ method: "GET", path: "/api/health" }] },
            accessRules: [...s.accessRules, {
              id: `${name}-authenticated`, service: name,
              match: { url: matchUrl || `<http|https>://api.example.io/${name}/<**>`, methods: matchMethods },
              authenticators: ["cookie_session", "bearer_token"], authorizer: "remote_json",
              opaUrl: "http://opa:8181/v1/data/authz/allow", mutators: ["header"], upstream,
              stripPath: stripPath || undefined,
            }],
          }));
        };
    const ok = applyChange("create", `service:${name} registered`, mutator);
    if (ok) setServiceDrawer(null);
  };

  const saveEdit = () => {
    if (!editSvc || !validUrl) return;
    const payload = {
      upstreamUrl: upstream,
      matchUrl: matchUrl || undefined,
      matchMethods: matchMethods.length ? matchMethods : undefined,
      stripPath: stripPath || null,
    };
    const mutator = isLive
      ? () => apiUpdateService(editSvc.name, payload)
      : () => {
          setState(s => ({
            ...s,
            services: s.services.map(sv => sv.name === editSvc.name ? { ...sv, upstreamUrl: upstream, description } : sv),
            accessRules: s.accessRules.map(r => r.service === editSvc.name ? {
              ...r, upstream, match: { url: matchUrl || r.match.url, methods: matchMethods },
              stripPath: stripPath || undefined,
            } : r),
          }));
        };
    const ok = applyChange("update", `service:${editSvc.name} updated`, mutator);
    if (ok) setServiceDrawer(null);
  };

  const doDelete = () => {
    if (!editSvc) return;
    const svcName = editSvc.name;
    const mutator = isLive
      ? () => apiDeleteService(svcName)
      : () => {
          setState(s => ({
            ...s,
            services: s.services.filter(sv => sv.name !== svcName),
            roles: Object.fromEntries(Object.entries(s.roles).filter(([k]) => k !== svcName)),
            routeMaps: Object.fromEntries(Object.entries(s.routeMaps).filter(([k]) => k !== svcName)),
            accessRules: s.accessRules.filter(r => r.service !== svcName),
          }));
        };
    const ok = applyChange("delete", `service:${svcName} removed`, mutator);
    if (ok) { setServiceDrawer(null); setPage("services"); }
  };

  const MethodPicker = () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {HTTP_METHODS.map(m => {
        const on = matchMethods.includes(m);
        return (
          <button key={m} onClick={() => toggleMethod(m)} style={{
            padding: "3px 10px", borderRadius: 20, fontSize: 11.5,
            fontFamily: "var(--font-mono, monospace)",
            border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
            background: on ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "transparent",
            color: on ? "var(--accent)" : "var(--ink-2)", cursor: "pointer",
          }}>{m}</button>
        );
      })}
    </div>
  );

  const SharedFields = () => (
    <>
      <div className="mb-12">
        <label className="input-label">Upstream URL *</label>
        <input className="input mono" value={upstream} onChange={e => setUpstream(e.target.value)} placeholder="http://service.namespace:8080" />
        {upstream && !validUrl && <div className="input-hint" style={{ color: "var(--err)" }}>Must start with http:// or https://</div>}
      </div>
      <div className="mb-12">
        <label className="input-label">Match URL</label>
        <input className="input mono" value={matchUrl} onChange={e => setMatchUrl(e.target.value)} placeholder="<https?://api.example.io/svc/<**>>" />
        <div className="input-hint">Oathkeeper regexp format</div>
      </div>
      <div className="mb-12">
        <label className="input-label">Match methods</label>
        <MethodPicker />
      </div>
      <div className="mb-12">
        <label className="input-label">Strip path <span className="muted">(optional)</span></label>
        <input className="input mono" value={stripPath} onChange={e => setStripPath(e.target.value)} placeholder="/api/v1 — leave empty to remove" />
        <div className="input-hint">Oathkeeper strip_path — empty = remove existing</div>
      </div>
    </>
  );

  if (isEdit) {
    return (
      <Drawer
        open={!!serviceDrawer}
        onClose={() => setServiceDrawer(null)}
        eyebrow={`PATCH /admin/rbac/services/${editSvc?.name}`}
        title={`Edit · ${editSvc?.name}`}
        footer={
          <>
            <span className="small muted mono">PATCH /admin/rbac/services/:name</span>
            <div className="row">
              <button className="btn" onClick={() => setServiceDrawer(null)}>Cancel</button>
              <button className="btn primary" onClick={saveEdit} disabled={!validUrl}>Save</button>
            </div>
          </>
        }
      >
        <SharedFields />
        <div className="mb-12">
          <label className="input-label">Description</label>
          <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" />
        </div>

        {/* Danger zone */}
        <div className="panel" style={{ padding: 14, marginTop: 8 }}>
          <div style={{ fontWeight: 500, marginBottom: 4, color: "var(--red, #ef4444)" }}>Delete service</div>
          <div className="small muted" style={{ marginBottom: 10 }}>
            Removes all roles, routes, Oathkeeper rules, and group assignments for <span className="mono">{editSvc?.name}</span>. Cannot be undone.
          </div>
          {!confirmDelete
            ? (
              <button className="btn" style={{ borderColor: "var(--red, #ef4444)", color: "var(--red, #ef4444)" }} onClick={() => setConfirmDelete(true)}>
                Delete service
              </button>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="small" style={{ flex: 1, color: "var(--red, #ef4444)" }}>Delete {editSvc?.name} and all its data?</span>
                <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button className="btn primary" style={{ background: "var(--red, #ef4444)", borderColor: "var(--red, #ef4444)" }} onClick={doDelete}>Delete</button>
              </div>
            )}
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      open={!!serviceDrawer}
      onClose={() => setServiceDrawer(null)}
      eyebrow="POST /admin/rbac/services"
      title="Register service"
      footer={
        <>
          <span className="small muted mono">creates roles + route_map + oathkeeper rule</span>
          <div className="row">
            <button className="btn" onClick={() => setServiceDrawer(null)}>Cancel</button>
            <button className="btn primary" onClick={saveCreate} disabled={!validName || !validUrl}>Register</button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <label className="input-label">Service name *</label>
        <input className="input mono" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. reporting" />
        <div className="input-hint">{name && !validName ? <span style={{ color: "var(--err)" }}>Invalid or already exists</span> : "Lowercase, alphanumeric and underscores."}</div>
      </div>
      <SharedFields />
      <div className="mb-12">
        <label className="input-label">Description</label>
        <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" />
      </div>
    </Drawer>
  );
}
