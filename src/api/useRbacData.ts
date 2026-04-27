import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { KratosIdentity, JinbeGroup, JinbeAccessRule } from './client';
import type { AppState, User, GroupsMap, RolesMap, RouteMapsMap, AccessRule, AuditEvent, Service } from './types';
import { SEED } from '../seed';

function kratosToUser(k: KratosIdentity): User {
  return {
    id: k.id,
    name: k.traits.name || k.traits.email,
    email: k.traits.email,
    groups: k.metadata_admin?.groups || (k as any).groups || [],
    title: '',
    active: k.state === 'active',
    last: k.updated_at ? timeAgo(k.updated_at) : 'never',
  };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function jinbeRuleToUi(r: JinbeAccessRule): AccessRule {
  return {
    id: r.id,
    service: r.id.replace(/-authenticated$|-health$|-public$/, ''),
    match: { url: r.match.url, methods: r.match.methods },
    authenticators: r.authenticators.map(a => a.handler),
    authorizer: r.authorizer.handler,
    opaUrl: typeof r.authorizer.config === 'object' && r.authorizer.config !== null
      ? (r.authorizer.config as Record<string, string>).remote_json_url || undefined
      : undefined,
    mutators: r.mutators.map(m => m.handler),
    upstream: r.upstream?.url,
  };
}

async function fetchAllRbacData(): Promise<AppState> {
  const [usersRaw, groupsRaw, servicesRaw, rulesRaw] = await Promise.all([
    api.getUsers().catch(() => [] as KratosIdentity[]),
    api.getGroups().catch(() => [] as JinbeGroup[]),
    api.getServices().catch(() => []),
    api.getAccessRules().catch(() => [] as JinbeAccessRule[]),
  ]);

  // Transform users
  const users: User[] = usersRaw.map(kratosToUser);

  // Transform groups → map
  const groups: GroupsMap = {};
  for (const g of groupsRaw) {
    groups[g.name] = g.services || {};
  }

  // Transform services
  const services: Service[] = servicesRaw.map(s => ({
    name: s.name,
    upstreamUrl: null,
    description: s.displayName || s.name,
    createdAt: '',
    routes: s.routesCount || 0,
    roles: s.rolesCount || 0,
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

  // History as audit events
  let audit: AuditEvent[] = [];
  try {
    const commits = await api.getHistory();
    audit = commits.map((c, i) => ({
      id: `h_${i}`,
      when: timeAgo(c.timestamp),
      ts: c.timestamp,
      who: c.authorEmail,
      category: 'rbac' as const,
      verb: 'commit',
      target: c.message,
      status: 'applied',
    }));
  } catch {
    // history endpoint may not exist
  }

  return {
    meta: {
      jinbeApi: '/api',
      opalServer: '',
      kratosAdmin: '',
      lastSync: 'live',
    },
    services,
    roles: rolesMap,
    groups,
    users,
    routeMaps,
    accessRules,
    audit,
  };
}

export function useRbacData() {
  return useQuery({
    queryKey: ['rbac-all'],
    queryFn: fetchAllRbacData,
    staleTime: 60_000,
    retry: 1,
    placeholderData: SEED,
  });
}

export function useInvalidateRbac() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['rbac-all'] });
}
