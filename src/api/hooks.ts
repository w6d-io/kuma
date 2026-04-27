import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { KratosIdentity, JinbeGroup, JinbeAccessRule } from './client';
import type { User, GroupsMap, RolesMap, AccessRule } from './types';

// ─── Transform helpers: jinbe API shapes → Kuma UI shapes ───

function kratosToUser(k: KratosIdentity): User {
  return {
    id: k.id,
    name: k.traits.name || k.traits.email,
    email: k.traits.email,
    groups: k.metadata_admin?.groups || [],
    title: '',
    active: k.state === 'active',
    last: k.updated_at ? timeAgo(k.updated_at) : 'never',
  };
}

function jinbeGroupsToMap(groups: JinbeGroup[]): GroupsMap {
  const map: GroupsMap = {};
  for (const g of groups) {
    map[g.name] = g.services;
  }
  return map;
}

function jinbeRuleToUi(r: JinbeAccessRule): AccessRule {
  return {
    id: r.id,
    service: r.id.replace(/-authenticated$|-health$/, ''),
    match: { url: r.match.url, methods: r.match.methods },
    authenticators: r.authenticators.map(a => a.handler),
    authorizer: r.authorizer.handler,
    opaUrl: typeof r.authorizer.config === 'object' && r.authorizer.config !== null
      ? (r.authorizer.config as Record<string, unknown>).remote_json_url as string || undefined
      : undefined,
    mutators: r.mutators.map(m => m.handler),
    upstream: r.upstream.url,
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

// ─── Query hooks ───

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const identities = await api.getUsers();
      return identities.map(kratosToUser);
    },
  });
}

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => api.getGroups(),
  });
}

export function useGroupsMap() {
  return useQuery({
    queryKey: ['groups-map'],
    queryFn: async () => {
      const groups = await api.getGroups();
      return jinbeGroupsToMap(groups);
    },
  });
}

export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: () => api.getServices(),
  });
}

export function useRoles(serviceName: string) {
  return useQuery({
    queryKey: ['roles', serviceName],
    queryFn: () => api.getRoles(serviceName),
    enabled: !!serviceName,
  });
}

export function useAllRoles(serviceNames: string[]) {
  return useQuery({
    queryKey: ['all-roles', ...serviceNames],
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

export function useServiceRoutes(serviceName: string) {
  return useQuery({
    queryKey: ['routes', serviceName],
    queryFn: () => api.getServiceRoutes(serviceName),
    enabled: !!serviceName,
  });
}

export function useAccessRules() {
  return useQuery({
    queryKey: ['access-rules'],
    queryFn: async () => {
      const rules = await api.getAccessRules();
      return rules.map(jinbeRuleToUi);
    },
  });
}

export function useHistory() {
  return useQuery({
    queryKey: ['history'],
    queryFn: () => api.getHistory(),
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

export function useSetUserGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, groups }: { email: string; groups: string[] }) =>
      api.setUserGroups(email, groups),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['groups-map'] });
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (group: { name: string; services: Record<string, string[]> }) =>
      api.createGroup(group),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, services }: { name: string; services: Record<string, string[]> }) =>
      api.updateGroup(name, services),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteGroup(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (svc: { name: string; upstreamUrl: string; matchUrl: string; matchMethods: string[] }) =>
      api.createService(svc),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['access-rules'] });
    },
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteService(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['access-rules'] });
    },
  });
}

export function useUpdateServiceRoutes(serviceName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rules: { method: string; path: string; permission?: string }[]) =>
      api.updateServiceRoutes(serviceName, rules),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routes', serviceName] }),
  });
}

export function useUpdateAccessRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rule }: { id: string; rule: import('./client').JinbeAccessRule }) =>
      api.updateAccessRule(id, rule),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-rules'] }),
  });
}

export function useUpdateServiceRoles(serviceName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roles: Record<string, string[]>) => api.updateServiceRoles(serviceName, roles),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles', serviceName] });
      qc.invalidateQueries({ queryKey: ['rbac-all'] });
    },
  });
}
