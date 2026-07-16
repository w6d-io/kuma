import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AppState, PageId, TweakDefaults } from '../api/types';
import { useStore } from '../api/store';
import { withOptimism, cachePatch } from '../api/mutations';
import { api } from '../api/client';

const TWEAK_DEFAULTS: TweakDefaults = {
  theme: "light",
  persona: "admin",
  density: "comfortable",
  accent: "terracotta",
  monoFont: "jetbrains",
  showPipeline: true,
  showCounts: true,
  showMotion: true,
  navCollapsed: false,
  matrixColor: true,
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

export interface GroupDrawerState {
  mode: 'edit' | 'create';
  name?: string;
  group?: string;
}

export interface ServiceDrawerState {
  mode: 'create' | 'edit';
  serviceName?: string;
}

// Grant-access wizard. `user` pre-selects a person (row action); omit to open
// on the person-picker step.
export interface GrantState {
  user?: import('../api/types').User;
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
  activeService: string;
  setActiveService: (s: string) => void;
  userDrawer: UserDrawerState | null;
  setUserDrawer: (d: UserDrawerState | null) => void;
  groupDrawer: GroupDrawerState | null;
  setGroupDrawer: (d: GroupDrawerState | null) => void;
  serviceDrawer: ServiceDrawerState | null;
  setServiceDrawer: (d: ServiceDrawerState | null) => void;
  grant: GrantState | null;
  setGrant: (g: GrantState | null) => void;
  pushToast: (msg: string, opts?: { err?: boolean; sub?: string; ttl?: number }) => void;
  toasts: Toast[];
  pipeline: PipelineState;
  theme: string;
  setTheme: (t: string) => void;
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
  apiCreateGroup: (name: string, services: Record<string, string[]>) => Promise<void>;
  apiUpdateGroup: (name: string, services: Record<string, string[]>) => Promise<void>;
  apiDeleteGroup: (name: string) => Promise<void>;
  apiCreateService: (svc: { name: string; displayName?: string; upstreamUrl: string; matchUrl: string; matchMethods: string[]; stripPath?: string }) => Promise<void>;
  apiUpdateService: (name: string, payload: { upstreamUrl?: string; matchUrl?: string; matchMethods?: string[]; stripPath?: string | null }) => Promise<void>;
  apiDeleteService: (name: string) => Promise<void>;
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

// Pages that still stream the whole user directory for per-user views the stats
// endpoint doesn't cover yet: Simulator's user picker and the Services
// workspace's per-service member counts. Dashboard and Groups used to be here
// but now read cached counts from GET /admin/stats (rbacService.getDirectoryStats),
// so they no longer walk the ~10k-identity directory (was ~45s). Users/Audit/
// Settings/etc. were never here. Simulator + Services move to server-side search
// in Phase 2, after which this set can empty out entirely.
const DIRECTORY_PAGES: ReadonlySet<PageId> = new Set<PageId>([
  'services', 'simulator',
]);

const pageFromHash = (): PageId => {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const valid: PageId[] = ['dashboard','simulator','users','groups','services','roles','routes','rules','audit','settings','orgadmin','organizations'];
  return valid.includes(hash as PageId) ? (hash as PageId) : 'dashboard';
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

  const setPage = (p: PageId) => {
    window.location.hash = `/${p}`;
    setPageRaw(p);
  };

  // Keep page in sync when user navigates back/forward
  useEffect(() => {
    const onHashChange = () => setPageRaw(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const [activeService, setActiveService] = useState("jinbe");
  const [userDrawer, setUserDrawer] = useState<UserDrawerState | null>(null);
  const [groupDrawer, setGroupDrawer] = useState<GroupDrawerState | null>(null);
  const [serviceDrawer, setServiceDrawer] = useState<ServiceDrawerState | null>(null);
  const [grant, setGrant] = useState<GrantState | null>(null);

  const [theme, setThemeRaw] = useState(TWEAK_DEFAULTS.theme);
  const [persona, setPersonaRaw] = useState(TWEAK_DEFAULTS.persona);
  const [tweaks, setTweaksRaw] = useState<TweakDefaults>(TWEAK_DEFAULTS);

  const { toasts, push: pushToast } = useToasts();
  const pipeline = usePipeline(pushToast);

  const setTweak = (key: string, val: unknown) => {
    setTweaksRaw(t => ({ ...t, [key]: val }));
  };
  const setTheme = (t: string) => { setThemeRaw(t); setTweak("theme", t); };
  const setPersona = (p: string) => { setPersonaRaw(p); setTweak("persona", p); };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-density", tweaks.density || "comfortable");
    html.setAttribute("data-accent", tweaks.accent || "terracotta");
    html.setAttribute("data-monofont", tweaks.monoFont || "jetbrains");
    html.setAttribute("data-motion", tweaks.showMotion ? "on" : "off");
    html.setAttribute("data-matrixcolor", tweaks.matrixColor ? "on" : "off");
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
  }, [qc]);

  const apiCreateGroup = useCallback(async (name: string, services: Record<string, string[]>) => {
    await withOptimism(qc, [['groups'], ['groups-map']],
      () => cachePatch.upsertGroup(qc, name, services),
      () => api.createGroup({ name, services }));
  }, [qc]);

  const apiUpdateGroup = useCallback(async (name: string, services: Record<string, string[]>) => {
    await withOptimism(qc, [['groups'], ['groups-map']],
      () => cachePatch.upsertGroup(qc, name, services),
      () => api.updateGroup(name, services));
  }, [qc]);

  const apiDeleteGroup = useCallback(async (name: string) => {
    await withOptimism(qc, [['groups'], ['groups-map'], ['users'], ['stats']],
      () => cachePatch.removeGroup(qc, name),
      () => api.deleteGroup(name));
  }, [qc]);

  const apiCreateService = useCallback(async (svc: { name: string; displayName?: string; upstreamUrl: string; matchUrl: string; matchMethods: string[]; stripPath?: string }) => {
    // Create spawns roles/routes/rules server-side; invalidate-only.
    await withOptimism(qc, [['services'], ['access-rules'], ['all-roles'], ['all-routes']],
      undefined, () => api.createService(svc));
  }, [qc]);

  const apiUpdateService = useCallback(async (name: string, payload: { upstreamUrl?: string; matchUrl?: string; matchMethods?: string[]; stripPath?: string | null }) => {
    await withOptimism(qc, [['services'], ['access-rules']],
      () => { if (payload.upstreamUrl !== undefined) cachePatch.updateService(qc, name, { upstreamUrl: payload.upstreamUrl }); },
      () => api.updateService(name, payload));
  }, [qc]);

  const apiDeleteService = useCallback(async (name: string) => {
    await withOptimism(qc, [['services'], ['access-rules'], ['all-roles'], ['all-routes']],
      () => cachePatch.removeService(qc, name),
      () => api.deleteService(name));
  }, [qc]);

  const ctx: AppContextType = {
    state,
    isLive, isLoading, apiError,
    refetch: invalidateAll,
    refreshAudit: invalidateAudit,
    page, setPage,
    activeService, setActiveService,
    userDrawer, setUserDrawer,
    groupDrawer, setGroupDrawer,
    serviceDrawer, setServiceDrawer,
    grant, setGrant,
    pushToast, toasts, pipeline,
    theme, setTheme, persona, setPersona,
    tweaks, setTweak,
    apiSetUserGroups, apiCreateUser, apiDeleteUser, apiSetUserState, apiSetUserMetadata, apiSetUserOrganization, apiSendRecoveryEmail,
    apiCreateGroup, apiUpdateGroup, apiDeleteGroup,
    apiCreateService, apiUpdateService, apiDeleteService,
  };

  return <AppCtx.Provider value={ctx}>{children}</AppCtx.Provider>;
}
