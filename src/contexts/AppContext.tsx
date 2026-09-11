import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AppState, PageId, TweakDefaults } from '../api/types';
import { PAGE_IDS } from '../api/types';
import { useStore } from '../api/store';
import { withOptimism, cachePatch } from '../api/mutations';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ui/Primitives';
import { applyTheme, nextTheme, storeTheme, storedTheme, type Theme } from '../theme';

const TWEAK_DEFAULTS: TweakDefaults = {
  persona: "admin",
  density: "comfortable",
  accent: "terracotta",
  monoFont: "jetbrains",
  showPipeline: true,
  showCounts: true,
  showMotion: true,
  navCollapsed: false,
  levelStyle: "bars",
  wildcardWarn: true,
  simulateForbidden: false,
};

interface Toast {
  id: string;
  msg: string;
  err?: boolean;
  sub?: string;
}

interface PipelineState {
  stage: string;
  run: (summary?: string) => void;
}

export interface UserDrawerState {
  mode: 'edit' | 'create';
  user?: import('../api/types').User;
}

// Grant-access wizard. `user` pre-selects a person (row action); omit to open
// on the person-picker step.
export interface GrantState {
  user?: import('../api/types').User;
}

// Cross-surface deep-link intent into the Audit page. A card on another surface
// (Dashboard "Signals", a hero "Review" that crossed a page) sets it; the Audit
// page consumes it once on mount, then clears it.
export interface AuditFocus {
  tab?: 'changes' | 'access' | 'auth' | 'signals';
  eventId?: string;
}

interface AppContextType {
  state: AppState;
  isLive: boolean;
  isLoading: boolean;
  apiError: Error | null;
  refetch: () => void;
  refreshAudit: () => void;
  page: PageId;
  setPage: (page: PageId) => void;
  /**
   * Register (or clear, with `null`) a predicate that reports whether the
   * current surface has unsaved changes. `setPage`, direct
   * hash navigation and tab-close all consult it and prompt before discarding.
   * A component registers on mount and clears on unmount.
   */
  registerUnsavedGuard: (fn: (() => boolean) | null) => void;
  userDrawer: UserDrawerState | null;
  setUserDrawer: (d: UserDrawerState | null) => void;
  grant: GrantState | null;
  setGrant: (g: GrantState | null) => void;
  auditFocus: AuditFocus | null;
  setAuditFocus: (f: AuditFocus | null) => void;
  pushToast: (msg: string, opts?: { err?: boolean; sub?: string; ttl?: number }) => void;
  toasts: Toast[];
  pipeline: PipelineState;
  theme: Theme;
  setTheme: (t: Theme) => void;
  cycleTheme: () => void;
  persona: string;
  setPersona: (p: string) => void;
  tweaks: TweakDefaults;
  setTweak: (key: string, val: unknown) => void;
  // Live API mutations
  apiSetUserGroups: (email: string, groups: string[]) => Promise<void>;
  apiCreateUser: (payload: { email: string; name: string; groups?: string[]; sendInvite?: boolean }) => Promise<void>;
  apiDeleteUser: (id: string) => Promise<void>;
  apiSendRecoveryEmail: (id: string) => Promise<void>;
  apiSetUserState: (id: string, state: 'active' | 'inactive') => Promise<void>;
  apiSetUserMetadata: (id: string, metadata: Record<string, unknown>) => Promise<void>;
  apiSetUserOrganization: (id: string, organizationId: string | undefined) => Promise<void>;
  /**
   * Replace a user's ADDITIONAL org memberships (`metadata_admin.organizations`).
   * Writes through the merge-patch metadata endpoint, which preserves groups
   * (it 422s any group change) and fires jinbe's OPA/OPAL bindings refresh.
   * Errors bubble so the drawer can surface why and keep the drafted list.
   */
  apiSetUserOrganizations: (id: string, organizations: string[]) => Promise<void>;
}

const AppCtx = createContext<AppContextType | null>(null);

export function useApp(): AppContextType {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, opts: { err?: boolean; sub?: string; ttl?: number } = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, ...opts }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), opts.ttl || 3000);
  }, []);
  return { toasts, push };
}

function usePipeline(pushToast: (msg: string, opts?: { sub?: string }) => void): PipelineState {
  const [stage, setStage] = useState("idle");
  const run = useCallback((summary?: string) => {
    const seq = ["config", "opal", "opa", "oathkeeper"];
    setStage(seq[0]);
    seq.forEach((s, i) => {
      setTimeout(() => setStage(s), (i + 1) * 240);
    });
    setTimeout(() => {
      setStage("idle");
      pushToast(`Applied · ${summary || "change"}`, { sub: "synced through Oathkeeper" });
    }, (seq.length + 1) * 240);
  }, [pushToast]);
  return { stage, run };
}

// Every entity key the composite store reads. `refetch()` (e.g. after a bundle
// import that rewrites everything) invalidates all of them; individual
// mutations invalidate only the keys they touch (STORE-3).
const ALL_ENTITY_KEYS = [
  ['users'], ['groups'], ['groups-map'], ['services'],
  ['all-roles'], ['all-routes'], ['access-rules'], ['audit'],
] as const;

// No page streams the whole user directory anymore. Every aggregate (Dashboard,
// Groups, Services per-service counts) reads cached counts from GET /admin/stats,
// and every user lookup (Users, Grant wizard, Simulator) uses server-side search
// (GET /admin/users/search). The store keeps only page 1 of users for incidental
// consumers (e.g. CmdK quick-jump). Kept as an explicit empty set so the store's
// fillDirectory contract stays visible.
const DIRECTORY_PAGES: ReadonlySet<PageId> = new Set<PageId>();

const pageFromHash = (): PageId => {
  const hash = window.location.hash.replace(/^#\/?/, '');
  // PAGE_IDS is the same array PageId is derived from — a page added to the
  // type is automatically routable (a hand-copied list here once missed one).
  return (PAGE_IDS as readonly string[]).includes(hash) ? (hash as PageId) : 'dashboard';
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();

  // Hash-based routing: read initial page from URL hash (#/page). Computed
  // before the store so we can tell it whether this page needs the directory.
  const [page, setPageRaw] = useState<PageId>(pageFromHash);

  // Single source of truth: the composite store folds the scoped per-entity
  // queries into the AppState shape. No `useState` mirror (STORE-1). The
  // directory only streams in on pages that show directory-wide aggregates.
  const { state, isLive, isLoading, apiError } = useStore({
    fillDirectory: DIRECTORY_PAGES.has(page),
  });

  const invalidateKeys = useCallback((keys: readonly (readonly string[])[]) => {
    for (const key of keys) qc.invalidateQueries({ queryKey: key as string[] });
  }, [qc]);

  const invalidateAll = useCallback(() => {
    invalidateKeys(ALL_ENTITY_KEYS);
  }, [invalidateKeys]);

  // After any mutation jinbe emits an authoritative audit event; refresh only
  // the audit stream (entity invalidation is scoped per-mutation, STORE-3).
  const invalidateAudit = useCallback(() => {
    invalidateKeys([['audit']]);
  }, [invalidateKeys]);

  // ─── Unsaved-changes guard (P1-6) ───────────────────────────────────────
  // A single registered predicate reports whether the active surface (today: the
  // gateway rule editor) holds unsaved edits. Every navigation path consults it:
  // setPage (hash), raw hash changes
  // (back/forward, typed URL — these bypass setPage) and tab close. When dirty,
  // the navigation is deferred behind one shared ConfirmDialog.
  const unsavedGuard = useRef<(() => boolean) | null>(null);
  const registerUnsavedGuard = useCallback((fn: (() => boolean) | null) => { unsavedGuard.current = fn; }, []);
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(null);
  const internalNav = useRef(false);   // a hash change we initiated (already vetted)
  const suppressRevert = useRef(false); // a hash change that is our own revert

  const commitPage = useCallback((p: PageId) => {
    internalNav.current = true;
    window.location.hash = `/${p}`;
    setPageRaw(p);
  }, []);

  // Run `action` now, or, if the guard reports unsaved changes, hold it behind
  // the confirm dialog.
  const guardedNavigate = useCallback((action: () => void) => {
    const g = unsavedGuard.current;
    if (g && g()) setPendingNav({ run: action });
    else action();
  }, []);

  const setPage = useCallback((p: PageId) => {
    if (p === page) { commitPage(p); return; }
    guardedNavigate(() => commitPage(p));
  }, [page, guardedNavigate, commitPage]);

  const confirmPendingNav = useCallback(() => {
    const nav = pendingNav;
    // The guarded surface is being discarded — drop its predicate so the pending
    // action itself can't re-trigger the prompt mid-transition.
    unsavedGuard.current = null;
    setPendingNav(null);
    nav?.run();
  }, [pendingNav]);

  // Keep page in sync when the user navigates via the hash directly (back/forward
  // or a typed URL) — these bypass setPage, so the guard is enforced here too.
  useEffect(() => {
    const onHashChange = () => {
      if (internalNav.current) { internalNav.current = false; setPageRaw(pageFromHash()); return; }
      if (suppressRevert.current) { suppressRevert.current = false; return; }
      const next = pageFromHash();
      if (next === page) return;
      const g = unsavedGuard.current;
      if (g && g()) {
        // Put the URL back where it was, then prompt; navigate only on confirm.
        suppressRevert.current = true;
        window.location.hash = `/${page}`;
        setPendingNav({ run: () => commitPage(next) });
      } else {
        setPageRaw(next);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [page, commitPage]);

  // Native tab-close / reload prompt when there are unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const g = unsavedGuard.current;
      if (g && g()) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const [userDrawer, setUserDrawer] = useState<UserDrawerState | null>(null);
  const [grant, setGrant] = useState<GrantState | null>(null);
  const [auditFocus, setAuditFocus] = useState<AuditFocus | null>(null);

  const [theme, setThemeRaw] = useState<Theme>(storedTheme());
  const [persona, setPersonaRaw] = useState(TWEAK_DEFAULTS.persona);
  const [tweaks, setTweaksRaw] = useState<TweakDefaults>(TWEAK_DEFAULTS);

  const { toasts, push: pushToast } = useToasts();
  const pipeline = usePipeline(pushToast);

  const setTweak = (key: string, val: unknown) => {
    setTweaksRaw(t => ({ ...t, [key]: val }));
  };
  const setTheme = useCallback((t: Theme) => {
    setThemeRaw(t);
    storeTheme(t);
    applyTheme(t);
  }, []);
  /** The rail's button: the same setting, reached in one click. */
  const cycleTheme = useCallback(() => setTheme(nextTheme(theme)), [theme, setTheme]);
  const setPersona = (p: string) => { setPersonaRaw(p); setTweak("persona", p); };

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-density", tweaks.density || "comfortable");
    html.setAttribute("data-accent", tweaks.accent || "terracotta");
    html.setAttribute("data-monofont", tweaks.monoFont || "jetbrains");
    html.setAttribute("data-motion", tweaks.showMotion ? "on" : "off");
    html.setAttribute("data-levelstyle", tweaks.levelStyle || "bars");
    html.setAttribute("data-navcollapsed", tweaks.navCollapsed ? "on" : "off");
  }, [tweaks]);

  // ─── Live API mutations: optimistic cache patch + rollback (STORE-4) ───
  // Predictable edits patch the cache immediately (instant UI, rubber-band on
  // error via withOptimism). Creates whose server shape we can't predict (ids,
  // counts) pass no `apply` — they just invalidate on settle (honest: we don't
  // fabricate the row). Scoped keys keep unrelated data from re-streaming
  // (PERF-1/STORE-3).

  const apiSetUserGroups = useCallback(async (email: string, groups: string[]) => {
    await withOptimism(qc, [['users'], ['groups-map'], ['stats']],
      () => cachePatch.patchUserGroupsByEmail(qc, email, groups),
      () => api.setUserGroups(email, groups));
  }, [qc]);

  const apiCreateUser = useCallback(async (payload: { email: string; name: string; groups?: string[]; sendInvite?: boolean }) => {
    // Create → server assigns the id; invalidate-only (no fabricated row).
    await withOptimism(qc, [['users'], ['stats']], undefined, () => api.createUser(payload));
  }, [qc]);

  const apiDeleteUser = useCallback(async (id: string) => {
    await withOptimism(qc, [['users'], ['stats']],
      () => cachePatch.removeUser(qc, id),
      () => api.deleteUser(id));
  }, [qc]);

  const apiSendRecoveryEmail = useCallback(async (id: string) => {
    // No cache impact — pure side effect.
    await api.sendRecoveryEmail(id);
  }, []);

  const apiSetUserState = useCallback(async (id: string, state: 'active' | 'inactive') => {
    await withOptimism(qc, [['users'], ['stats']],
      () => cachePatch.patchUser(qc, id, { active: state === 'active' }),
      () => api.setUserState(id, state));
  }, [qc]);

  const apiSetUserMetadata = useCallback(async (id: string, metadata: Record<string, unknown>) => {
    await withOptimism(qc, [['users']], undefined, () => api.setUserMetadata(id, metadata));
  }, [qc]);

  const apiSetUserOrganization = useCallback(async (id: string, organizationId: string | undefined) => {
    await withOptimism(qc, [['users'], ['stats']],
      () => cachePatch.patchUser(qc, id, { organizationId }),
      () => api.setUserOrganization(id, organizationId));
    qc.invalidateQueries({ queryKey: ['user-identity', id] });
  }, [qc]);

  const apiSetUserOrganizations = useCallback(async (id: string, organizations: string[]) => {
    // Multi-org membership has no dedicated jinbe writer; the metadata merge-PATCH
    // carries it (and refuses group changes, so this is not an escalation path).
    // Optimistically patch the directory row's org list, then reconcile the
    // authoritative identity + directory counts.
    await withOptimism(qc, [['users'], ['stats']],
      () => cachePatch.patchUser(qc, id, { organizations }),
      () => api.setUserMetadata(id, { organizations }));
    qc.invalidateQueries({ queryKey: ['user-identity', id] });
  }, [qc]);

  const ctx: AppContextType = {
    state,
    isLive, isLoading, apiError,
    refetch: invalidateAll,
    refreshAudit: invalidateAudit,
    page, setPage,
    registerUnsavedGuard,
    userDrawer, setUserDrawer,
    grant, setGrant,
    auditFocus, setAuditFocus,
    pushToast, toasts, pipeline,
    theme, setTheme, cycleTheme, persona, setPersona,
    tweaks, setTweak,
    apiSetUserGroups, apiCreateUser, apiDeleteUser, apiSetUserState, apiSetUserMetadata, apiSetUserOrganization, apiSetUserOrganizations, apiSendRecoveryEmail,
  };

  return (
    <AppCtx.Provider value={ctx}>
      {children}
      <ConfirmDialog
        open={pendingNav !== null}
        title="Discard unsaved changes?"
        danger
        confirmLabel="Discard changes"
        body="You have unsaved changes here. Leaving now will discard them."
        onCancel={() => setPendingNav(null)}
        onConfirm={confirmPendingNav}
      />
    </AppCtx.Provider>
  );
}
