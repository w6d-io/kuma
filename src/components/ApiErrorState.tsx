import { useSession } from '../api/hooks';
import { describeApiError } from '../lib/apiError';
import { Button, I, cx } from './ui';

/**
 * The one way a screen says it could not load. The wording comes from `describeApiError`, so a 403
 * and a 503 read differently everywhere, and "no groups assigned" is said only when it is true.
 */
export function ApiErrorState({
  error,
  onRetry,
  what,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  /** What failed to load, e.g. "sessions" — appended to the title for failures that are not access. */
  what?: string;
  compact?: boolean;
}) {
  const { data: session } = useSession();
  const view = describeApiError(error, { groups: session?.groups });
  const title = view.kind === 'failed' && what ? `Could not load ${what}` : view.title;
  return (
    <div role="alert" className={cx('panel', 'api-error', compact && 'compact')}>
      <span className="api-error-ico">
        {view.kind === 'forbidden' ? I.shield : I.alert}
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
