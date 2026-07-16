import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Chip, Drawer, AccessLevel } from '../components/ui/Primitives';
import { accessLevelOf } from '../hooks/useRbac';
import { useApplyChange } from '../hooks/useApplyChange';
import { RolesPage } from './Roles';
import { RoutesPage } from './Routes';
import { RulesPage } from './Rules';

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

type SvcTab = 'overview' | 'health' | 'roles' | 'routes' | 'gateway';
const SVC_TABS: SvcTab[] = ['overview', 'health', 'roles', 'routes', 'gateway'];
const SVC_TAB_LABEL: Record<SvcTab, string> = { overview: 'Overview', health: 'Health', roles: 'Roles', routes: 'Routes', gateway: 'Gateway' };

// Per-service summary used by the left-rail rows.
function svcSummary(state: ReturnType<typeof useApp>['state'], name: string) {
  const roles = Object.keys(state.roles[name] || {}).length;
  const routes = state.routeMaps[name] || [];
  const openRoutes = routes.filter(r => !r.permission).length;
  const rules = state.accessRules.filter(r => r.service === name);
  const protectedRules = rules.filter(r => r.authorizer === 'remote_json').length;
  const groups = Object.entries(state.groups).filter(([, m]) => m[name]).length;
  const users = state.users.filter(u => u.groups.some(g => state.groups[g]?.[name])).length;
  return { roles, routes: routes.length, openRoutes, rules: rules.length, protectedRules, groups, users };
}

// The Services workspace: one entry per service (no more repeated rows), each
// nesting everything it owns — Overview · Roles · Routes · Gateway — so the
// service↔role↔route↔gateway relationship is a single drill-down instead of
// four scattered top-level tabs sharing a hidden active-service.
export function ServicesPage() {
  const { state, setServiceDrawer, activeService, setActiveService, isLoading, apiError } = useApp();
  const names = state.services.map(s => s.name);
  // Gateway rules whose (re-associated) service isn't in the registry — infra /
  // legacy rules that would otherwise be invisible in every tab.
  const orphanRules = state.accessRules.filter(r => !names.includes(r.service));
  const UNASSIGNED = '__unassigned__';
  const isUnassigned = activeService === UNASSIGNED && orphanRules.length > 0;
  const sel = isUnassigned ? UNASSIGNED : (activeService && names.includes(activeService) ? activeService : (names[0] ?? ""));
  const service = state.services.find(s => s.name === sel);
  const [tab, setTab] = useState<SvcTab>('overview');
  const [q, setQ] = useState("");

  const isGlobal = service?.name === 'global';
  const effectiveTab: SvcTab = isGlobal && (tab === 'routes' || tab === 'gateway') ? 'overview' : tab;
  const filtered = state.services.filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()));

  const header = (
    <div className="page-head">
      <div><h1>Services</h1><div className="sub">Everything a service owns — roles, routes and gateway — in one place</div></div>
      <div className="page-actions">
        <button className="btn primary" onClick={() => setServiceDrawer({ mode: "create" })}>
          <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.plus}</span> Register service
        </button>
      </div>
    </div>
  );

  if (names.length === 0) {
    const err = apiError as { status?: number } | null;
    if (isLoading) {
      return <>{header}<div className="panel" style={{ padding: 40, textAlign: 'center' }}><div className="muted small">Loading services…</div></div></>;
    }
    if (err && err.status !== 403 && err.status !== 401) {
      return <>{header}<div className="panel" style={{ padding: 40, textAlign: 'center' }}><div style={{ color: 'var(--err)' }}>Couldn't load services{err.status ? ` (HTTP ${err.status})` : ''}. Retry shortly.</div></div></>;
    }
    return <>{header}<div className="panel" style={{ padding: 40, textAlign: 'center' }}><div className="muted small">No services yet — register one to define its roles and routes.</div></div></>;
  }

  return (
    <>
      {header}
      <div className="grid" style={{ gridTemplateColumns: "280px 1fr", gap: 14, alignItems: 'start' }}>
        {/* Left rail — one row per service */}
        <div className="panel" style={{ padding: 0 }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
            <input className="input" placeholder="Search services…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%' }} />
          </div>
          {(() => {
            const renderRow = (s: typeof filtered[number]) => {
              const sm = svcSummary(state, s.name);
              const on = s.name === sel;
              return (
                <button key={s.name} onClick={() => setActiveService(s.name)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--line)', background: on ? 'var(--panel-2)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', gap: 9, alignItems: 'center' }}>
                  <span style={{ color: 'var(--ink-3)', flexShrink: 0, display: 'grid', placeItems: 'center', width: 15, height: 15 }}>{s.name === 'global' ? I.globe : I.box}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="mono" style={{ fontWeight: on ? 600 : 500, fontSize: 12.5 }}>{s.name}</span>
                    <div className="small muted mt-4">
                      {sm.roles} roles · {sm.routes} routes
                      {sm.openRoutes > 0 && <> · <span style={{ color: 'var(--warn)' }} title={`${sm.openRoutes} route${sm.openRoutes !== 1 ? 's' : ''} reachable with no permission (public)`}>{sm.openRoutes} public</span></>}
                    </div>
                  </div>
                </button>
              );
            };
            const regular = filtered.filter(s => !s.system);
            const sys = filtered.filter(s => s.system);
            return (
              <>
                {regular.length > 0 && <div className="nav-section" style={{ padding: '8px 12px 4px' }}>Your services</div>}
                {regular.map(renderRow)}
                {sys.length > 0 && <div className="nav-section" style={{ padding: '10px 12px 4px', borderTop: regular.length ? '1px solid var(--line)' : undefined }}>System</div>}
                {sys.map(renderRow)}
                {orphanRules.length > 0 && (
                  <>
                    <div className="nav-section" style={{ padding: '10px 12px 4px', borderTop: '1px solid var(--line)' }}>Other</div>
                    <button onClick={() => setActiveService(UNASSIGNED)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--line)', background: isUnassigned ? 'var(--panel-2)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', gap: 9, alignItems: 'center' }}>
                      <span style={{ color: 'var(--warn)', flexShrink: 0, display: 'grid', placeItems: 'center', width: 15, height: 15 }}>{I.alert}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: isUnassigned ? 600 : 500, fontSize: 12.5 }}>Unassigned rules</span>
                        <div className="small muted mt-4" title="Gateway rules not tied to a registered service">{orphanRules.length} gateway rule{orphanRules.length !== 1 ? 's' : ''} with no service</div>
                      </div>
                    </button>
                  </>
                )}
              </>
            );
          })()}
        </div>

        {/* Right — the selected service and its nested config */}
        <div style={{ minWidth: 0 }}>
          {isUnassigned ? (
            <>
              <div className="panel-head" style={{ marginBottom: 12 }}>
                <div><h3>Unassigned gateway rules</h3><div className="sub">Rules whose service isn't in your registry — infrastructure or legacy routing</div></div>
              </div>
              <RulesPage unassigned />
            </>
          ) : service && (
            <>
              <div className="panel-head" style={{ marginBottom: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <h3 className="row" style={{ gap: 8 }}>
                    <span className="mono">{service.name}</span>
                    {isGlobal && <Chip tone="info">virtual</Chip>}
                    {service.system && <Chip tone="info" title="Bootstrap-protected — cannot be deleted">🔒 system</Chip>}
                  </h3>
                  <div className="sub">{service.upstreamUrl ? <>Internal service · <span className="mono">{service.upstreamUrl}</span></> : 'Virtual service — roles only, no gateway'}</div>
                </div>
                {!isGlobal && (
                  <button className="btn" onClick={() => setServiceDrawer({ mode: 'edit', serviceName: service.name })}>
                    <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.edit}</span> Edit
                  </button>
                )}
              </div>

              <div className="seg" style={{ marginBottom: 12 }}>
                {SVC_TABS.map(t => {
                  const disabled = isGlobal && (t === 'routes' || t === 'gateway');
                  return <button key={t} className={effectiveTab === t ? 'on' : ''} disabled={disabled} onClick={() => setTab(t)}>{SVC_TAB_LABEL[t]}</button>;
                })}
              </div>

              {effectiveTab === 'overview' && <ServiceOverview name={service.name} onEdit={() => setServiceDrawer({ mode: 'edit', serviceName: service.name })} />}
              {effectiveTab === 'health' && <ServiceHealth name={service.name} />}
              {effectiveTab === 'roles' && <RolesPage svc={service.name} />}
              {effectiveTab === 'routes' && !isGlobal && <RoutesPage svc={service.name} />}
              {effectiveTab === 'gateway' && !isGlobal && <RulesPage svc={service.name} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ServiceOverview({ name, onEdit }: { name: string; onEdit: () => void }) {
  const { state } = useApp();
  const sm = svcSummary(state, name);
  const perms = Object.values(state.roles[name] || {}).flat();
  const level = perms.length === 0 ? 'none' : accessLevelOf(perms);
  return (
    <>
      <div className="grid g4 mb-12" style={{ gap: 10 }}>
        <div className="stat"><div className="lbl">Roles</div><div className="val">{sm.roles}</div></div>
        <div className="stat"><div className="lbl">Routes</div><div className="val">{sm.routes}</div></div>
        <div className="stat"><div className="lbl">Groups</div><div className="val">{sm.groups}</div></div>
        <div className="stat"><div className="lbl">Users</div><div className="val">{sm.users}</div></div>
      </div>
      <div className="panel">
        <div className="panel-head"><div><h3>Access summary</h3><div className="sub">Who can reach this service, and how it's protected</div></div><AccessLevel level={level} /></div>
        <div className="panel-body col" style={{ gap: 10 }}>
          <div className="small">{sm.openRoutes > 0
            ? <><span style={{ color: 'var(--warn)' }}>⚠ {sm.openRoutes} public route{sm.openRoutes !== 1 ? 's' : ''}</span> — reachable with no permission.</>
            : sm.routes > 0 ? 'Every route requires a permission.' : 'No routes defined yet.'}</div>
          <div className="small muted">Reached via <b>{sm.groups}</b> group{sm.groups !== 1 ? 's' : ''} → <b>{sm.users}</b> user{sm.users !== 1 ? 's' : ''}.</div>
          {name !== 'global' && !state.services.find(s => s.name === name)?.system && (
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <button className="btn ghost sm" onClick={onEdit}><span style={{ width: 13, height: 13, display: 'grid', placeItems: 'center' }}>{I.edit}</span> Edit service</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ServiceHealth({ name }: { name: string }) {
  const { state } = useApp();
  const roles = state.roles[name] || {};
  const routes = state.routeMaps[name] || [];
  const rules = state.accessRules.filter(r => r.service === name);
  const allPerms = new Set(Object.values(roles).flat());
  const hasWildcard = allPerms.has('*');

  const checks: { ok: boolean; label: string; detail?: string }[] = [];
  const emptyRoles = Object.entries(roles).filter(([, p]) => p.length === 0).map(([r]) => r);
  checks.push({ ok: emptyRoles.length === 0, label: emptyRoles.length ? `${emptyRoles.length} role(s) grant no permission` : 'Every role grants at least one permission', detail: emptyRoles.join(', ') });
  const orphan = routes.filter(r => r.permission && !hasWildcard && !allPerms.has(r.permission));
  checks.push({ ok: orphan.length === 0, label: orphan.length ? `${orphan.length} route(s) require a permission no role grants` : 'Every protected route is grantable by a role', detail: orphan.map(r => `${r.method} ${r.path} → ${r.permission}`).slice(0, 4).join('  ·  ') });
  const pub = routes.filter(r => !r.permission);
  checks.push({ ok: pub.length === 0, label: pub.length ? `${pub.length} public route(s) — reachable with no permission` : 'No public routes', detail: pub.map(r => `${r.method} ${r.path}`).slice(0, 4).join('  ·  ') });
  const dangling: string[] = [];
  Object.entries(state.groups).forEach(([g, m]) => (m[name] || []).forEach(rn => { if (!roles[rn]) dangling.push(`${g} → ${rn}`); }));
  checks.push({ ok: dangling.length === 0, label: dangling.length ? `${dangling.length} group reference(s) to a role that doesn't exist` : 'All group references resolve to a real role', detail: dangling.slice(0, 4).join('  ·  ') });
  if (name !== 'global') {
    const openRules = rules.filter(r => r.authorizer === 'allow').length;
    checks.push({ ok: rules.length > 0, label: rules.length === 0 ? 'No gateway rule — traffic to this service is not routed' : `${rules.length} gateway rule(s)${openRules ? ` · ${openRules} open` : ''}`, detail: rules.length === 0 ? 'Add a match URL + upstream (Edit) to route traffic through the gateway.' : undefined });
  }
  const problems = checks.filter(c => !c.ok).length;

  return (
    <div className="panel">
      <div className="panel-head">
        <div><h3>Health</h3><div className="sub">Integrity checks for this service</div></div>
        {problems === 0 ? <Chip tone="ok">healthy</Chip> : <Chip tone="warn">{problems}</Chip>}
      </div>
      <div style={{ padding: 0 }}>
        {checks.map((c, i) => (
          <div key={i} style={{ padding: '10px 14px', borderBottom: i < checks.length - 1 ? '1px solid var(--line)' : 'none', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ color: c.ok ? 'var(--ok)' : 'var(--warn)', marginTop: 1, flexShrink: 0 }}>{c.ok ? I.check : I.alert}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="small" style={{ color: 'var(--ink)' }}>{c.label}</div>
              {!c.ok && c.detail && <div className="small muted mono mt-4" style={{ wordBreak: 'break-all' }}>{c.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServiceDrawer() {
  const { serviceDrawer, setServiceDrawer, state, apiCreateService, apiUpdateService, apiDeleteService, setPage } = useApp();
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

  // Seed form when the drawer opens (keyed on mode+serviceName). editSvc/editRule
  // derive from the live cache and would re-seed on optimistic edits, wiping the
  // operator's changes — intentionally excluded.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceDrawer?.mode, serviceDrawer?.serviceName]);

  if (!serviceDrawer) return null;

  const validName = /^[a-z0-9_]+$/.test(name) && !state.services.some(s => s.name === name);
  const validUrl = /^https?:\/\//.test(upstream);

  const toggleMethod = (m: string) =>
    setMatchMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);

  // Derive a sane match URL from the real upstream host rather than a bogus
  // example.io default that silently matches nothing (a "registered but
  // unreachable" trap).
  const deriveMatch = (up: string) => {
    try { return `<https?://${new URL(up).host}/.*>`; } catch { return `<https?://${name}/.*>`; }
  };

  const saveCreate = () => {
    if (!validName || !validUrl) return;
    const ok = applyChange("create", `service:${name} registered`, () => apiCreateService({
      name,
      displayName: description || undefined,
      upstreamUrl: upstream,
      matchUrl: matchUrl || deriveMatch(upstream),
      matchMethods,
      stripPath: stripPath || undefined,
    }));
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
    const ok = applyChange("update", `service:${editSvc.name} updated`, () => apiUpdateService(editSvc.name, payload));
    if (ok) setServiceDrawer(null);
  };

  const doDelete = () => {
    if (!editSvc) return;
    const svcName = editSvc.name;
    const ok = applyChange("delete", `service:${svcName} removed`, () => apiDeleteService(svcName));
    if (ok) { setServiceDrawer(null); setPage("services"); }
  };

  // NOTE: these are JSX expressions, NOT component declarations. Declaring a
  // child component INSIDE the render function gives it a fresh identity on
  // every parent render, which causes React to unmount/remount its DOM —
  // including any focused <input>. Using JSX values keeps the same elements
  // across renders so typing in the inputs no longer loses focus per char.
  const methodPicker = (
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

  const sharedFields = (
    <>
      <div className="mb-12">
        <label className="input-label">Upstream URL *</label>
        <input className="input mono" value={upstream} onChange={e => setUpstream(e.target.value)} placeholder="http://service.namespace:8080" />
        {upstream && !validUrl && <div className="input-hint" style={{ color: "var(--err)" }}>Must start with http:// or https://</div>}
      </div>
      <div className="mb-12">
        <label className="input-label">Match URL</label>
        <input className="input mono" value={matchUrl} onChange={e => setMatchUrl(e.target.value)} placeholder="<https?://api.example.io/svc/<**>>" />
        <div className="input-hint">Which request URLs this service handles (regular expression).</div>
      </div>
      <div className="mb-12">
        <label className="input-label">Match methods</label>
        {methodPicker}
      </div>
      <div className="mb-12">
        <label className="input-label">Strip path <span className="muted">(optional)</span></label>
        <input className="input mono" value={stripPath} onChange={e => setStripPath(e.target.value)} placeholder="/api/v1 — leave empty to remove" />
        <div className="input-hint">Path prefix stripped before forwarding — leave empty to remove.</div>
      </div>
    </>
  );

  if (isEdit) {
    return (
      <Drawer
        open={!!serviceDrawer}
        onClose={() => setServiceDrawer(null)}
        eyebrow="Edit service"
        title={`Edit · ${editSvc?.name}`}
        footer={
          <>
            <span className="small muted">Changes apply immediately.</span>
            <div className="row">
              <button className="btn" onClick={() => setServiceDrawer(null)}>Cancel</button>
              <button className="btn primary" onClick={saveEdit} disabled={!validUrl}>Save</button>
            </div>
          </>
        }
      >
        {sharedFields}
        <div className="mb-12">
          <label className="input-label">Description</label>
          <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" />
        </div>

        {/* Danger zone — hidden entirely for system services. The backend
            also enforces this (rbac.service.ts SystemResourceImmutable),
            but UI is the first line of defense. */}
        {editSvc?.system ? (
          <div className="panel" style={{ padding: 14, marginTop: 8 }}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>🔒 System service</div>
            <div className="small muted">
              <span className="mono">{editSvc.name}</span> is bootstrap-protected and cannot be deleted. Removing it would break the platform's RBAC plumbing.
            </div>
          </div>
        ) : (
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
        )}
      </Drawer>
    );
  }

  return (
    <Drawer
      open={!!serviceDrawer}
      onClose={() => setServiceDrawer(null)}
      eyebrow="New service"
      title="Register service"
      footer={
        <>
          <span className="small muted">Also creates the service's role set and gateway rule.</span>
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
      {sharedFields}
      <div className="mb-12">
        <label className="input-label">Description</label>
        <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" />
      </div>
    </Drawer>
  );
}
