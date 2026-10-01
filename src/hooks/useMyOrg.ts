import { useSession } from '../api/hooks';
import { useMyOrgPermissions } from '../api/orgRoles';
import { holds } from '../policy/model';
import { myOrgVisibility } from '../lib/orgRoles';

/**
 * The organizations this session can look into from the inside — where it holds an org permission
 * (`/me/permissions` orgPermissions) — and whether it may pick any org (`orgs:read`). Read by the rail
 * (to show "My org" at all) and by the page (to choose its picker), so the two agree.
 */
export function useMyOrg() {
  const { data: session } = useSession();
  const held = useMyOrgPermissions();
  const orgPermissions = held.isError ? {} : held.data ?? {};
  const administered = Object.keys(orgPermissions).filter((o) => orgPermissions[o].length > 0).sort();
  const mayReadAll = holds(session, 'orgs:read');
  return { ...myOrgVisibility({ administered, mayReadAll }), administered, orgPermissions, isLoading: held.isLoading };
}
