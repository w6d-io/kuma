import { useMyOrganizations, useMyOrganizationsScope, useSession } from '../api/hooks';
import { permits } from '../policy/model';
import { myOrgVisibility } from '../lib/orgGrants';

/**
 * Whether this session has an org to administer, and whether it may pick any org. Read by the rail
 * (to show "My org" at all) and by the page (to choose its picker), so the two agree.
 */
export function useMyOrg() {
  const { data: session } = useSession();
  const mine = useMyOrganizations();
  const scope = useMyOrganizationsScope().data;
  const administered = mine.isError ? [] : mine.data ?? [];
  const mayReadAll = permits(session?.permissions, 'admin.organisation:read') || scope === 'all';
  return { ...myOrgVisibility({ administered, mayReadAll }), administered, isLoading: mine.isLoading };
}
