import React, { useState, useEffect, useMemo, Fragment } from 'react';
import { AppProvider, useApp } from './contexts/AppContext';
import { useSession } from './api/hooks';
import { I } from './components/ui/Icons';
import { Avatar, Switch, Toasts, EmptyHint } from './components/ui/Primitives';
import { DashboardPage } from './pages/Dashboard';
import { SimulatorPage } from './pages/Simulator';
import { UsersPage, UserDrawer } from './pages/Users';
import { GroupsPage, GroupDrawer } from './pages/Groups';
import { ServicesPage, ServiceDrawer } from './pages/Services';
import { RolesPage } from './pages/Roles';
import { RoutesPage } from './pages/Routes';
import { RulesPage } from './pages/Rules';
import { AuditPage } from './pages/Audit';
import { SettingsPage } from './pages/Settings';
import type { PageId } from './api/types';

const NAV: { id: PageId; name: string; ico: React.ReactNode; section: string }[] = [
  { id: "dashboard", name: "Overview", ico: I.grid, section: "Platform" },
  { id: "simulator", name: "Simulator", ico: I.sparkle, section: "Platform" },
  { id: "users", name: "Users", ico: I.users, section: "Platform" },
  { id: "groups", name: "Groups", ico: I.group, section: "Platform" },
  { id: "services", name: "Services", ico: I.service, section: "Policy" },
  { id: "roles", name: "Roles", ico: I.role, section: "Policy" },
  { id: "routes", name: "Route map", ico: I.route, section: "Policy" },
  { id: "rules", name: "Oathkeeper", ico: I.gate, section: "Gateway" },
  { id: "audit", name: "Audit log", ico: I.audit, section: "Changes" },
  { id: "settings", name: "Settings", ico: I.cog, section: "Changes" },
];

function Sidebar({ onOpenTweaks }: { onOpenTweaks: () => void }) {
  const { page, setPage, state, tweaks, apiError } = useApp();
  const sections = [...new Set(NAV.map(n => n.section))];
  const showCounts = tweaks?.showCounts !== false;
  const isForbidden = tweaks?.simulateForbidden || (apiError as any)?.status === 403;

  // Real session user when live; fallback to "you@console / super_admin"
  const { data: session } = useSession();
  const email = session?.email || "you@console";
  const role  = session?.roles?.[0] || "super_admin";
  const [localPart, domain] = email.includes("@") ? [email.split("@")[0], "@" + email.split("@")[1]] : [email, ""];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-mark">K</div>
        <div className="logo-text">
          <span className="n">Kuma</span>
          <span className="s">RBAC Console</span>
        </div>
      </div>
      <nav className="nav">
        {isForbidden && (
          <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, color: "var(--red, #ef4444)", fontSize: 11.5, fontWeight: 500, background: "color-mix(in srgb, var(--red, #ef4444) 8%, transparent)", borderRadius: 6, margin: "0 2px 4px" }}>
            <span style={{ width: 13, height: 13, display: "grid", placeItems: "center", flexShrink: 0 }}>{I.shield}</span>
            403 · access denied
          </div>
        )}
        {sections.map(sec => (
          <Fragment key={sec}>
            <div className="nav-section">{sec}</div>
            {NAV.filter(n => n.section === sec).map(n => {
              const count =
                n.id === "users" ? state.users.length :
                n.id === "groups" ? Object.keys(state.groups).length :
                n.id === "services" ? state.services.length :
                n.id === "rules" ? state.accessRules.length :
                null;
              return (
                <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
                  <span className="ico">{n.ico}</span>
                  {n.name}
                  {count != null && showCounts && <span className="count">{count}</span>}
                </button>
              );
            })}
          </Fragment>
        ))}
      </nav>
      <div className="sidebar-foot" style={{ cursor: "pointer" }} onClick={() => setPage("settings")} title="Account settings">
        <Avatar name={localPart} />
        <div className="who">
          <span className="n">
            <span className="user-local">{localPart}</span>
            {domain && <span className="user-domain">{domain}</span>}
          </span>
          <span className="e">{role}</span>
        </div>
        <button className="btn ghost sm" style={{ padding: 4 }} onClick={(e) => { e.stopPropagation(); onOpenTweaks(); }} title="Tweaks">
          <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.cog}</span>
        </button>
      </div>
    </aside>
  );
}

function Topbar({ onOpenCmdk }: { onOpenCmdk: () => void }) {
  const { page, pipeline, theme, setTheme, persona, tweaks, isLive, isLoading, apiError, state } = useApp();
  const title = NAV.find(n => n.id === page)?.name || "Console";
  const showPipe = tweaks?.showPipeline !== false;
  const isForbidden = tweaks?.simulateForbidden || (apiError as any)?.status === 403;

  useEffect(() => {
    if ((apiError as any)?.status === 401) {
      const authDomain = state.meta.authDomain || (window as any).__AUTH_DOMAIN__ || 'auth.dev.w6d.io';
      window.location.href = `https://${authDomain}/login?return_to=${encodeURIComponent(window.location.href)}`;
    }
  }, [apiError, state.meta.authDomain]);

  return (
    <>
      <div className="topbar">
        <div className="crumbs">
          <span>Kuma</span>
          <span className="sep">/</span>
          <span className="cur">{title}</span>
        </div>
        <div className="topbar-spacer" />
        {isLoading && (
          <span className="sync-pill syncing">
            <span className="d" />
            loading…
          </span>
        )}
        {!isLoading && !apiError && (
          <span className={`sync-pill ${isLive ? "" : "err"}`} title={isLive ? "Connected to jinbe" : "Disconnected"}>
            <span className="d" />
            {isLive ? "live" : "offline"}
          </span>
        )}
        {!isLoading && (apiError || tweaks?.simulateForbidden) && (
          <span className="sync-pill err" title={apiError?.message || "simulated 403"}>
            <span className="d" />
            {tweaks?.simulateForbidden || (apiError as any)?.status === 403 ? "forbidden" :
             (apiError as any)?.status === 401 ? "session expired" : "offline"}
          </span>
        )}
        {showPipe && pipeline.stage !== "idle" && (
          <span className="sync-pill syncing">
            <span className="d" />
            {pipeline.stage}…
          </span>
        )}
        <button className="search-trigger" onClick={onOpenCmdk}>
          <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.search}</span>
          <span>Search or jump to…</span>
          <span className="kbd">⌘K</span>
        </button>
        <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? I.sun : I.moon}
        </button>
      </div>
      {isForbidden && (
        <div className="viewer-banner" style={{ background: 'var(--red, #ef4444)', color: '#fff' }}>
          <span>{I.shield}</span>
          403 Forbidden · access denied
        </div>
      )}
      {!isForbidden && persona === "viewer" && (
        <div className="viewer-banner">
          <span>{I.shield}</span>
          read-only persona · destructive actions and writes are disabled
        </div>
      )}
    </>
  );
}

function CmdK({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setPage, state, setUserDrawer, setGroupDrawer, setServiceDrawer, setActiveService, setTheme, theme } = useApp();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (open) { setQ(""); setIdx(0); } }, [open]);

  const groups = useMemo(() => {
    const low = q.toLowerCase();
    const match = (s: string) => !low || s.toLowerCase().includes(low);
    const nav = NAV.filter(n => match(n.name)).map(n => ({ kind: "nav", label: `Go to · ${n.name}`, sub: n.id, run: () => setPage(n.id) }));
    const users = state.users.filter(u => match(u.name) || match(u.email)).slice(0, 6).map(u => ({
      kind: "user", label: u.name, sub: u.email, run: () => { setPage("users"); setUserDrawer({ mode: "edit", user: u }); }
    }));
    const grps = Object.keys(state.groups).filter(match).slice(0, 6).map(g => ({
      kind: "group", label: `Edit group · ${g}`, sub: "groups.json", run: () => { setPage("groups"); setGroupDrawer({ mode: "edit", name: g }); }
    }));
    const svcs = state.services.filter(s => match(s.name)).map(s => ({
      kind: "service", label: `Service · ${s.name}`, sub: s.upstreamUrl || "virtual", run: () => { setActiveService(s.name); setPage("roles"); }
    }));
    const actions = [
      { kind: "action", label: "Assign user to group", sub: "Kratos", run: () => { setUserDrawer({ mode: "assign" }); } },
      { kind: "action", label: "New group", sub: "groups.json", run: () => { setGroupDrawer({ mode: "create" }); } },
      { kind: "action", label: "Register service", sub: "creates roles + route_map + rule", run: () => { setServiceDrawer({ mode: "create" }); } },
      { kind: "action", label: `Toggle ${theme === "dark" ? "light" : "dark"} theme`, sub: "ui", run: () => setTheme(theme === "dark" ? "light" : "dark") },
    ].filter(a => match(a.label));
    return [
      { name: "Actions", items: actions },
      { name: "Navigate", items: nav },
      { name: "Users", items: users },
      { name: "Groups", items: grps },
      { name: "Services", items: svcs },
    ].filter(g => g.items.length > 0);
  }, [q, state, theme]);

  const flat = groups.flatMap(g => g.items);
  const fire = (i: number) => { const it = flat[i]; if (it) { it.run(); onClose(); } };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(flat.length - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); fire(idx); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, idx, flat.length]);

  if (!open) return null;
  let running = -1;
  return (
    <div className="cmdk-wrap" onClick={onClose}>
      <div className="cmdk" onClick={e => e.stopPropagation()}>
        <input autoFocus className="cmdk-input" placeholder="Search users, groups, services, actions…" value={q} onChange={e => { setQ(e.target.value); setIdx(0); }} />
        <div className="cmdk-list">
          {groups.length === 0 && <EmptyHint>No matches.</EmptyHint>}
          {groups.map(g => (
            <Fragment key={g.name}>
              <div className="cmdk-group-label">{g.name}</div>
              {g.items.map(it => {
                running++;
                const me = running;
                return (
                  <div key={me} className={`cmdk-item ${me === idx ? "on" : ""}`} onMouseEnter={() => setIdx(me)} onClick={() => fire(me)}>
                    <span className="ico" style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>
                      {it.kind === "nav" ? I.chev : it.kind === "user" ? I.users : it.kind === "group" ? I.group : it.kind === "service" ? I.service : I.plus}
                    </span>
                    <span>{it.label}</span>
                    <span className="sub">{it.sub}</span>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function TweaksPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, setTheme, persona, setPersona, tweaks, setTweak } = useApp();
  if (!open) return null;

  const Seg = ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) => (
    <div className="persona-segs">
      {options.map(o => (
        <button key={o.v} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );

  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <span>Tweaks</span>
        <button className="btn ghost sm" onClick={onClose}><span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.close}</span></button>
      </div>
      <div className="tweaks-body">
        <div className="tweak-section">Appearance</div>
        <div className="tweak-row"><span className="lbl">Dark mode</span><Switch on={theme === "dark"} onChange={v => setTheme(v ? "dark" : "light")} /></div>
        <div className="tweak-row"><span className="lbl">Accent</span><Seg value={tweaks.accent} onChange={v => setTweak("accent", v)} options={[{ v: "terracotta", l: "Terracotta" }, { v: "indigo", l: "Indigo" }, { v: "slate", l: "Slate" }]} /></div>
        <div className="tweak-row"><span className="lbl">Density</span><Seg value={tweaks.density} onChange={v => setTweak("density", v)} options={[{ v: "compact", l: "Compact" }, { v: "comfortable", l: "Comfy" }, { v: "cozy", l: "Cozy" }]} /></div>
        <div className="tweak-section">Console</div>
        <div className="tweak-row"><span className="lbl">Persona</span><Seg value={persona} onChange={setPersona} options={[{ v: "admin", l: "Admin" }, { v: "viewer", l: "Viewer" }]} /></div>
        <div className="tweak-row"><span className="lbl">Collapse nav</span><Switch on={!!tweaks.navCollapsed} onChange={v => setTweak("navCollapsed", v)} /></div>
        <div className="tweak-row"><span className="lbl">Pipeline</span><Switch on={!!tweaks.showPipeline} onChange={v => setTweak("showPipeline", v)} /></div>
        <div className="tweak-row"><span className="lbl">Counts</span><Switch on={!!tweaks.showCounts} onChange={v => setTweak("showCounts", v)} /></div>
        <div className="tweak-row">
          <span className="lbl" style={tweaks.simulateForbidden ? { color: "var(--red, #ef4444)" } : {}}>Forbidden</span>
          <Switch on={!!tweaks.simulateForbidden} onChange={v => setTweak("simulateForbidden", v)} />
        </div>
      </div>
    </div>
  );
}

function ForbiddenPage() {
  const { page } = useApp();
  const label = NAV.find(n => n.id === page)?.name || "this page";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16 }}>
      <span style={{ width: 44, height: 44, display: "grid", placeItems: "center", color: "var(--red, #ef4444)", opacity: 0.7 }}>{I.shield}</span>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Access denied · {label}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Your account has no groups assigned — contact an administrator.</div>
      </div>
    </div>
  );
}

function AppShell() {
  const { page, toasts, apiError, tweaks } = useApp();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdkOpen(v => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <Sidebar onOpenTweaks={() => setTweaksOpen(true)} />
      <div className="main">
        <Topbar onOpenCmdk={() => setCmdkOpen(true)} />
        <div className="content">
          {(tweaks?.simulateForbidden || (apiError as any)?.status === 403) ? <ForbiddenPage /> : <>
            {page === "dashboard" && <DashboardPage />}
            {page === "simulator" && <SimulatorPage />}
            {page === "users" && <UsersPage />}
            {page === "groups" && <GroupsPage />}
            {page === "services" && <ServicesPage />}
            {page === "roles" && <RolesPage />}
            {page === "routes" && <RoutesPage />}
            {page === "rules" && <RulesPage />}
            {page === "audit" && <AuditPage />}
            {page === "settings" && <SettingsPage />}
          </>}
        </div>
      </div>
      <UserDrawer />
      <GroupDrawer />
      <ServiceDrawer />
      <CmdK open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
      <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)} />
      <Toasts toasts={toasts} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
