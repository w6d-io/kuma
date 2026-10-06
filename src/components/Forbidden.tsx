import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { twoFactorApi } from '../api/twoFactor';
import { Badge, I, cx } from './ui';

/**
 * The one way the console says "not for you": a page you may not open, an API refusal, an account
 * without staff access. Always the same shape — what is refused, what it needs (the permission, in
 * the catalogue's words when it has some), which groups give it, and the next step: asking an
 * administrator by default, or `nextStep` (a button or link the caller knows better, such as
 * setting up two-step sign-in). Pages never word their own refusals.
 */
export function Forbidden({
  title,
  detail,
  permissions = [],
  grantedBy = [],
  nextStep,
  compact,
}: {
  title: ReactNode;
  detail?: ReactNode;
  /** What it needs; any one of them when several. */
  permissions?: readonly string[];
  /** The groups whose roles give it (jinbe refusals carry them; pages read them off the groups). */
  grantedBy?: readonly string[];
  /** The action that unblocks it, when there is one besides asking an administrator. */
  nextStep?: ReactNode;
  compact?: boolean;
}) {
  // The same cached catalogue the grant picker reads: the plain words beside each permission.
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => twoFactorApi.catalog(), staleTime: 10 * 60_000, retry: false, enabled: permissions.length > 0 });
  const labelOf = (p: string) => catalog.data?.permissions?.find((c) => c.name === p)?.label;
  const ask = grantedBy.length
    ? `Ask an administrator to add you to ${grantedBy.length === 1 ? 'this group' : 'one of these groups'}.`
    : permissions.length ? 'Ask an administrator for it.' : null;

  return (
    <div role="alert" className={cx('panel', 'api-error', 'forbidden', compact && 'compact')}>
      <span className="api-error-ico">{I.shield}</span>
      <div className="flex-1 min-w-0">
        <div className="fw-medium">{title}</div>
        {detail && <div className="small muted mt-2">{detail}</div>}
        {permissions.length > 0 && (
          <div className="forbidden-row">
            <span className="small muted">{permissions.length === 1 ? 'Needs' : 'Needs one of'}</span>
            <span className="row wrap gap-4">
              {permissions.map((p) => (
                <span key={p} className="row gap-4">
                  <Badge>{p}</Badge>
                  {labelOf(p) && <span className="small muted">{labelOf(p)}</span>}
                </span>
              ))}
            </span>
          </div>
        )}
        {grantedBy.length > 0 && (
          <div className="forbidden-row">
            <span className="small muted">Given by</span>
            <span className="row wrap gap-4">{grantedBy.map((g) => <Badge key={g} tone="info">{g}</Badge>)}</span>
          </div>
        )}
        {(nextStep || ask) && <div className="forbidden-next">{nextStep ?? <span className="small">{ask}</span>}</div>}
      </div>
    </div>
  );
}
