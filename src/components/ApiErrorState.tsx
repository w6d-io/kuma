import type { ReactNode } from 'react';
import { useSession } from '../api/hooks';
import { describeApiError, permissionRefusal } from '../lib/apiError';
import { Forbidden } from './Forbidden';
import { Button, I, cx } from './ui';

/**
 * The one way a screen says it could not load. The wording comes from `describeApiError`, so a 403
 * and a 503 read differently everywhere, and "no groups assigned" is said only when it is true. A
 * refusal (a 403 of jinbe, the gateway or the web firewall) is drawn by `Forbidden`, with what it
 * needs and who gives it when jinbe says so; `nextStep` is the action that unblocks it, if any.
 */
export function ApiErrorState({
  error,
  onRetry,
  what,
  compact,
  nextStep,
}: {
  error: unknown;
  onRetry?: () => void;
  /** What failed to load, e.g. "sessions" — appended to the title for failures that are not access. */
  what?: string;
  compact?: boolean;
  /** Shown on a refusal in place of "ask an administrator", e.g. setting up two-step sign-in. */
  nextStep?: ReactNode;
}) {
  const { data: session } = useSession();
  const view = describeApiError(error, { groups: session?.groups });
  if (view.kind === 'forbidden' || view.kind === 'blocked') {
    const refusal = permissionRefusal(error);
    // jinbe named what is missing: the badges say it, the sentence keeps only what they do not.
    const detail = refusal
      ? refusal.code === 'grant_exceeds_own' ? 'This grants what you do not hold yourself.' : refusal.grantedBy.length ? undefined : refusal.hint
      : view.detail;
    return (
      <Forbidden
        title={view.title}
        detail={detail}
        permissions={refusal?.permissions}
        grantedBy={refusal?.grantedBy}
        nextStep={nextStep}
        compact={compact}
      />
    );
  }
  const title = view.kind === 'failed' && what ? `Could not load ${what}` : view.title;
  return (
    <div role="alert" className={cx('panel', 'api-error', compact && 'compact')}>
      <span className="api-error-ico">
        {view.kind === 'unconfigured' ? I.info : I.alert}
      </span>
      <div className="flex-1 min-w-0">
        <div className="fw-medium">{title}</div>
        <div className="small muted mt-2">{view.detail}</div>
      </div>
      {view.retryable && onRetry && (
        <Button size="sm" onClick={onRetry}>Retry</Button>
      )}
    </div>
  );
}
