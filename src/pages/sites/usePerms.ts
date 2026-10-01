import { useSession } from '../../api/hooks';
import { holds } from '../../policy/model';

/**
 * Who may do what here (site-ux.md §2), by the permission each route declares: `sites:read` looks,
 * `sites:write` drafts (and requests apply or deletion), `sites:apply` publishes with a recent second
 * factor. Somebody who drafts but may not apply gets a request instead in the Review. Buttons a
 * persona can't use are absent; the server decides either way.
 *
 * Deleting is its own permission (`sites:delete`, never through a key): `canDelete` deletes and decides
 * deletion requests; `canRequest` (`sites:write`) may ask for a deletion and extend an ephemeral site.
 */
export function useSitePerms() {
  const { data } = useSession();
  return {
    canRead: holds(data, 'sites:read'), canDraft: holds(data, 'sites:write'), canApply: holds(data, 'sites:apply'),
    canDelete: holds(data, 'sites:delete'), canRequest: holds(data, 'sites:write'),
    email: data?.email ?? null,
  };
}
