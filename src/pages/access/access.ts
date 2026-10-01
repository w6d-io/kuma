import { useSession } from '../../api/hooks';
import { useApp } from '../../contexts/AppContext';
import { useMemo } from 'react';
import { holds } from '../../policy/model';
import { administersPlatform, beyondHeld, groupOutcome } from '../../lib/rbacEdit';

/**
 * Whether this session may change roles and group definitions: `groups:write`, what jinbe asks on
 * every write here (a recent second factor too). Controls a reader cannot use are left out rather
 * than greyed, with one line saying why. What code or a site intent defines stays read-only anyway.
 */
export function useCanEditAccess(): boolean {
  const { data: session } = useSession();
  return holds(session, 'groups:write');
}

/** Where a code-owned object comes from: jinbe's own in its code, a site's in its intent. */
export function definedWhere(site: string): string {
  return site === 'jinbe' ? 'defined in code' : "defined by the site's intent";
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The site groups as the screens that hand them out need them: every group jinbe serves (the same
 * list Groups edits), whether this session may assign them (groups.members:write), which ones give
 * platform access, and — the holding rule, as far as the console sees it — what each gives on jinbe
 * that the caller does not hold. jinbe decides the grant either way.
 */
export function useSiteGroups() {
  const { state } = useApp();
  const { data: session } = useSession();
  return useMemo(() => {
    const systemSites = new Set(state.services.filter(s => s.system).map(s => s.name));
    return {
      offered: Object.keys(state.groups).sort(),
      mayAssign: holds(session, 'groups.members:write'),
      privileged: (g: string) => administersPlatform(state.groups[g], state.roles, systemSites),
      beyond: (g: string) => beyondHeld(state.groups[g], state.roles, session?.effective_permissions ?? session?.permissions ?? []),
      describe: (g: string) => groupOutcome(state.groups[g], state.roles).summary,
    };
  }, [state.groups, state.roles, state.services, session]);
}
