import { useMemo } from 'react';
import { useAllOrganizations, useMyOrganizations, useMyOrganizationNames, useSession } from './hooks';
import { permits } from '../policy/model';

/**
 * The organisations the caller may pick from, with their names.
 *
 * Every organisation for somebody who may read them all (`/admin/organizations`), and their own
 * otherwise (`/me/organizations`). Asked in that order rather than merged: the first is complete,
 * the second is a subset, and a picker mixing them could not say which it was showing.
 */
export function useOrgCatalog() {
  const { data: session } = useSession();
  const mayReadAll = permits(session?.permissions, 'admin.organisation:read');
  const all = useAllOrganizations();
  const mine = useMyOrganizations();
  const names = useMyOrganizationNames();

  const orgs = useMemo(() => {
    if (mayReadAll && all.data) {
      return all.data.organizations.map((o) => ({ id: o.id, name: o.name }));
    }
    return (mine.data ?? []).map((id) => ({ id, name: names.data?.[id] }));
  }, [mayReadAll, all.data, mine.data, names.data]);

  const useAll = mayReadAll && !all.isError;
  return {
    orgs,
    isLoading: useAll ? all.isLoading : mine.isLoading,
    error: (useAll ? all.error : mine.error) as Error | null,
  };
}
