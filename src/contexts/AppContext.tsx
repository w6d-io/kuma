import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { AppState, PageId, AuditEvent, User, TweakDefaults } from '../api/types';
import { useRbacData, useInvalidateRbac } from '../api/useRbacData';
import { api } from '../api/client';
import { SEED } from '../seed';

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
  mode: 'edit' | 'assign';
  user?: User;
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

interface AppContextType {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  audit: AuditEvent[];
  setAudit: React.Dispatch<React.SetStateAction<AuditEvent[]>>;
  isLive: boolean;
  isLoading: boolean;
  refetch: () => void;
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
  apiCreateGroup: (name: string, services: Record<string, string[]>) => Promise<void>;
  apiUpdateGroup: (name: string, services: Record<string, string[]>) => Promise<void>;
  apiDeleteGroup: (name: string) => Promise<void>;
  apiCreateService: (svc: { name: string; upstreamUrl: string; matchUrl: string; matchMethods: string[] }) => Promise<void>;
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  // Live data from jinbe (falls back to SEED)
  const { data: liveData, isSuccess, isLoading, error } = useRbacData();
  const invalidateRbac = useInvalidateRbac();

  const [state, setState] = useState<AppState>(SEED);
  const [page, setPage] = useState<PageId>("dashboard");
  const [activeService, setActiveService] = useState("jinbe");
  const [userDrawer, setUserDrawer] = useState<UserDrawerState | null>(null);
  const [groupDrawer, setGroupDrawer] = useState<GroupDrawerState | null>(null);
  const [serviceDrawer, setServiceDrawer] = useState<ServiceDrawerState | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);

  // Sync live data into state when it arrives
  useEffect(() => {
    console.log('[AppContext] liveData changed:', { isSuccess, isLoading, hasError: !!error, hasData: !!liveData, userCount: liveData?.users?.length });
    if (liveData && liveData.users.length > 0) {
      setState(liveData);
      if (liveData.audit.length > 0) {
        setAudit(liveData.audit);
      }
    }
  }, [liveData, isSuccess, isLoading, error]);

  const isLive = isSuccess && !error;

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

  // ─── Live API mutations (call jinbe, then refetch) ───

  const apiSetUserGroups = useCallback(async (email: string, groups: string[]) => {
    await api.setUserGroups(email, groups);
    invalidateRbac();
  }, [invalidateRbac]);

  const apiCreateGroup = useCallback(async (name: string, services: Record<string, string[]>) => {
    await api.createGroup({ name, services });
    invalidateRbac();
  }, [invalidateRbac]);

  const apiUpdateGroup = useCallback(async (name: string, services: Record<string, string[]>) => {
    await api.updateGroup(name, services);
    invalidateRbac();
  }, [invalidateRbac]);

  const apiDeleteGroup = useCallback(async (name: string) => {
    await api.deleteGroup(name);
    invalidateRbac();
  }, [invalidateRbac]);

  const apiCreateService = useCallback(async (svc: { name: string; upstreamUrl: string; matchUrl: string; matchMethods: string[] }) => {
    await api.createService(svc);
    invalidateRbac();
  }, [invalidateRbac]);

  const ctx: AppContextType = {
    state, setState,
    audit, setAudit,
    isLive, isLoading,
    refetch: invalidateRbac,
    page, setPage,
    activeService, setActiveService,
    userDrawer, setUserDrawer,
    groupDrawer, setGroupDrawer,
    serviceDrawer, setServiceDrawer,
    pushToast, toasts, pipeline,
    theme, setTheme, persona, setPersona,
    tweaks, setTweak,
    apiSetUserGroups, apiCreateGroup, apiUpdateGroup, apiDeleteGroup, apiCreateService,
  };

  return <AppCtx.Provider value={ctx}>{children}</AppCtx.Provider>;
}
