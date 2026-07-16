// Optimistic-mutation helpers (PROBLEM-MAP STORE-4 / Phase C).
//
// The composite store (api/store.ts) reads from scoped per-entity query caches.
// An optimistic write therefore = patch the underlying cache key(s) immediately,
// run the request, and on failure restore the pre-mutation snapshot. The store
// re-derives from whatever the cache holds, so the UI reflects the change with
// zero latency and rubber-bands back cleanly on error.
//
// `withOptimism` is the single primitive every mutation path uses (AppContext
// wrappers, the role/route/rule hooks, and OrgAdmin's local flow via
// `optimisticLocal`). Creates that depend on server-computed fields (ids,
// counts) intentionally pass no `apply` — they just invalidate on success,
// which is the honest behaviour for data we can't predict client-side.

import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Run `request` with an optimistic cache patch and automatic rollback.
 *
 * @param qc     the QueryClient
 * @param keys   cache keys to snapshot / cancel in-flight / invalidate. Prefix
 *               keys are fine (e.g. ['all-roles']) — every matching query is
 *               snapshotted and restored, so aggregate + per-service caches stay
 *               consistent.
 * @param apply  optional optimistic patch. Omit for creates whose server shape
 *               can't be predicted (falls back to invalidate-on-settle).
 * @param request the actual API call.
 */
export async function withOptimism<T>(
  qc: QueryClient,
  keys: readonly QueryKey[],
  apply: (() => void) | undefined,
  request: () => Promise<T>,
): Promise<T> {
  // Stop in-flight refetches so they don't clobber the optimistic patch.
  await Promise.all(keys.map((key) => qc.cancelQueries({ queryKey: key })));

  // Snapshot every matching query (prefix-matched) for rollback.
  const snapshots = keys.map(
    (key) => [key, qc.getQueriesData({ queryKey: key })] as const,
  );

  if (apply) apply();

  try {
    return await request();
  } catch (err) {
    // Roll back to the exact pre-mutation data.
    for (const [, entries] of snapshots) {
      for (const [key, data] of entries) qc.setQueryData(key, data);
    }
    throw err;
  } finally {
    // Reconcile with server truth regardless of outcome.
    for (const key of keys) qc.invalidateQueries({ queryKey: key });
  }
}

// ─── Cache patchers (one per entity shape the store reads) ───────────────────
// Each mutates the cached value for a key via setQueriesData (prefix-matched so
// it catches the signed aggregate keys like ['all-roles', <sig>]).

type GroupsList = { name: string; services: Record<string, string[]>; system?: boolean; description?: string }[];
type GroupsMap = Record<string, Record<string, string[]>>;
type RolesMapCache = Record<string, Record<string, string[]>>;
type RouteMapsCache = Record<string, { method: string; path: string; permission?: string }[]>;
type ServicesList = { name: string; [k: string]: unknown }[];
type AccessRulesList = { id: string; [k: string]: unknown }[];
// Infinite-query cache shape for the directory (['users', <search>]).
type UsersInfinite = {
  pages: { users: { id: string; email: string; groups: string[]; active: boolean; organizationId?: string }[]; nextPageToken?: string }[];
  pageParams: unknown[];
};

/** Patch every matching query's data with `fn`, skipping undefined caches. */
function patch<T>(qc: QueryClient, key: QueryKey, fn: (prev: T) => T) {
  qc.setQueriesData<T>({ queryKey: key }, (prev) => (prev === undefined ? prev : fn(prev)));
}

export const cachePatch = {
  upsertGroup(qc: QueryClient, name: string, services: Record<string, string[]>) {
    patch<GroupsList>(qc, ['groups'], (list) => {
      const i = list.findIndex((g) => g.name === name);
      if (i === -1) return [...list, { name, services }];
      const next = [...list];
      next[i] = { ...next[i], services };
      return next;
    });
    patch<GroupsMap>(qc, ['groups-map'], (m) => ({ ...m, [name]: services }));
  },
  removeGroup(qc: QueryClient, name: string) {
    patch<GroupsList>(qc, ['groups'], (list) => list.filter((g) => g.name !== name));
    patch<GroupsMap>(qc, ['groups-map'], (m) => {
      const next = { ...m };
      delete next[name];
      return next;
    });
  },
  setServiceRoles(qc: QueryClient, svc: string, roles: Record<string, string[]>) {
    patch<RolesMapCache>(qc, ['all-roles'], (m) => ({ ...m, [svc]: roles }));
  },
  setServiceRoutes(qc: QueryClient, svc: string, routes: RouteMapsCache[string]) {
    patch<RouteMapsCache>(qc, ['all-routes'], (m) => ({ ...m, [svc]: routes }));
  },
  updateService(qc: QueryClient, name: string, fields: Record<string, unknown>) {
    patch<ServicesList>(qc, ['services'], (list) =>
      list.map((s) => (s.name === name ? { ...s, ...fields } : s)),
    );
  },
  removeService(qc: QueryClient, name: string) {
    patch<ServicesList>(qc, ['services'], (list) => list.filter((s) => s.name !== name));
  },
  updateAccessRule(qc: QueryClient, id: string, fields: Record<string, unknown>) {
    patch<AccessRulesList>(qc, ['access-rules'], (list) =>
      list.map((r) => (r.id === id ? { ...r, ...fields } : r)),
    );
  },
  // Directory is an infinite query keyed ['users', <search>]; patch the matching
  // user across whatever pages are loaded. Prefix-matched so it hits every
  // search variant currently cached.
  patchUser(qc: QueryClient, userId: string, fields: Partial<UsersInfinite['pages'][number]['users'][number]>) {
    patch<UsersInfinite>(qc, ['users'], (data) => ({
      ...data,
      pages: data.pages.map((pg) => ({
        ...pg,
        users: pg.users.map((u) => (u.id === userId ? { ...u, ...fields } : u)),
      })),
    }));
  },
  patchUserGroupsByEmail(qc: QueryClient, email: string, groups: string[]) {
    patch<UsersInfinite>(qc, ['users'], (data) => ({
      ...data,
      pages: data.pages.map((pg) => ({
        ...pg,
        users: pg.users.map((u) => (u.email === email ? { ...u, groups } : u)),
      })),
    }));
  },
  removeUser(qc: QueryClient, userId: string) {
    patch<UsersInfinite>(qc, ['users'], (data) => ({
      ...data,
      pages: data.pages.map((pg) => ({
        ...pg,
        users: pg.users.filter((u) => u.id !== userId),
      })),
    }));
  },
};
