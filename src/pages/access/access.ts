import { useSession } from '../../api/hooks';
import { useApp } from '../../contexts/AppContext';
import { useMemo } from 'react';
import { permits } from '../../policy/model';
import { administersPlatform, groupOutcome } from '../../lib/rbacEdit';

/**
 * Whether this session may change roles and groups. jinbe asks for admin write on every write here;
 * the read-only persona switches the controls off for a demo. Controls a reader cannot use are left
 * out rather than greyed, with one line saying why.
 */
export function useCanEditAccess(): boolean {
  const { data: session } = useSession();
  const { persona } = useApp();
  return persona !== 'viewer' && permits(session?.permissions, 'admin:write');
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The site groups as the screens that hand them out need them: every group jinbe serves (the same
 * list Groups edits), whether this session may assign them, and which ones administer the platform.
 */
export function useSiteGroups() {
  const { state } = useApp();
  const { data: session } = useSession();
  return useMemo(() => {
    const systemSites = new Set(state.services.filter(s => s.system).map(s => s.name));
    return {
      offered: Object.keys(state.groups).sort(),
      mayAssign: permits(session?.permissions, 'admin:write'),
      privileged: (g: string) => administersPlatform(state.groups[g], state.roles, systemSites),
      describe: (g: string) => groupOutcome(state.groups[g], state.roles).summary,
    };
  }, [state.groups, state.roles, state.services, session?.permissions]);
}
