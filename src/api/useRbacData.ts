import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SEED } from '../seed';
import { api } from './client';
import type { KratosIdentity, JinbeGroup, JinbeAccessRule } from './client';
import type { AppState, User, GroupsMap, RolesMap, RouteMapsMap, AccessRule, AuditEvent, Service } from './types';

function classifyError(err: unknown): Error {
  if (err instanceof Error && (err as any).status) return err as Error;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('Unauthorized') || msg.includes('401')) return Object.assign(new Error('Unauthorized'), { status: 401 });
  if (msg.includes('403') || msg.includes('Forbidden')) return Object.assign(new Error('Forbidden'), { status: 403 });
  return Object.assign(new Error('NetworkError'), { status: 0 });
}

function kratosToUser(k: KratosIdentity): User {
  return {
    id: k.id,
    name: k.traits.name || k.traits.email,
    email: k.traits.email,
    groups: k.metadata_admin?.groups || (k as any).groups || [],
    title: '',
    active: k.state === 'active',
    last: k.updated_at ? timeAgo(k.updated_at) : 'never',
    organizationId: k.organization_id,
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
    service: r.id.split('-')[0],
    match: { url: r.match.url, methods: r.match.methods },
    authenticators: r.authenticators.map(a => a.handler),
    authorizer: r.authorizer.handler,
    opaUrl: typeof r.authorizer.config === 'object' && r.authorizer.config !== null
      ? (r.authorizer.config as Record<string, string>).remote_json_url || undefined
      : undefined,
    mutators: r.mutators.map(m => m.handler),
    upstream: r.upstream?.url,
    stripPath: r.upstream?.strip_path,
  };
}

async function fetchAllRbacData(): Promise<AppState> {
  console.log('[useRbacData] fetching...');
  const [usersResult, groupsResult, servicesResult, rulesResult] = await Promise.allSettled([
    api.getUsers(),
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

  const usersRaw = usersResult.value as KratosIdentity[];
  const groupsRaw = (groupsResult as PromiseFulfilledResult<JinbeGroup[]>).value;
  const servicesRaw = (servicesResult as PromiseFulfilledResult<any[]>).value;
  const rulesRaw = (rulesResult as PromiseFulfilledResult<JinbeAccessRule[]>).value;

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

  // Audit events — try enriched endpoint first, fall back to history
  let audit: AuditEvent[] = [];
  try {
    let events: any[] = [];
    // Try /admin/audit/events first (new enriched format)
    try {
      const raw = await api.getAuditEvents({ limit: 200 });
      events = (raw.events || []).filter((e: any) => e && Object.keys(e).length > 0);
    } catch { /* endpoint may not exist */ }
    // Fallback: /admin/rbac/history (old format, always works)
    if (events.length === 0) {
      try {
        const commits = await api.getHistory();
        events = commits.map((c: any) => ({ ...c, _legacy: true }));
      } catch { /* history may also fail */ }
    }
    audit = events.map((e: any) => {
      // New enriched format (has who/verb/category directly)
      if (e.who || e.verb) {
        return {
          id:             e.id,
          when:           e.when || timeAgo(e.ts || ''),
          ts:             e.ts,
          who:            e.who || '',
          actorName:      e.actorName,
          category:       e.category || 'system',
          verb:           e.verb || 'unknown',
          target:         e.target || '',
          status:         e.result === 'applied' ? 'applied' : e.result === 'ok' ? undefined : e.result,
          service:        e.service,
          ip:             e.ip,
          ua:             e.ua,
          reason:         e.reason,
          method:         e.method,
          path:           e.path,
          statusCode:     e.statusCode,
          responseTimeMs: e.responseTimeMs,
        };
      }
      // Old format: { id, event: { type, timestamp, actor: JSON, details: JSON } }
      const ev = e.event || e;
      const actor = typeof ev.actor === 'string' ? JSON.parse(ev.actor) : ev.actor || {};
      const details = typeof ev.details === 'string' ? JSON.parse(ev.details) : ev.details || {};
      const target = typeof ev.target === 'string' ? (ev.target.startsWith('{') ? JSON.parse(ev.target) : { id: ev.target }) : ev.target || {};
      const type = ev.type || '';
      const [cat, verb] = type.includes('.') ? type.split('.', 2) : ['system', type];
      return {
        id:             e.id || ev.id || '',
        when:           timeAgo(ev.timestamp || ''),
        ts:             ev.timestamp,
        who:            actor.email || ev.author || 'system',
        actorName:      actor.name,
        category:       cat,
        verb:           verb,
        target:         ev.message || details.path || target.id || type,
        status:         details.statusCode && details.statusCode >= 400 ? 'failed' : undefined,
        service:        target.type === 'service' ? target.id : undefined,
        ip:             actor.ip || details.ip,
        ua:             actor.ua,
        reason:         details.reason,
        method:         details.method,
        path:           details.path,
        statusCode:     details.statusCode,
        responseTimeMs: details.responseTimeMs,
      };
    }).filter((e: AuditEvent) => e.id);
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
    users,
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
