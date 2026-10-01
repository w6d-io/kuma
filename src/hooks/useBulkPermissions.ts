import { useSession } from '../api/hooks';
import { holds } from '../policy/model';

/** The directory's bulk actions the caller may use. Each shows only when jinbe would take it; none deletes. */
export function useBulkPermissions() {
  const { data: session } = useSession();
  return {
    verify: holds(session, 'users:verify'),
    addToGroups: holds(session, 'groups.members:write'),
    invite: holds(session, 'users:create'),
    inviteMail: holds(session, 'users:recovery'),
  };
}
