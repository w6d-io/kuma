import type { ReactNode } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession } from '../api/hooks';
import { hasAnyPerm, navItemFor } from '../nav';
import type { PageId } from '../api/types';
import { Forbidden } from './Forbidden';
import { SkeletonPanel } from './ui';

/**
 * What the content area shows for `page`: nothing privileged before the session answers (a skeleton,
 * so no page flashes and then turns into a refusal), the page's refusal when the person may not open
 * it (a link, a reload, an old bookmark — instead of a silent jump to Home), else the page.
 */
export function PageGate({ page, children }: { page: PageId; children: ReactNode }) {
  const { data: session, isSuccess: sessionReady } = useSession();
  if (!sessionReady) return <SkeletonPanel />;
  // An old id with no rail entry inherits the gate of its successor (navItemFor); none: open.
  const nav = navItemFor(page);
  if (nav && !hasAnyPerm(session, nav.perms)) return <PageForbidden page={page} />;
  return <>{children}</>;
}

/**
 * A page the signed-in person may not open, said in place of the page. What it needs is the rail's own gate
 * (nav.tsx); the groups that give it are read off the platform's roles when the person may read
 * groups, and left to the administrator otherwise.
 */
export function PageForbidden({ page }: { page: PageId }) {
  const { state } = useApp();
  const { data: session } = useSession();
  const nav = navItemFor(page);
  const permissions = nav?.perms ?? [];
  const jinbeRoles = state.roles.jinbe ?? {};
  const grantedBy = Object.entries(state.groups)
    .filter(([, apps]) => (apps.jinbe ?? []).some((role) => (jinbeRoles[role] ?? []).some((p) => (permissions as readonly string[]).includes(p))))
    .map(([name]) => name)
    .sort();
  const none = (session?.groups ?? []).length === 0;
  return (
    <div className="blocked-page">
      <Forbidden
        title={`You can't open ${nav?.name ?? 'this page'}`}
        detail={none ? 'Your account is in no group yet.' : 'Your roles do not include what this page needs.'}
        permissions={permissions}
        grantedBy={grantedBy}
      />
    </div>
  );
}
