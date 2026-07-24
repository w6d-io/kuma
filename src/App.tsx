import React, { useState, useEffect, useMemo, Fragment } from 'react';
import { AppProvider, useApp } from './contexts/AppContext';
import { useSession, useStats, useRealtime, useUserSearch } from './api/hooks';
import { searchedToUser } from './api/transforms';
import { I } from './components/ui/Icons';
import { Avatar, Switch, Toasts, EmptyHint } from './components/ui/Primitives';
import { DashboardPage } from './pages/Dashboard';
import { SimulatorPage } from './pages/Simulator';
import { UsersPage, UserDrawer } from './pages/Users';
import { OrgAdminPage } from './pages/OrgAdmin';
import { GroupsPage, GroupDrawer } from './pages/Groups';
import { ServicesPage, ServiceDrawer } from './pages/Services';
import { OrganizationsPage } from './pages/Organizations';
import { GrantAccess } from './pages/GrantAccess';
import { AuditPage } from './pages/Audit';
import { SettingsPage } from './pages/Settings';
import { BackupPage } from './pages/Backup';
import type { PageId } from './api/types';

type NavItem = {
  id: PageId
  name: string
  ico: React.ReactNode
  section: string
  /** Permissions required to access this page. User needs at least one. Empty = always visible. */
  perms: string[]
}

const NAV: NavItem[] = [
  { id: "dashboard", name: "Overview",  ico: I.grid,    section: "Platform", perms: [] },
  { id: "simulator", name: "Simulator", ico: I.sparkle, section: "Platform", perms: ["admin:read"] },
  { id: "users",     name: "Users",     ico: I.users,   section: "Platform", perms: ["admin:read"] },
  { id: "groups",    name: "Groups",    ico: I.group,   section: "Platform", perms: ["admin:read"] },
  { id: "services",  name: "Services",  ico: I.service, section: "Policy",   perms: ["admin:read"] },
  { id: "organizations", name: "Organizations", ico: I.globe, section: "Policy", perms: ["admin:read"] },
  { id: "audit",     name: "Audit log", ico: I.audit,   section: "Changes",  perms: ["admin:read"] },
  // Backup tab only appears when the chart enabled backup (see filter below).
  { id: "backup",    name: "Backup",    ico: I.box,     section: "Changes",  perms: ["admin:read"] },
  { id: "settings",  name: "Settings",  ico: I.cog,     section: "Changes",  perms: [] },
  // Delegated org-admin self-service. perms [] = visible to any authenticated
  // user; the page itself shows an empty state when you administer no orgs.
  { id: "orgadmin",  name: "Org Admin", ico: I.globe,   section: "My org",   perms: [] },
]

// The "Forbidden" tweak fakes a 403 across the whole app (blanks the UI). It is
// a development aid only — never let it take effect in a production build
// (UX-3). Gate every read through this helper.
const DEV = import.meta.env.DEV;
function simulatingForbidden(tweaks: { simulateForbidden?: boolean } | undefined): boolean {
  return DEV && !!tweaks?.simulateForbidden;
}

/** True if user has any of the required permissions or holds the wildcard "*". */
function hasAnyPerm(userPerms: string[] | undefined, required: string[]): boolean {
  if (required.length === 0) return true
  if (!userPerms || userPerms.length === 0) return false
  if (userPerms.includes("*")) return true
  return required.some((r) => userPerms.includes(r))
}

function Sidebar({ onOpenTweaks }: { onOpenTweaks: () => void }) {
  const { page, setPage, state, tweaks, apiError } = useApp();
  const showCounts = tweaks?.showCounts !== false;
  const isForbidden = simulatingForbidden(tweaks) || (apiError as any)?.status === 403;

  const { data: session } = useSession();
  const { data: stats } = useStats();
  const email = session?.email || "you@console";
  const role  = session?.roles?.[0] || "";
  const [localPart, domain] = email.includes("@") ? [email.split("@")[0], "@" + email.split("@")[1]] : [email, ""];

  // Filter nav by user permissions — non-admins only see Overview + Settings.
  const visibleNav = NAV.filter((n) => hasAnyPerm(session?.permissions, n.perms))
  const sections = [...new Set(visibleNav.map((n) => n.section))]

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
            {visibleNav.filter(n => n.section === sec).map(n => {
              const count =
                n.id === "users" ? (stats?.total ?? state.users.length) :
                n.id === "groups" ? Object.keys(state.groups).length :
                n.id === "services" ? state.services.length :
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
      <div className="sidebar-foot" style={{ cursor: "pointer" }} onClick={() => {
        // Account settings live on the auth domain — open in a new tab so
        // the kuma session stays put (no return_to round-trip needed). The
        // window-level __AUTH_DOMAIN__ is injected by the chart at runtime.
        const authDomain = (window as any).__AUTH_DOMAIN__;
        if (authDomain) {
          window.open(`https://${authDomain}/settings`, '_blank', 'noopener,noreferrer');
        } else {
          // Fallback to in-app settings (admin-only RBAC management) if no
          // auth domain configured.
          setPage("settings");
        }
      }} title="Account settings · opens in new tab">
        <Avatar name={localPart} />
        <div className="who">
          <span className="n">
            <span className="user-local">{localPart}</span>
            {domain && <span className="user-domain">{domain}</span>}
          </span>
          <span className="e">{role}</span>
          <button
            type="button"
            className="logout-link"
            onClick={async (e) => {
              e.stopPropagation();
              const authDomain = (window as any).__AUTH_DOMAIN__;
              if (!authDomain) return;
              const returnTo = `https://${authDomain}/login`;
              // Kratos logout is TWO steps: /self-service/logout/browser CREATES
              // the flow and returns JSON { logout_url } (carrying the CSRF
              // token); you must then navigate to logout_url. Navigating
              // straight to the browser endpoint just renders that JSON — the
              // bug this fixes. kuma and auth are served from the same parent
              // domain, so the session cookie is sent, and Kratos CORS allows
              // the app's subdomain with credentials, so this fetch is reliable.
              try {
                const res = await fetch(
                  `https://${authDomain}/self-service/logout/browser?return_to=${encodeURIComponent(returnTo)}`,
                  { credentials: 'include', headers: { Accept: 'application/json' } },
                );
                const data = await res.json();
                if (data?.logout_url) { window.location.href = data.logout_url; return; }
              } catch { /* fall through to a best-effort redirect */ }
              window.location.href = returnTo;
            }}
            title="Sign out"
            style={{
              fontSize: 11,
              color: 'var(--ink-3)',
              textDecoration: 'none',
              marginTop: 2,
              display: 'inline-block',
              background: 'none',
              border: 0,
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            ↩ Sign out
          </button>
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
  const isForbidden = simulatingForbidden(tweaks) || (apiError as any)?.status === 403;

  useEffect(() => {
    if ((apiError as any)?.status === 401) {
      const authDomain = state.meta.authDomain || (window as any).__AUTH_DOMAIN__;
      if (!authDomain) {
        // No runtime config and no API metadata — surface the misconfig instead of
        // silently redirecting somewhere unexpected.
        console.error('Kuma: AUTH_DOMAIN is not configured. Set the AUTH_DOMAIN env on the container, or have jinbe expose meta.authDomain.');
        return;
      }
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
        {!isLoading && (apiError || simulatingForbidden(tweaks)) && (
          <span className="sync-pill err" title={apiError?.message || "simulated 403"}>
            <span className="d" />
            {simulatingForbidden(tweaks) || (apiError as any)?.status === 403 ? "forbidden" :
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
  const { setPage, state, setGroupDrawer, setServiceDrawer, setActiveService, setGrant, setTheme, theme } = useApp();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (open) { setQ(""); setIdx(0); } }, [open]);

  // Users come from server-side search (no full-directory dependency), so ⌘K
  // finds anyone in the ~10k directory, not just the loaded page.
  const userSearch = useUserSearch(q);
  const userResults = useMemo(() => (userSearch.data ?? []).map(searchedToUser), [userSearch.data]);

  const groups = useMemo(() => {
    const low = q.toLowerCase();
    const match = (s: string) => !low || s.toLowerCase().includes(low);
    const nav = NAV.filter(n => match(n.name)).map(n => ({ kind: "nav", label: `Go to · ${n.name}`, sub: n.id, run: () => setPage(n.id) }));
    const users = userResults.slice(0, 6).map(u => ({
      kind: "user", label: u.name, sub: u.email, run: () => { setGrant({ user: u }); }
    }));
    const grps = Object.keys(state.groups).filter(match).slice(0, 6).map(g => ({
      kind: "group", label: `Edit group · ${g}`, sub: "groups.json", run: () => { setPage("groups"); setGroupDrawer({ mode: "edit", name: g }); }
    }));
    const svcs = state.services.filter(s => match(s.name)).map(s => ({
      kind: "service", label: `Service · ${s.name}`, sub: s.upstreamUrl || "virtual", run: () => { setActiveService(s.name); setPage("services"); }
    }));
    const actions = [
      { kind: "action", label: "Grant access to a user", sub: "guided", run: () => { setGrant({}); } },
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
    // Context setters are stable; results recompute on q/state/theme/search only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, state, theme, userResults]);

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
    // `fire`/`onClose` are recreated each render but only read on keypress;
    // re-subscribing on every render would thrash the listener. Keyed on the
    // inputs that change behaviour (open/idx/result count).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {DEV && (
          <div className="tweak-row">
            <span className="lbl" style={tweaks.simulateForbidden ? { color: "var(--red, #ef4444)" } : {}}>Forbidden <span className="small muted">(dev)</span></span>
            <Switch on={!!tweaks.simulateForbidden} onChange={v => setTweak("simulateForbidden", v)} />
          </div>
        )}
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
  const { page, setPage, toasts, apiError, tweaks } = useApp();
  const { data: session, isSuccess: sessionReady } = useSession();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  // Real-time: subscribe to the server change stream (admins only) so the whole
  // console reflects changes sub-second without polling.
  const isAdmin = !!session?.permissions?.some(p => p === '*' || p === 'admin:read');
  useRealtime(isAdmin);

  // If the user landed on a page they cannot access (direct URL / reload),
  // bounce to Overview. Only act once the session query has SUCCESSFULLY
  // resolved: while it is still loading, session.permissions is undefined and
  // bouncing here would wrongly redirect every reload/navigation to the
  // dashboard. A failed/401 session is handled by the Topbar redirect, not here.
  useEffect(() => {
    if (!sessionReady) return
    // roles/routes/rules are aliases that render the Services workspace but have
    // no NAV entry — resolve to the canonical id so they inherit the same gate.
    const canonical = (page === 'roles' || page === 'routes' || page === 'rules') ? 'services' : page
    const nav = NAV.find((n) => n.id === canonical)
    if (!nav) return
    if (!hasAnyPerm(session?.permissions, nav.perms)) {
      // Land the user on a surface they can actually use. Platform admins get
      // Overview; a delegated org admin (no admin:read) gets Org Admin instead
      // of Overview's "you can't be here" state.
      const canAdmin = !!session?.permissions?.some((p) => p === '*' || p === 'admin:read')
      setPage(canAdmin ? 'dashboard' : 'orgadmin')
    }
  }, [page, sessionReady, session?.permissions, setPage])

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
          {(simulatingForbidden(tweaks) || (apiError as any)?.status === 403) ? <ForbiddenPage /> : <>
            {page === "dashboard" && <DashboardPage />}
            {page === "simulator" && <SimulatorPage />}
            {page === "users" && <UsersPage />}
            {page === "groups" && <GroupsPage />}
            {(page === "services" || page === "roles" || page === "routes" || page === "rules") && <ServicesPage />}
            {page === "organizations" && <OrganizationsPage />}
            {page === "audit" && <AuditPage />}
            {page === "backup" && <BackupPage />}
            {page === "settings" && <SettingsPage />}
            {page === "orgadmin" && <OrgAdminPage />}
          </>}
        </div>
      </div>
      <UserDrawer />
      <GroupDrawer />
      <ServiceDrawer />
      <GrantAccess />
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
