import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './client';
import type { RolesMap, RouteMapsMap, AuditEvent, User } from './types';
import { kratosToUser, jinbeGroupsToMap, jinbeRuleToUi, fetchAuditEvents } from './transforms';
import { cachePatch } from './mutations';

// Directory page size. 100 (not the old 1000) keeps each round trip — and the
// per-identity RBAC enrichment jinbe does per row (PERF-2) — bounded, so the
// first page paints fast and the rest stream lazily.
const USERS_PAGE_SIZE = 100;
// Runaway guard: never walk more than this many pages in the background
// (matches the old eager-walk cap). 100 × 100 = 100k identities.
const USERS_MAX_PAGES = 100;
// The directory is expensive to assemble (keyset walk + per-row RBAC enrichment
// server-side). Treat it as effectively static for the session: fetch ONCE,
// keep it fresh for 5 min, and never re-walk just because the user navigated
// between pages. Mutations invalidate ['users'] explicitly when it must refresh.
const DIRECTORY_STALE_TIME = 5 * 60_000;

// RBAC config (groups/services/roles/routes/rules) is effectively static within
// a session and only changes through mutations we invalidate explicitly, so a
// long staleTime avoids needless background refetches (PERF-5). Audit is a live
// stream and keeps the shorter global default (30s from main.tsx).
const CONFIG_STALE_TIME = 5 * 60_000;

// Transforms (jinbe API shape → Kuma UI shape) live in ./transforms — the
// single source of truth. See PROBLEM-MAP STORE-6 for why they were merged.
//
// These are the scoped, per-entity query hooks that pages consume directly
// (PROBLEM-MAP STORE-2). Query keys are the canonical cache identity; scoped
// mutations invalidate only the keys they touch (STORE-3). Default staleTime
// (30s) comes from the QueryClient in main.tsx; overridden per hook where the
// data is effectively static within a session.

// ─── Query hooks ───

/**
 * Directory as a keyset-paginated infinite query (PERF-1/PERF-3). Replaces the
 * old eager 100-page walk. `search` is an exact email match server-side
 * (credentials_identifier / J9); name search is a client filter over loaded
 * pages (see useUsers). Unrelated mutations no longer re-walk the directory
 * because the query key is stable and invalidation is scoped (STORE-3).
 */
export function useUsersInfinite(search?: string) {
  return useInfiniteQuery({
    queryKey: ['users', search ?? ''],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const { data, nextPageToken } = await api.getUsersPage(pageParam, USERS_PAGE_SIZE, search);
      return { users: data.map(kratosToUser), nextPageToken };
    },
    initialPageParam: undefined as string | undefined,
    // Stop advancing past the runaway cap even if the server keeps handing out
    // tokens, so the background fill can never turn into an unbounded walk.
    getNextPageParam: (last, pages) =>
      pages.length >= USERS_MAX_PAGES ? undefined : last.nextPageToken,
    // Fetch once per session window; navigation between pages reuses the cache
    // instead of re-walking the directory (the core "no mass fetching" fix).
    staleTime: DIRECTORY_STALE_TIME,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Flattened directory view for consumers that want a plain `User[]` (the
 * composite store, Dashboard, Groups, Simulator, CmdK). Shares the SAME cache
 * entry as useUsersInfinite (identical key), so there is no duplicate fetch.
 * `count` grows as background pages land; `isComplete` flips when the keyset is
 * exhausted; `usersLoading` mirrors the old "N+ / loading more…" affordance.
 */
export function useUsers(search?: string) {
  const q = useUsersInfinite(search);
  const users = useMemo<User[]>(
    () => (q.data?.pages ?? []).flatMap((p) => p.users),
    [q.data],
  );
  return {
    ...q,
    users,
    count: users.length,
    isComplete: !q.hasNextPage,
    // "loading more" once the first page is in but the keyset isn't exhausted.
    usersLoading: q.isLoading || q.isFetchingNextPage || (!!q.hasNextPage && q.isSuccess),
  };
}

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => api.getGroups(),
    staleTime: CONFIG_STALE_TIME,
  });
}

export function useGroupsMap() {
  return useQuery({
    queryKey: ['groups-map'],
    queryFn: async () => {
      const groups = await api.getGroups();
      return jinbeGroupsToMap(groups);
    },
    staleTime: CONFIG_STALE_TIME,
  });
}

export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: () => api.getServices(),
    staleTime: CONFIG_STALE_TIME,
  });
}

// Per-service permission catalog (used by the role editor's picker). Cached
// per service instead of an uncached useEffect fetch on every switch (PERF-4).
export function useServicePermissions(serviceName: string) {
  return useQuery({
    queryKey: ['service-permissions', serviceName],
    queryFn: () => api.getServicePermissions(serviceName).then(r => r.permissions),
    enabled: !!serviceName,
    staleTime: CONFIG_STALE_TIME,
  });
}

// Org → service map (Settings). Cached instead of a per-mount fetch (PERF-4).
export function useOrgServiceMap() {
  return useQuery({
    queryKey: ['org-service-map'],
    queryFn: () => api.getOrgServiceMap(),
    staleTime: CONFIG_STALE_TIME,
  });
}

type OrgServiceMapCache = Record<string, string>;

export function useSetOrgServiceMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ organizationId, serviceName }: { organizationId: string; serviceName: string }) =>
      api.setOrgServiceMapping(organizationId, serviceName),
    onMutate: async ({ organizationId, serviceName }) => {
      await qc.cancelQueries({ queryKey: ['org-service-map'] });
      const snapshot = qc.getQueryData<OrgServiceMapCache>(['org-service-map']);
      qc.setQueryData<OrgServiceMapCache>(['org-service-map'], (m) => ({ ...(m ?? {}), [organizationId]: serviceName }));
      return { snapshot };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(['org-service-map'], ctx?.snapshot),
    onSettled: () => qc.invalidateQueries({ queryKey: ['org-service-map'] }),
  });
}

export function useDeleteOrgServiceMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string) => api.deleteOrgServiceMapping(organizationId),
    onMutate: async (organizationId) => {
      await qc.cancelQueries({ queryKey: ['org-service-map'] });
      const snapshot = qc.getQueryData<OrgServiceMapCache>(['org-service-map']);
      qc.setQueryData<OrgServiceMapCache>(['org-service-map'], (m) => {
        if (!m) return m;
        const next = { ...m };
        delete next[organizationId];
        return next;
      });
      return { snapshot };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(['org-service-map'], ctx?.snapshot),
    onSettled: () => qc.invalidateQueries({ queryKey: ['org-service-map'] }),
  });
}

export function useAllRoles(serviceNames: string[]) {
  // Stable key: a single sorted, joined token rather than spreading the array
  // into the key. Spreading made the key change on service reordering, busting
  // the cache on every render (PROBLEM-MAP PERF-6). The service list drives the
  // fetch inside queryFn; a sorted signature keeps the identity stable.
  const signature = [...serviceNames].sort().join(',');
  return useQuery({
    queryKey: ['all-roles', signature],
    staleTime: CONFIG_STALE_TIME,
    queryFn: async (): Promise<RolesMap> => {
      const results = await Promise.all(
        serviceNames.map(async name => {
          try {
            const { roles } = await api.getRoles(name);
            const map: Record<string, string[]> = {};
            for (const r of roles) map[r.name] = r.permissions;
            return { name, map };
          } catch {
            return { name, map: {} };
          }
        })
      );
      const rolesMap: RolesMap = {};
      for (const r of results) rolesMap[r.name] = r.map;
      return rolesMap;
    },
    enabled: serviceNames.length > 0,
  });
}

export function useAllRoutes(serviceNames: string[]) {
  // Stable key (same rationale as useAllRoles/PERF-6): a sorted signature, not
  // the spread array. Fetches every service's route_map in parallel and folds
  // them into a { service → RouteEntry[] } map for the composite store.
  const signature = [...serviceNames].sort().join(',');
  return useQuery({
    queryKey: ['all-routes', signature],
    staleTime: CONFIG_STALE_TIME,
    queryFn: async (): Promise<RouteMapsMap> => {
      const results = await Promise.all(
        serviceNames.map(async name => {
          try {
            const { rules } = await api.getServiceRoutes(name);
            return { name, rules: rules || [] };
          } catch {
            return { name, rules: [] };
          }
        })
      );
      const map: RouteMapsMap = {};
      for (const r of results) map[r.name] = r.rules;
      return map;
    },
    enabled: serviceNames.length > 0,
  });
}

export function useAccessRules() {
  return useQuery({
    queryKey: ['access-rules'],
    queryFn: async () => {
      const rules = await api.getAccessRules();
      return rules.map(jinbeRuleToUi);
    },
    staleTime: CONFIG_STALE_TIME,
  });
}

export function useAudit() {
  return useQuery<AuditEvent[]>({
    queryKey: ['audit'],
    queryFn: () => fetchAuditEvents(api),
  });
}

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api.session(),
    retry: false,
  });
}

// ─── Mutation hooks ───
// User/group/service mutations live in AppContext (optimistic wrappers); the
// hooks below cover config edits pages call directly + delegated org-admin.

// These three edit RBAC config the composite store reads via aggregate keys
// (['all-roles']/['all-routes']/['access-rules']). They use TanStack's native
// onMutate/onError/onSettled optimism: snapshot → patch → rollback on error →
// invalidate on settle (STORE-4). They invalidate BOTH the per-service key
// (pages using the scoped hook directly) and the aggregate key (the store).

export function useUpdateServiceRoutes(serviceName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rules: { method: string; path: string; permission?: string }[]) =>
      api.updateServiceRoutes(serviceName, rules),
    onMutate: async (rules) => {
      const keys = [['routes', serviceName], ['all-routes']];
      await Promise.all(keys.map((k) => qc.cancelQueries({ queryKey: k })));
      const snapshot = keys.map((k) => [k, qc.getQueriesData({ queryKey: k })] as const);
      cachePatch.setServiceRoutes(qc, serviceName, rules);
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      for (const [, entries] of ctx?.snapshot ?? []) {
        for (const [key, data] of entries) qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['routes', serviceName] });
      qc.invalidateQueries({ queryKey: ['all-routes'] });
    },
  });
}

export function useUpdateAccessRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rule }: { id: string; rule: import('./client').JinbeAccessRule }) =>
      api.updateAccessRule(id, rule),
    onSettled: () => qc.invalidateQueries({ queryKey: ['access-rules'] }),
  });
}

export function useUpdateServiceRoles(serviceName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roles: Record<string, string[]>) => api.updateServiceRoles(serviceName, roles),
    onMutate: async (roles) => {
      const keys = [['roles', serviceName], ['all-roles']];
      await Promise.all(keys.map((k) => qc.cancelQueries({ queryKey: k })));
      const snapshot = keys.map((k) => [k, qc.getQueriesData({ queryKey: k })] as const);
      cachePatch.setServiceRoles(qc, serviceName, roles);
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      for (const [, entries] of ctx?.snapshot ?? []) {
        for (const [key, data] of entries) qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['roles', serviceName] });
      qc.invalidateQueries({ queryKey: ['all-roles'] });
    },
  });
}

// ─── Delegated org-admin (self-service; scoped to the caller's orgs) ─────────
// Newest routes (feat/org-admin-tab). These wire the OrgAdmin page into the
// same query-cache + optimistic-mutation model as the rest of the console,
// replacing its ad-hoc local useState/Promise flow.

export function useMyOrganizations() {
  return useQuery({
    queryKey: ['my-orgs'],
    queryFn: () => api.myOrganizations(),
    staleTime: CONFIG_STALE_TIME,
  });
}

export function useAssignableGroups(orgId: string) {
  return useQuery({
    queryKey: ['assignable-groups', orgId],
    queryFn: () => api.getAssignableGroups(orgId),
    enabled: !!orgId,
    staleTime: CONFIG_STALE_TIME,
  });
}

// Org-scoped user list. `search` is an exact email match (credentials_identifier)
// like the global directory (J9). Keyed by org + search so switching orgs or
// searching doesn't clobber the other's cache.
export function useOrgUsers(orgId: string, search?: string) {
  return useQuery({
    queryKey: ['org-users', orgId, search ?? ''],
    queryFn: () => api.getOrgUsers(orgId, { search: search || undefined }),
    enabled: !!orgId,
  });
}

type OrgUsersCache = { data: { id: string; metadata_admin?: { groups?: string[] } }[]; total: number };

export function useCreateOrgUser(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; name?: string; sendInvite?: boolean; groups?: string[] }) =>
      api.createOrgUser(orgId, payload),
    // Server assigns the identity id → invalidate-only (no fabricated row).
    onSettled: () => qc.invalidateQueries({ queryKey: ['org-users', orgId] }),
  });
}

export function useSetOrgUserGroups(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, groups }: { userId: string; groups: string[] }) =>
      api.setOrgUserGroups(orgId, userId, groups),
    onMutate: async ({ userId, groups }) => {
      const key = ['org-users', orgId];
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueriesData({ queryKey: key });
      qc.setQueriesData<OrgUsersCache>({ queryKey: key }, (prev) =>
        prev === undefined ? prev : {
          ...prev,
          data: prev.data.map((u) =>
            u.id === userId
              ? { ...u, metadata_admin: { ...u.metadata_admin, groups } }
              : u,
          ),
        },
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['org-users', orgId] }),
  });
}
