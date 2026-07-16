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
  useAccessRules,
  useAudit,
} from './hooks';
import type { AppState, GroupsMap, GroupsMetaMap, RolesMap, Service } from './types';

const EMPTY_META = { jinbeApi: '/api', opalServer: '', kratosAdmin: '', lastSync: '' };

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
export function useStore(): StoreResult {
  const usersQ = useUsers();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = usersQ;

  // Background directory fill: after the first page paints, keep pulling the
  // remaining keyset pages so cross-entity views (Dashboard counts, Groups
  // user-counts, Simulator, CmdK) see the whole directory. This is the lazy
  // infinite query advancing itself — NOT the old eager pre-mutation re-walk;
  // scoped invalidation (STORE-3) means an unrelated edit won't restart it.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const groupsQ = useGroups();
  const servicesQ = useServices();
  const rulesQ = useAccessRules();

  const serviceNames = useMemo(
    () => (servicesQ.data ?? []).map(s => s.name),
    [servicesQ.data],
  );

  const rolesQ = useAllRoles(serviceNames);
  const routesQ = useAllRoutes(serviceNames);
  const auditQ = useAudit();

  const state = useMemo<AppState>(() => {
    const usersRaw = usersQ.users;
    const groupsRaw = groupsQ.data ?? [];
    const servicesRaw = servicesQ.data ?? [];
    const rules = rulesQ.data ?? [];
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

    // services → UI shape, enriched with role/route counts + upstream from rules
    const services: Service[] = servicesRaw.map(s => ({
      name: s.name,
      upstreamUrl: null as string | null,
      description: s.description || s.displayName || s.name,
      createdAt: '',
      routes: (routeMaps[s.name]?.length ?? s.routesCount) || 0,
      roles: (rolesMap[s.name] ? Object.keys(rolesMap[s.name]).length : s.rolesCount) || 0,
      ...(s.system ? { system: true } : {}),
    }));
    for (const svc of services) {
      const rule = rules.find(r => r.service === svc.name && r.upstream);
      if (rule?.upstream) svc.upstreamUrl = rule.upstream;
    }

    // authDomain — scraped from the kratos-public rule match URL (API-4 will
    // replace this with a real meta field from jinbe).
    let authDomain: string | undefined;
    const kratosRule = rules.find(r => r.id === 'kratos-public' || r.id.includes('kratos'));
    if (kratosRule) {
      const m = kratosRule.match.url.match(/https?:\/\/([^/\\>]+)/);
      if (m) authDomain = m[1].replace(/\\/g, '');
    }

    return {
      meta: { ...EMPTY_META, lastSync: 'live', authDomain },
      services,
      roles: rolesMap,
      groups,
      groupsMeta,
      users: usersRaw,
      usersLoading: usersQ.usersLoading,
      routeMaps,
      accessRules: rules,
      audit: auditQ.data ?? [],
    };
  }, [usersQ.users, usersQ.usersLoading, groupsQ.data, servicesQ.data, rulesQ.data, rolesQ.data, routesQ.data, auditQ.data]);

  // Any admin endpoint (groups/services/rules/users) 401/403s identically when
  // the caller lacks access, so any of them is a valid auth probe. Surface the
  // first error from any critical query.
  const apiError =
    (groupsQ.error ?? servicesQ.error ?? rulesQ.error ?? usersQ.error) as Error | null;

  // Gate first paint on the lighter admin queries — NOT on the (potentially
  // large) user directory. This preserves the old fast-first-paint behaviour
  // where the dashboard rendered before the full directory streamed in; the
  // Users list / counts fill in via `usersLoading` once the users query lands.
  const isLoading =
    groupsQ.isLoading || servicesQ.isLoading || rulesQ.isLoading;

  const isLive =
    groupsQ.isSuccess && servicesQ.isSuccess && rulesQ.isSuccess && !apiError;

  return { state, isLive, isLoading, apiError };
}
