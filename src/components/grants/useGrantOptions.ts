import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { useServicePermissions } from '../../api/hooks';
import { useOrgRoles } from '../../api/orgRoles';
import { twoFactorApi } from '../../api/twoFactor';
import { ORG_PERMISSIONS, PLATFORM_PERMISSIONS } from '../../policy/catalog';
import { entitledSites } from '../../lib/orgRoles';

export interface GrantOptions {
  /** What may be picked from: jinbe first, then the sites. */
  services: string[];
  roles: { name: string; permissions: string[] }[];
  permissions: string[];
  /** The catalogue's words for jinbe's permissions. */
  labelOf: (permission: string) => string | undefined;
  loading: boolean;
}

/**
 * What a grant can name, for one service. On the platform: jinbe's roles and its platform catalogue,
 * a site's roles and the permissions its routes declare. Inside an organization: the org roles it may
 * hold (jinbe's and its entitled sites'), and for jinbe the org catalogue.
 */
export function useGrantOptions(service: string, org?: string): GrantOptions {
  const { state } = useApp();
  const orgRoles = useOrgRoles(org ?? '', !!org);
  const sitePerms = useServicePermissions(!org && service !== 'jinbe' ? service : '');
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => twoFactorApi.catalog(), staleTime: 10 * 60_000, retry: false });

  return useMemo(() => {
    const labels = new Map((catalog.data?.permissions ?? []).map((p) => [p.name, p.label]));
    const labelOf = (p: string) => labels.get(p);
    if (org) {
      const all = orgRoles.data ?? [];
      const mine = all.filter((r) => r.role.startsWith(`${service}:`)).map((r) => ({ name: r.role.slice(service.length + 1), permissions: r.permissions }));
      const permissions = service === 'jinbe' ? [...ORG_PERMISSIONS] : [...new Set(mine.flatMap((r) => r.permissions))].sort();
      return { services: ['jinbe', ...entitledSites(all)], roles: mine, permissions, labelOf, loading: orgRoles.isLoading };
    }
    const sites = state.services.map((s) => s.name).filter((n) => n !== 'jinbe').sort();
    const defined = state.roles[service] ?? {};
    const roles = Object.keys(defined).sort().map((name) => ({ name, permissions: defined[name].filter((p) => p !== '*') }));
    const permissions = service === 'jinbe'
      ? [...PLATFORM_PERMISSIONS]
      : [...new Set([...(sitePerms.data ?? []), ...roles.flatMap((r) => r.permissions)])].sort();
    return { services: ['jinbe', ...sites], roles, permissions, labelOf, loading: sitePerms.isLoading };
  }, [org, service, orgRoles.data, orgRoles.isLoading, state.services, state.roles, sitePerms.data, sitePerms.isLoading, catalog.data]);
}
