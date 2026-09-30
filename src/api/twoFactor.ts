import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from './client';
import { useGroups } from './hooks';
import { STEP_UP_MINUTES, type GroupSecondFactor, type StepUpRule, type UserSecondFactor } from '../lib/twoFactor';

/**
 * Where the second-factor rules come from, for the badges (lib/twoFactor.ts):
 *   permissions  GET /catalog — open to every signed-in person; `stepUpRule` on a jinbe that
 *                describes it, the bare `stepUp` flag on one that predates it
 *   groups       GET /admin/rbac/groups — each group's `secondFactor`
 *   you          GET /me/permissions — `secondFactor`, your own picture
 * Sites carry their own (`secondFactor` on the list and the detail).
 */

/** The platform's own catalogue (jinbe). Its permissions are the ones under the `jinbe` site. */
export const PLATFORM_SITE = 'jinbe';

interface CatalogPermission { name: string; label?: string; stepUp?: boolean; stepUpRule?: StepUpRule | null }
interface CatalogRole { name: string; permissions: string[]; stepUpPermissions?: string[] }

export const twoFactorApi = {
  /** One group's "Members must use 2FA" switch. Super admin, with a recent second factor. */
  setGroupRequired: (name: string, required: boolean) =>
    request<{ name: string; secondFactor: GroupSecondFactor }>(`/admin/rbac/groups/${encodeURIComponent(name)}/second-factor`, {
      method: 'PUT',
      body: JSON.stringify({ required }),
    }),
  catalog: () => request<{ permissions: CatalogPermission[]; roles: CatalogRole[] }>('/catalog'),
  own: () => request<{ secondFactor?: UserSecondFactor | null }>('/me/permissions').then((r) => r.secondFactor ?? null),
};

export const OWN_SECOND_FACTOR = ['own-second-factor'] as const;

/** Which catalogue permissions need a recent second factor. `ruleOf` answers null for anything else. */
export function useStepUpRules() {
  const q = useQuery({ queryKey: ['catalog'], queryFn: () => twoFactorApi.catalog(), staleTime: 10 * 60_000, retry: false });
  const rules = useMemo(() => {
    const m = new Map<string, StepUpRule>();
    for (const p of q.data?.permissions ?? []) {
      const rule = p.stepUpRule ?? (p.stepUp ? { required: true, maxAgeMin: STEP_UP_MINUTES } : null);
      if (rule?.required) m.set(p.name, rule);
    }
    return m;
  }, [q.data]);
  /** `site`: the permission's site; only the platform's own (`jinbe`, or none given) has step-ups. */
  const ruleOf = useCallback((permission: string, site?: string): StepUpRule | null =>
    (site && site !== PLATFORM_SITE ? null : rules.get(permission) ?? null), [rules]);
  return { ruleOf, loaded: q.isSuccess };
}

/** Each group's second-factor rule, by name; undefined on a jinbe that does not say. */
export function useGroupSecondFactors() {
  const { data } = useGroups();
  return useMemo(() => {
    const m = new Map<string, GroupSecondFactor>();
    for (const g of data ?? []) if (g.secondFactor) m.set(g.name, g.secondFactor);
    return (name: string) => m.get(name);
  }, [data]);
}

/** Your own picture: null on a jinbe that does not describe it. */
export function useOwnSecondFactor() {
  return useQuery({ queryKey: OWN_SECOND_FACTOR, queryFn: () => twoFactorApi.own(), staleTime: 60_000, retry: false });
}
