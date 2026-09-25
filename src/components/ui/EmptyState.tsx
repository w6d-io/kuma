import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * What an empty list says: what is missing, why that might be, and the one action that fills it.
 * An empty screen with no way forward is a dead end; this is the way forward.
 */
export function EmptyState({ icon, title, children, action, compact, className }: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Inside a card or a table cell rather than filling a page. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('empty-state', compact && 'compact', className)}>
      {icon && <div className="empty-ico" aria-hidden="true">{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/** One quiet line where a list would be — for a small region that needs no heading or action. */
export function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="empty-hint">{children}</div>;
}
