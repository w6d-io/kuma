import { useState, useEffect, useMemo, Fragment } from 'react';
import { redirectToLogin } from './auth/loginRedirect';
import { NAV, COLLAPSIBLE, hasAnyPerm, navBlocks, navItemFor, type NavSection } from './nav';
import { AppProvider, useApp } from './contexts/AppContext';
import { useSession, useStats, useRealtime, useUserSearch } from './api/hooks';
import { searchedToUser } from './api/transforms';
import { THEMES, nextTheme, themeLabel } from './theme';
import { Button, ButtonBase, EmptyHint, Segmented, Switch, Toasts, I, cx } from './components/ui';
import { DashboardPage } from './pages/Dashboard';
import { UsersPage, UserDrawer } from './pages/Users';
import { OrgAdminPage } from './pages/OrgAdmin';
import { AccessCheckPage } from './pages/AccessCheck';
import { useMyOrg } from './hooks/useMyOrg';
import { GroupsPage } from './pages/groups/GroupsPage';
import { RolesPage } from './pages/access/RolesPage';
import { SitesPage } from './pages/sites/SitesPage';
import { GatewayPage } from './pages/gateway/GatewayPage';
import { OrganizationsPage } from './pages/Organizations';
import { ApiKeysPage } from './pages/ApiKeys';
import { GrantAccess } from './pages/GrantAccess';
import { AuditPage } from './pages/Audit';
import { AccessReviewPage } from './pages/AccessReview';
import { RecertificationPage } from './pages/Recertification';
import { SettingsPage } from './pages/Settings';
import { BackupPage } from './pages/Backup';
import { DesignPage } from './pages/design/DesignPage';
import { UserMenu } from './components/UserMenu';
import { ApiErrorState } from './components/ApiErrorState';
import * as Dialog from '@radix-ui/react-dialog';

// The "Forbidden" tweak fakes a 403 across the whole app (blanks the UI). It is
// a development aid only — never let it take effect in a production build
// (UX-3). Gate every read through this helper.
const DEV = import.meta.env.DEV;
function simulatingForbidden(tweaks: { simulateForbidden?: boolean } | undefined): boolean {
  return DEV && !!tweaks?.simulateForbidden;
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
        <span aria-hidden="true" className="icon">{I.menu}</span>
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
  const myOrg = useMyOrg();
  const visibleNav = NAV.filter((n) => hasAnyPerm(session?.permissions, n.perms) && (n.id !== "orgadmin" || myOrg.show))
  const blocks = navBlocks(visibleNav)
  const activeId = navItemFor(page)?.id
  const [openSections, setOpenSections] = useState<ReadonlySet<NavSection>>(new Set())
  const toggleSection = (s: NavSection) =>
    setOpenSections(prev => new Set(prev.has(s) ? [...prev].filter(x => x !== s) : [...prev, s]))

  return (
    <>
      <div className="sidebar-header">
        <div className="logo-mark">K</div>
        <div className="logo-text">
          <span className="n">Kuma</span>
          <span className="s">Access console</span>
        </div>
      </div>
      <nav className="nav">
        {isForbidden && (
          <div className="nav-forbidden">
            <span className="icon">{I.shield}</span>
            403 · access denied
          </div>
        )}
        {blocks.map((block, bi) => {
          const folded = block.section && COLLAPSIBLE.has(block.section) && !openSections.has(block.section) && !block.items.some(n => n.id === activeId);
          const afterSection = !block.section && bi > 0 && !!blocks[bi - 1].section;
          return (
            <Fragment key={block.section ?? block.items[0].id}>
              {afterSection && <div className="nav-gap" aria-hidden="true" />}
              {block.section && COLLAPSIBLE.has(block.section) ? (
                <ButtonBase className="nav-section nav-section-toggle" aria-expanded={!folded} onClick={() => toggleSection(block.section!)}>
                  <span className="ico">{folded ? I.caretRight : I.caret}</span>{block.section}
                </ButtonBase>
              ) : block.section && <div className="nav-section">{block.section}</div>}
              {!folded && block.items.map(n => {
                const count =
                  n.id === "users" ? (stats?.total ?? state.users.length) :
                  n.id === "groups" ? Object.keys(state.groups).length :
                  null;
                return (
                  <ButtonBase key={n.id} className={cx("nav-item", activeId === n.id && "active")} aria-current={activeId === n.id ? "page" : undefined} onClick={() => { setPage(n.id); onNavigate?.(); }}>
                    <span className="ico">{n.ico}</span>
                    {n.name}
                    {count != null && showCounts && <span className="count">{count}</span>}
                  </ButtonBase>
                );
              })}
            </Fragment>
          );
        })}
      </nav>
      <div className="sidebar-theme">
        <ButtonBase
          className="theme-btn"
          title={themeLabel(theme)}
          aria-label={themeLabel(theme)}
          onClick={cycleTheme}
        >
          <span className="ico">{theme === "dark" ? I.moon : theme === "light" ? I.sun : I.contrast}</span>
          <span className="lbl">{theme === "system" ? "System theme" : theme === "light" ? "Light" : "Dark"}</span>
        </ButtonBase>
      </div>
      <div className="sidebar-foot">
        <UserMenu
          email={session?.email || "you@console"}
          /* Every role, not the first one alphabetically: holding two, the rail named the weaker. */
          role={(session?.roles ?? []).join(" · ")}
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
  const title = navItemFor(page)?.name || "Console";
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
             (apiError as any)?.status === 401 ? "session expired" :
             (apiError as any)?.status === 503 ? "engine unreachable" : "offline"}
          </span>
        )}
        {showPipe && pipeline.stage !== "idle" && (
          <span className="sync-pill syncing">
            <span className="d" />
            {pipeline.stage}…
          </span>
        )}
        <ButtonBase className="search-trigger" onClick={onOpenCmdk}>
          <span className="icon">{I.search}</span>
          <span>Search or jump to…</span>
          <span className="kbd">⌘K</span>
        </ButtonBase>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={theme === "dark" ? I.moon : theme === "light" ? I.sun : I.contrast}
          title={themeLabel(theme)}
          aria-label={themeLabel(theme)}
          onClick={cycleTheme}
        />
      </div>
      {isForbidden && (
        <div className="viewer-banner danger">
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
  const { setPage, state, setGrant, setUserDrawer, cycleTheme, theme } = useApp();
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
      kind: "user", label: u.name, sub: u.email, run: () => { setUserDrawer({ mode: "edit", user: u }); }
    }));
    const grps = Object.keys(state.groups).filter(match).slice(0, 6).map(g => ({
      kind: "group", label: `Group · ${g}`, sub: "open the group", run: () => { setPage("groups", g); }
    }));
    const sites = state.services.map(sv => sv.name).filter(match).slice(0, 6).map(name => ({
      kind: "service", label: `Roles · ${name}`, sub: "roles & permissions", run: () => { setPage("roles", name); }
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
      { name: "Sites", items: sites },
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
                    <span className="ico">
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

  const Seg = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) => (
    <Segmented label={label} value={value} onChange={onChange} options={options.map(o => ({ value: o.v, label: o.l }))} />
  );

  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <span>Tweaks</span>
        <Button variant="ghost" size="sm" iconOnly icon={I.close} aria-label="Close tweaks" onClick={onClose} />
      </div>
      <div className="tweaks-body">
        <div className="tweak-section">Appearance</div>
        <div className="tweak-row">
          <span className="lbl">Theme</span>
          <Segmented label="Theme" value={theme} onChange={setTheme} options={THEMES.map(t => ({ value: t, label: t }))} />
        </div>
        <div className="tweak-row"><span className="lbl">Accent</span><Seg label="Accent" value={tweaks.accent} onChange={v => setTweak("accent", v)} options={[{ v: "terracotta", l: "Terracotta" }, { v: "indigo", l: "Indigo" }, { v: "slate", l: "Slate" }]} /></div>
        <div className="tweak-row"><span className="lbl">Density</span><Seg label="Density" value={tweaks.density} onChange={v => setTweak("density", v)} options={[{ v: "compact", l: "Compact" }, { v: "comfortable", l: "Comfy" }, { v: "cozy", l: "Cozy" }]} /></div>
        <div className="tweak-section">Console</div>
        <div className="tweak-row"><span className="lbl">Persona</span><Seg label="Persona" value={persona} onChange={setPersona} options={[{ v: "admin", l: "Admin" }, { v: "viewer", l: "Viewer" }]} /></div>
        <div className="tweak-row"><span className="lbl">Collapse nav</span><Switch label="Collapse nav" on={!!tweaks.navCollapsed} onChange={v => setTweak("navCollapsed", v)} /></div>
        <div className="tweak-row"><span className="lbl">Pipeline</span><Switch label="Pipeline" on={!!tweaks.showPipeline} onChange={v => setTweak("showPipeline", v)} /></div>
        <div className="tweak-row"><span className="lbl">Counts</span><Switch label="Counts" on={!!tweaks.showCounts} onChange={v => setTweak("showCounts", v)} /></div>
        {DEV && (
          <div className="tweak-row">
            <span className={cx("lbl", tweaks.simulateForbidden && "text-danger")}>Forbidden <span className="small muted">(dev)</span></span>
            <Switch label="Forbidden (dev)" on={!!tweaks.simulateForbidden} onChange={v => setTweak("simulateForbidden", v)} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The page could not load its data at all: a 403 (a decision) or a 503 (the engine could not be
 * asked). Worded by the shared helper, so "no groups assigned" appears only when it is true.
 */
function BlockedPage() {
  const { apiError, refetch, tweaks } = useApp();
  const error = simulatingForbidden(tweaks) ? { status: 403 } : apiError;
  return (
    <div className="blocked-page">
      <ApiErrorState error={error} onRetry={refetch} />
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
    // An old id with no rail entry of its own inherits the gate of the page that replaced it.
    const nav = navItemFor(page)
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
        {/* Keyed on the page so React remounts the subtree and the entrance plays on every
            navigation. Without the key the class is already applied and nothing animates. */}
        <div className="content page-enter" key={page}>
          {(simulatingForbidden(tweaks) || [403, 503].includes((apiError as any)?.status)) ? <BlockedPage /> : <>
            {page === "dashboard" && <DashboardPage />}
            {page === "users" && <UsersPage />}
            {page === "groups" && <GroupsPage />}
            {page === "roles" && <RolesPage />}
            {page === "sites" && <SitesPage />}
            {page === "gateway" && <GatewayPage />}
            {page === "organizations" && <OrganizationsPage />}
            {page === "apikeys" && <ApiKeysPage />}
            {page === "audit" && <AuditPage />}
            {page === "accessreview" && <AccessReviewPage />}
            {page === "recertification" && <RecertificationPage />}
            {page === "backup" && <BackupPage />}
            {page === "settings" && <SettingsPage />}
            {page === "orgadmin" && <OrgAdminPage />}
            {page === "accesscheck" && <AccessCheckPage />}
            {page === "design" && <DesignPage />}
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
