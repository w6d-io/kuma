import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SEED } from '../seed';
import { api } from './client';
import type { KratosIdentity, JinbeGroup, JinbeAccessRule } from './client';
import type { AppState, User, GroupsMap, RolesMap, RouteMapsMap, AccessRule, AuditEvent, Service } from './types';
import { kratosToUser, jinbeRuleToUi, fetchAuditEvents } from './transforms';

// Re-exported for existing importers (e.g. AppContext background loader).
export { kratosToUser } from './transforms';

function classifyError(err: unknown): Error {
  if (err instanceof Error && (err as any).status) return err as Error;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('Unauthorized') || msg.includes('401')) return Object.assign(new Error('Unauthorized'), { status: 401 });
  if (msg.includes('403') || msg.includes('Forbidden')) return Object.assign(new Error('Forbidden'), { status: 403 });
  return Object.assign(new Error('NetworkError'), { status: 0 });
}

async function fetchAllRbacData(): Promise<AppState> {
  console.log('[useRbacData] fetching...');
  const [usersResult, groupsResult, servicesResult, rulesResult] = await Promise.allSettled([
    // Only the first page here — it doubles as the auth probe (a 401/403 throws
    // and gates the whole UI) and gives the dashboard instant initial numbers.
    // Remaining pages stream in via the background loader in AppContext.
    api.getUsersPage(),
    api.getGroups(),
    api.getServices(),
    api.getAccessRules(),
  ]);

  // If users fetch failed, classify and throw — this is the critical signal
  if (usersResult.status === 'rejected') {
    throw classifyError(usersResult.reason);
  }

  // If any other critical fetch failed, classify and throw
  for (const result of [groupsResult, servicesResult, rulesResult]) {
    if (result.status === 'rejected') {
      throw classifyError(result.reason);
    }
  }

  const usersPage = usersResult.value as { data: KratosIdentity[]; nextPageToken?: string };
  const usersRaw = usersPage.data;
  const groupsRaw = (groupsResult as PromiseFulfilledResult<JinbeGroup[]>).value;
  const servicesRaw = (servicesResult as PromiseFulfilledResult<any[]>).value;
  const rulesRaw = (rulesResult as PromiseFulfilledResult<JinbeAccessRule[]>).value;

  // Transform users
  const users: User[] = usersRaw.map(kratosToUser);

  // Transform groups → map + collect per-group metadata side-car
  const groups: GroupsMap = {};
  const groupsMeta: Record<string, { system?: boolean; description?: string }> = {};
  for (const g of groupsRaw) {
    groups[g.name] = g.services || {};
    if (g.system || g.description) {
      groupsMeta[g.name] = {
        ...(g.system ? { system: true } : {}),
        ...(g.description ? { description: g.description } : {}),
      };
    }
  }

  // Transform services
  const services: Service[] = servicesRaw.map(s => ({
    name: s.name,
    upstreamUrl: null,
    description: s.description || s.displayName || s.name,
    createdAt: '',
    routes: s.routesCount || 0,
    roles: s.rolesCount || 0,
    ...(s.system ? { system: true } : {}),
  }));

  // Fetch roles and route maps for each service in parallel
  const rolesMap: RolesMap = {};
  const routeMaps: RouteMapsMap = {};

  await Promise.all(
    servicesRaw.map(async s => {
      const [rolesResult, routesResult] = await Promise.all([
        api.getRoles(s.name).catch(() => null),
        api.getServiceRoutes(s.name).catch(() => null),
      ]);

      if (rolesResult) {
        const map: Record<string, string[]> = {};
        for (const r of rolesResult.roles) map[r.name] = r.permissions || [];
        rolesMap[s.name] = map;
      } else {
        rolesMap[s.name] = {};
      }

      routeMaps[s.name] = routesResult?.rules || [];
    })
  );

  // Transform access rules
  const accessRules: AccessRule[] = rulesRaw.map(jinbeRuleToUi);

  // Enrich services with upstream from access rules
  for (const svc of services) {
    const rule = accessRules.find(r => r.service === svc.name && r.upstream);
    if (rule?.upstream) svc.upstreamUrl = rule.upstream;
  }

  // Audit events — enriched endpoint first, legacy history fallback (shared
  // with useAudit via transforms.fetchAuditEvents).
  let audit: AuditEvent[] = [];
  try {
    audit = await fetchAuditEvents(api);
  } catch {
    // fall back to empty
  }

  // Extract auth domain from access rules (kratos-public rule match URL)
  const kratosRule = rulesRaw.find(r => r.id === 'kratos-public' || r.id.includes('kratos'));
  let authDomain: string | undefined;
  if (kratosRule) {
    const m = kratosRule.match.url.match(/https?:\/\/([^/\\>]+)/);
    if (m) authDomain = m[1].replace(/\\/g, '');
  }

  const result: AppState = {
    meta: {
      jinbeApi: '/api',
      opalServer: '',
      kratosAdmin: '',
      lastSync: 'live',
      authDomain,
    },
    services,
    roles: rolesMap,
    groups,
    groupsMeta,
    users,
    usersNextPageToken: usersPage.nextPageToken,
    usersLoading: !!usersPage.nextPageToken,
    routeMaps,
    accessRules,
    audit,
  };
  console.log('[useRbacData] fetched:', { users: users.length, groups: Object.keys(groups).length, services: services.length, rules: accessRules.length });
  return result;
}

export function useRbacData() {
  return useQuery({
    queryKey: ['rbac-all'],
    queryFn: fetchAllRbacData,
    staleTime: 60_000,
    retry: (failureCount, err) => (err as any).status === 403 || (err as any).status === 401 ? false : failureCount < 1,
    retryDelay: 1000,
    ...(import.meta.env.DEV ? { placeholderData: SEED } : {}),
  });
}

export function useInvalidateRbac() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['rbac-all'] });
}
