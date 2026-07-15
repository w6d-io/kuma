import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { RolesMap, AuditEvent } from './types';
import { kratosToUser, jinbeGroupsToMap, jinbeRuleToUi, fetchAuditEvents } from './transforms';

// Transforms (jinbe API shape → Kuma UI shape) live in ./transforms — the
// single source of truth. See PROBLEM-MAP STORE-6 for why they were merged.
//
// These are the scoped, per-entity query hooks that pages consume directly
// (PROBLEM-MAP STORE-2). Query keys are the canonical cache identity; scoped
// mutations invalidate only the keys they touch (STORE-3). Default staleTime
// (30s) comes from the QueryClient in main.tsx; overridden per hook where the
// data is effectively static within a session.

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
  // Stable key: a single sorted, joined token rather than spreading the array
  // into the key. Spreading made the key change on service reordering, busting
  // the cache on every render (PROBLEM-MAP PERF-6). The service list drives the
  // fetch inside queryFn; a sorted signature keeps the identity stable.
  const signature = [...serviceNames].sort().join(',');
  return useQuery({
    queryKey: ['all-roles', signature],
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

export function useAudit() {
  return useQuery<AuditEvent[]>({
    queryKey: ['audit'],
    queryFn: () => fetchAuditEvents(api),
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
