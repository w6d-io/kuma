import { useId, type ReactNode } from 'react';
import { cx } from './cx';

/**
 * A short description shown on hover AND on keyboard focus, and read out through
 * `aria-describedby` — unlike `title`, which a keyboard never sees and a touch screen never shows.
 *
 * For supplementary words only. Anything somebody needs in order to act belongs on the screen.
 */
export function Tooltip({ content, side = 'top', children, className }: {
  content: ReactNode;
  side?: 'top' | 'bottom';
  children: ReactNode;
  className?: string;
}) {
  const id = `tip${useId()}`;
  return (
    <span className={cx('tooltip', side, className)}>
      <span className="tooltip-trigger" aria-describedby={id} tabIndex={0}>{children}</span>
      <span id={id} role="tooltip" className="tooltip-bubble">{content}</span>
    </span>
  );
}
