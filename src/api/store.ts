// Composite RBAC store — assembles the AppState-shaped view from scoped,
// per-entity queries instead of one `['rbac-all']` mega-query mirrored into a
// `useState` copy (PROBLEM-MAP STORE-1/2/3).
//
// Why a composite (not one query per page yet): many views are genuinely
// cross-entity (Dashboard matrix, Groups user-counts, Simulator). Rather than
// thread six hooks through every page, we fold the scoped queries into the
// existing `AppState` shape here — but the underlying cache is per-entity, so:
//   • a group edit invalidates only `['groups']` — users no longer re-stream
//     on every unrelated mutation (kills the PERF-1 full-directory re-walk);
//   • TanStack Query is the single source of truth (no `setState` mirror);
//   • `staleTime` and dedup are per-entity.
import { useEffect, useMemo } from 'react';
import {
  useUsers,
  useGroups,
  useServices,
  useAllRoles,
  useAllRoutes,
} from './hooks';
import type { AppState, GroupsMap, GroupsMetaMap, RolesMap, Service } from './types';

export interface StoreResult {
  state: AppState;
  isLive: boolean;
  isLoading: boolean;
  apiError: Error | null;
}

/**
 * Live-derived RBAC store. Reads from the scoped query cache and folds the
 * results into the `AppState` shape the pages already consume. Nothing is
 * mirrored into React state — this recomputes (memoised) whenever any scoped
 * query updates, so edits surface through the normal cache-invalidation path.
 */
export interface StoreOptions {
  /** When true, stream the whole user directory in the background (pages that
   *  show directory-wide aggregates). When false, keep only page 1 — no mass
   *  fetching on pages that don't need it. */
  fillDirectory?: boolean;
}

export function useStore({ fillDirectory = false }: StoreOptions = {}): StoreResult {
  const usersQ = useUsers();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = usersQ;

  // Background directory fill: after the first page paints, keep pulling the
  // remaining keyset pages so cross-entity views (Dashboard counts, Groups
  // user-counts, Simulator, CmdK) see the whole directory. Only runs on pages
  // that need it (fillDirectory) and only advances a query that is already
  // cached one-time (5-min staleTime) — navigation never re-walks. The infinite
  // query is self-capped at USERS_MAX_PAGES so this can't run away.
  useEffect(() => {
    if (fillDirectory && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [fillDirectory, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const groupsQ = useGroups();
  const servicesQ = useServices();

  const serviceNames = useMemo(
    () => (servicesQ.data ?? []).map(s => s.name),
    [servicesQ.data],
  );

  const rolesQ = useAllRoles(serviceNames);
  const routesQ = useAllRoutes(serviceNames);

  const state = useMemo<AppState>(() => {
    const usersRaw = usersQ.users;
    const groupsRaw = groupsQ.data ?? [];
    const servicesRaw = servicesQ.data ?? [];
    const rolesMap: RolesMap = rolesQ.data ?? {};
    const routeMaps = routesQ.data ?? {};

    // groups → map + metadata side-car
    const groups: GroupsMap = {};
    const groupsMeta: GroupsMetaMap = {};
    for (const g of groupsRaw) {
      groups[g.name] = g.services || {};
      if (g.system || g.description) {
        groupsMeta[g.name] = {
          ...(g.system ? { system: true } : {}),
          ...(g.description ? { description: g.description } : {}),
        };
      }
    }

    // services → UI shape, enriched with role/route counts
    const services: Service[] = servicesRaw.map(s => ({
      name: s.name,
      description: s.description || s.displayName || s.name,
      createdAt: '',
      routes: (routeMaps[s.name]?.length ?? s.routesCount) || 0,
      roles: (rolesMap[s.name] ? Object.keys(rolesMap[s.name]).length : s.rolesCount) || 0,
      ...(s.system ? { system: true } : {}),
    }));

    // Services whose roles/routes FAILED to load (absent from the aggregate map
    // after it settled — the hooks omit a failed service rather than folding it
    // into an empty map). "Unknown", not "empty": the Roles/Routes pages must
    // block a replace-write for these, since a PUT built on a false-empty base
    // would wipe the service's real config. Only meaningful once the aggregate
    // query has succeeded; while loading, treat nothing as errored.
    const rolesErrored = rolesQ.isSuccess
      ? servicesRaw.map(s => s.name).filter(n => !(n in rolesMap))
      : [];
    const routesErrored = routesQ.isSuccess
      ? servicesRaw.map(s => s.name).filter(n => !(n in routeMaps))
      : [];

    return {
      services,
      roles: rolesMap,
      groups,
      groupsMeta,
      users: usersRaw,
      usersLoading: usersQ.usersLoading,
      routeMaps,
      rolesErrored,
      routesErrored,
    };
  }, [usersQ.users, usersQ.usersLoading, groupsQ.data, servicesQ.data, rolesQ.data, rolesQ.isSuccess, routesQ.data, routesQ.isSuccess]);

  // Any admin endpoint (groups/services/users) 401/403s identically when
  // the caller lacks access, so any of them is a valid auth probe. Surface the
  // first error from any critical query.
  const apiError =
    (groupsQ.error ?? servicesQ.error ?? usersQ.error) as Error | null;

  // Gate first paint on the lighter admin queries — NOT on the (potentially
  // large) user directory. This preserves the old fast-first-paint behaviour
  // where the dashboard rendered before the full directory streamed in; the
  // Users list / counts fill in via `usersLoading` once the users query lands.
  const isLoading =
    groupsQ.isLoading || servicesQ.isLoading;

  const isLive =
    groupsQ.isSuccess && servicesQ.isSuccess && !apiError;

  return { state, isLive, isLoading, apiError };
}
