import { useSession } from '../../api/hooks';
import { permits } from '../../policy/model';

/**
 * Who may do what here (site-ux.md §2). `admin:read` looks; `admin:write` drafts and applies —
 * jinbe's "super admin" gate (requireSuperAdmin) is `admin:write`, with a recent second factor on
 * anything that reaches the gateway. When the server grows a draft-only role (site-ux §2 "Request
 * apply"), `canApply` narrows and the Review offers a request instead. Buttons a persona can't use
 * are absent; the server decides either way.
 */
export function useSitePerms() {
  const { data } = useSession();
  const perms = data?.permissions;
  const write = permits(perms, 'admin:write');
  return { canRead: permits(perms, 'admin:read'), canDraft: write, canApply: write, email: data?.email ?? null };
}
