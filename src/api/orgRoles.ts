import { useQueries, useQuery } from '@tanstack/react-query';
import { request } from './client';
import { orgAccessApi } from './orgAccess';
import { useSession } from './hooks';
import type { OrgPermissions } from '../policy/model';

/**
 * What the caller holds in each organization (`GET /me/permissions` → `orgPermissions`): the org
 * roles assigned to them there and the every-org map of their platform roles. The only source an
 * org-scoped control gates on — a platform permission never counts inside an organization.
 */
export function useMyOrgPermissions() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ['my-permissions', session?.email ?? ''],
    queryFn: () =>
      request<{ orgPermissions?: Record<string, unknown> }>('/me/permissions').then((r): OrgPermissions =>
        Object.fromEntries(
          Object.entries(r.orgPermissions ?? {}).map(([org, perms]) => [
            org,
            Array.isArray(perms) ? perms.filter((p): p is string => typeof p === 'string') : [],
          ]),
        ),
      ),
    enabled: !!session?.authenticated,
    staleTime: 60_000,
  });
}

/** One organization's roles, each marked with whether the caller may assign it. */
export function useOrgRoles(org: string, enabled = true) {
  return useQuery({
    queryKey: ['org-roles', org],
    queryFn: () => orgAccessApi.roles(org),
    enabled: !!org && enabled,
    retry: false,
  });
}

/**
 * Each member's org roles in one organization, by identity id. One request per member: jinbe's
 * member list does not carry roles.
 */
export function useOrgMemberRoles(org: string, memberIds: readonly string[], enabled = true) {
  // Combined into one object that keeps its identity until an answer changes, so a table drafting
  // on top of it is not reset by an unrelated render.
  return useQueries({
    queries: memberIds.map((id) => ({
      queryKey: ['org-member-roles', org, id],
      queryFn: () => orgAccessApi.memberRoles(org, id),
      enabled: !!org && enabled,
      retry: false,
    })),
    combine: (results) => {
      const byId: Record<string, string[]> = {};
      memberIds.forEach((id, i) => { if (results[i]?.data) byId[id] = results[i].data as string[]; });
      return {
        byId,
        isLoading: results.some((r) => r.isLoading),
        error: results.find((r) => r.error)?.error ?? null,
        refetch: () => results.forEach((r) => r.refetch()),
      };
    },
  });
}
