import { useSession } from '../api/hooks';
import { describeApiError } from '../lib/apiError';
import { I } from './ui/Icons';

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
    <div
      role="alert"
      className="panel"
      style={{ padding: compact ? 14 : 28, display: 'flex', gap: 12, alignItems: 'flex-start' }}
    >
      <span style={{ width: 16, height: 16, display: 'grid', placeItems: 'center', color: 'var(--red, #ef4444)', flexShrink: 0, marginTop: 1 }}>
        {view.kind === 'forbidden' ? I.shield : I.alert}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{title}</div>
        <div className="small muted" style={{ marginTop: 2 }}>{view.detail}</div>
      </div>
      {view.retryable && onRetry && (
        <button className="btn sm" onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}
