import { useSession } from '../api/hooks';
import { mayUse } from '../policy/model';

/** The directory's bulk actions the caller may use. Each shows only when jinbe would take it; none deletes. */
export function useBulkPermissions() {
  const { data: session } = useSession();
  return {
    verify: mayUse(session, 'users:verify'),
    addToGroups: mayUse(session, 'groups.members:write'),
    invite: mayUse(session, 'users:create'),
    inviteMail: mayUse(session, 'users:recovery'),
  };
}
