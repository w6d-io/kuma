import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * A short label on a thing: a state, a count, a group name.
 *
 * Tones carry meaning and nothing else — `success` is good, `warning` needs a look, `danger` is
 * broken or refused, `accent` is selected or yours, `info` is neutral news. A state must be said in
 * the text (or an icon + text), not by the colour alone.
 *
 * Monospace by default because most badges here are identifiers; `mono={false}` for words.
 */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'plain';

export function Badge({ tone = 'neutral', mono = true, icon, title, className, children }: {
  tone?: BadgeTone;
  mono?: boolean;
  icon?: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cx('badge', tone !== 'neutral' && tone, !mono && 'sans', className)} title={title}>
      {icon && <span className="badge-ico" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}

/** A key on the keyboard, written the way the screen expects it to be pressed. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
