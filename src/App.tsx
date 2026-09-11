import React, { useState, useEffect, useMemo, Fragment } from 'react';
import { signIn } from './auth/session';
import { AppProvider, useApp } from './contexts/AppContext';
import { useSession, useStats, useRealtime, useUserSearch } from './api/hooks';
import { searchedToUser } from './api/transforms';
import { I } from './components/ui/Icons';
import { THEMES, nextTheme, themeLabel } from './theme';
import { permits } from './policy/model';
import { Switch, Toasts, EmptyHint } from './components/ui/Primitives';
import { DashboardPage } from './pages/Dashboard';
import { UsersPage, UserDrawer } from './pages/Users';
import { OrgAdminPage } from './pages/OrgAdmin';
import { GroupsPage } from './pages/Groups';
import { OrganizationsPage } from './pages/Organizations';
import { ApisPage } from './pages/Apis';
import { GrantAccess } from './pages/GrantAccess';
import { AuditPage } from './pages/Audit';
import { AccessReviewPage } from './pages/AccessReview';
import { RecertificationPage } from './pages/Recertification';
import { SettingsPage } from './pages/Settings';
import { BackupPage } from './pages/Backup';
import type { PageId } from './api/types';
import { UserMenu } from './components/UserMenu';
import * as Dialog from '@radix-ui/react-dialog';

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
  { id: "users",     name: "Users",     ico: I.users,   section: "Platform", perms: ["admin:read"] },
  { id: "groups",    name: "Groups",    ico: I.group,   section: "Platform", perms: ["admin:read"] },
  // What protects each API and who can reach it, read from the objects the engines load. It replaced
  // a "Services" workspace that edited a registry nothing reads — so it shows and does not offer.
  { id: "apis",      name: "APIs",      ico: I.service, section: "Policy",   perms: ["admin:read"] },
  { id: "organizations", name: "Organizations", ico: I.globe, section: "Policy", perms: ["admin:read"] },
  { id: "audit",     name: "Audit log", ico: I.audit,   section: "Changes",  perms: ["admin:read"] },
  { id: "accessreview", name: "Access review", ico: I.shield, section: "Changes", perms: ["admin:read"] },
  { id: "recertification", name: "Recertification", ico: I.check, section: "Changes", perms: ["admin:read"] },
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

/**
 * Full-page redirect to the auth-domain login. refresh=true forces Kratos to
 * re-authenticate and mint a NEW session — used when a cookie is present but
 * rejected (expired/revoked/corrupt), where a plain /login could see a
 * "still valid" session and bounce straight back, looping.
 */
function redirectToLogin(metaAuthDomain: string | undefined, opts?: { refresh?: boolean }) {
  // An authority, when the deployment named one: it answers with a token the API can verify on its
  // own, where the cookie below asks the API to look a session up. Tried first because a deployment
  // that configured an authority meant it; falls through when none is configured, which is what
  // every deployment did before this was a choice.
  void signIn().then((sent) => {
    if (sent) return;
    redirectToCookieLogin(metaAuthDomain, opts);
  });
}

function redirectToCookieLogin(metaAuthDomain: string | undefined, opts?: { refresh?: boolean }) {
  const authDomain = metaAuthDomain || (window as any).__AUTH_DOMAIN__;
  if (!authDomain) {
    // No runtime config and no API metadata — surface the misconfig instead of
    // silently redirecting somewhere unexpected.
    console.error('Kuma: AUTH_DOMAIN is not configured. Set the AUTH_DOMAIN env on the container, or have jinbe expose meta.authDomain.');
    return;
  }
  const params = new URLSearchParams();
  if (opts?.refresh) params.set('refresh', 'true');
  params.set('return_to', window.location.href);
  window.location.href = `https://${authDomain}/login?${params.toString()}`;
}

/** True if user has any of the required permissions or holds the wildcard "*". */
/**
 * Whether this session admits any of the permissions a screen asks for.
 *
 * Through the model's own coverage rule rather than an exact match, so `admin:write` admits
 * `admin.membership:write` here exactly as it does at the engine. The `*` shortcut is gone with the
 * wildcard: no role carries one, and treating it as a pass let the console open screens on a
 * permission the model does not define.
 */
function hasAnyPerm(userPerms: string[] | undefined, required: string[]): boolean {
  if (required.length === 0) return true
  return required.some((r) => permits(userPerms, r))
}

/**
 * The rail, on a screen wide enough to give it a column of its own. Hidden below the breakpoint,
 * where the same content is served by the sheet instead.
 */
function Sidebar({ onOpenTweaks }: { onOpenTweaks: () => void }) {
  return (
    <aside className="sidebar">
      <RailContent onOpenTweaks={onOpenTweaks} />
    </aside>
  );
}

/**
 * The rail as a sheet, for a screen too narrow to spare 244 pixels.
 *
 * On a dialog primitive rather than by hand: a scrim that closes on click, focus trapped inside
 * while it is open and returned to the button afterwards, Escape, the page behind locked against
 * scrolling, and `aria-modal` for anybody not looking at it. Every one of those is a thing people
 * notice only when it is missing.
 *
 * Closes on navigation, because a menu that stays open over the page you just asked for makes you
 * dismiss it before you can read it.
 */
function RailDrawer({ onOpenTweaks }: { onOpenTweaks: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="burger" aria-label="Menu">
        <span aria-hidden="true">☰</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="rail-scrim" />
        <Dialog.Content className="rail-sheet" aria-label="Navigation">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <RailContent onNavigate={() => setOpen(false)} onOpenTweaks={onOpenTweaks} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * What the rail contains. Rendered twice — once in the fixed rail, once inside the sheet a narrow
 * screen opens — because two copies of a navigation is how the two stop agreeing.
 */
function RailContent({ onNavigate, onOpenTweaks }: { onNavigate?: () => void; onOpenTweaks: () => void }) {
  const { page, setPage, state, tweaks, apiError } = useApp();
  const showCounts = tweaks?.showCounts !== false;
  const isForbidden = simulatingForbidden(tweaks) || (apiError as any)?.status === 403;

  const { data: session } = useSession();
  const { data: stats } = useStats();
  const { theme, cycleTheme } = useApp();

  // Filter nav by user permissions — non-admins only see Overview + Settings.
  const visibleNav = NAV.filter((n) => hasAnyPerm(session?.permissions, n.perms))
  const sections = [...new Set(visibleNav.map((n) => n.section))]

  return (
    <>
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
                null;
              return (
                <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => { setPage(n.id); onNavigate?.(); }}>
                  <span className="ico">{n.ico}</span>
                  {n.name}
                  {count != null && showCounts && <span className="count">{count}</span>}
                </button>
              );
            })}
          </Fragment>
        ))}
      </nav>
      <div className="sidebar-theme">
        <button
          type="button"
          className="theme-btn"
          title={themeLabel(theme)}
          aria-label={themeLabel(theme)}
          onClick={cycleTheme}
        >
          <span className="ico">{theme === "dark" ? I.moon : theme === "light" ? I.sun : I.contrast}</span>
          <span className="lbl">{theme === "system" ? "System theme" : theme === "light" ? "Light" : "Dark"}</span>
        </button>
      </div>
      <div className="sidebar-foot">
        <UserMenu
          email={session?.email || "you@console"}
          role={session?.roles?.[0] || ""}
          onOpenTweaks={onOpenTweaks}
          onOpenSettings={() => {
            // Account settings live on the auth domain — opened in a new tab so this session stays
            // put. __AUTH_DOMAIN__ is injected by the chart at runtime; without one, the in-app
            // settings are the nearest thing that exists.
            const authDomain = (window as unknown as Record<string, string>).__AUTH_DOMAIN__;
            if (authDomain) {
              window.open(`https://${authDomain}/settings`, '_blank', 'noopener,noreferrer');
            } else {
              setPage("settings");
            }
          }}
        />
      </div>
    </>
  );
}

function Topbar({ onOpenCmdk }: { onOpenCmdk: () => void }) {
  const { page, pipeline, theme, cycleTheme, persona, tweaks, isLive, isLoading, apiError, state } = useApp();
  const title = NAV.find(n => n.id === page)?.name || "Console";
  const showPipe = tweaks?.showPipeline !== false;
  const isForbidden = simulatingForbidden(tweaks) || (apiError as any)?.status === 403;

  useEffect(() => {
    if ((apiError as any)?.status === 401) {
      // jinbe tags rejected-but-present credentials (expired/revoked cookie)
      // with code=session_invalid — force re-auth so Kratos regenerates the
      // session instead of bouncing a "valid-looking" broken cookie forever.
      const stale = (apiError as any)?.details?.code === 'session_invalid';
      redirectToLogin(state.meta.authDomain, { refresh: stale });
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
        <button className="icon-btn" title={themeLabel(theme)} aria-label={themeLabel(theme)} onClick={cycleTheme}>
          {theme === "dark" ? I.moon : theme === "light" ? I.sun : I.contrast}
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
  const { setPage, state, setGrant, cycleTheme, theme } = useApp();
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
      kind: "group", label: `Group · ${g}`, sub: "groups.json", run: () => { setPage("groups"); }
    }));
    const actions = [
      { kind: "action", label: "Grant access to a user", sub: "guided", run: () => { setGrant({}); } },
      { kind: "action", label: `Theme · ${nextTheme(theme)}`, sub: "system · light · dark", run: () => cycleTheme() },
    ].filter(a => match(a.label));
    return [
      { name: "Actions", items: actions },
      { name: "Navigate", items: nav },
      { name: "Users", items: users },
      { name: "Groups", items: grps },
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
        <input autoFocus className="cmdk-input" placeholder="Search users, groups, actions…" value={q} onChange={e => { setQ(e.target.value); setIdx(0); }} />
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
        <div className="tweak-row">
          <span className="lbl">Theme</span>
          <div className="persona-segs">
            {THEMES.map(t => (
              <button key={t} className={theme === t ? "on" : ""} onClick={() => setTheme(t)}>{t}</button>
            ))}
          </div>
        </div>
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
  const { page, setPage, toasts, apiError, tweaks, state } = useApp();
  const { data: session, isSuccess: sessionReady } = useSession();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  // Act on jinbe's /whoami verdict directly (it answers 200 with
  // authenticated:false for missing OR broken cookies — it never 401s).
  // Without this, only ADMIN queries trigger the login redirect, so a
  // non-admin with a dead cookie was stranded on a 403 page. session.error
  // set = a cookie WAS presented but rejected → refresh=true regenerates it.
  useEffect(() => {
    if (!sessionReady || !session || session.authenticated) return;
    redirectToLogin(state.meta.authDomain, { refresh: !!session.error });
  }, [sessionReady, session, state.meta.authDomain]);

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
    // `enforced` is the old id of this screen, kept so a bookmark still opens it. It has
    // no NAV entry — resolve to the canonical id so they inherit the same gate.
    const canonical = page === 'enforced' ? 'apis' : page
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
      <RailDrawer onOpenTweaks={() => setTweaksOpen(true)} />
      <div className="main">
        <Topbar onOpenCmdk={() => setCmdkOpen(true)} />
        <div className="content">
          {(simulatingForbidden(tweaks) || (apiError as any)?.status === 403) ? <ForbiddenPage /> : <>
            {page === "dashboard" && <DashboardPage />}
            {page === "users" && <UsersPage />}
            {page === "groups" && <GroupsPage />}
            {(page === "apis" || page === "enforced") && <ApisPage />}
            {page === "organizations" && <OrganizationsPage />}
            {page === "audit" && <AuditPage />}
            {page === "accessreview" && <AccessReviewPage />}
            {page === "recertification" && <RecertificationPage />}
            {page === "backup" && <BackupPage />}
            {page === "settings" && <SettingsPage />}
            {page === "orgadmin" && <OrgAdminPage />}
          </>}
        </div>
      </div>
      <UserDrawer />
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
