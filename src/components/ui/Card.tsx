import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { ButtonBase } from './Button';

/**
 * A bordered surface that groups one subject. With a `title` it gets a header row (title, a line
 * under it, actions on the right); without, it is just the box.
 *
 * `pad` sets the body's padding: `md` for prose and forms, `none` for a table or a list that runs
 * to the edges.
 */
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  pad?: 'none' | 'sm' | 'md';
  /** Tinted surface for something set apart — a callout, a nested panel. */
  tone?: 'default' | 'muted';
  as?: 'div' | 'section' | 'article';
}

export function Card({ title, sub, actions, pad, tone = 'default', as: Tag = 'div', className, children, ...rest }: CardProps) {
  const hasHead = title != null || actions != null;
  const bodyPad = pad ?? (hasHead ? 'md' : 'none');
  return (
    <Tag className={cx('panel', tone === 'muted' && 'muted-surface', className)} {...rest}>
      {hasHead && (
        <div className="panel-head">
          <div className="panel-title">
            {title != null && <h3>{title}</h3>}
            {sub != null && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {bodyPad === 'none' ? children : <div className={cx('panel-body', bodyPad === 'sm' && 'sm')}>{children}</div>}
    </Tag>
  );
}

/**
 * A figure with its label, for a row of summary tiles. With `onClick` the whole tile is the
 * button — it filters or navigates to what it counts.
 */
export function Stat({ label, value, sub, tone, onClick, title }: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'success' | 'warning' | 'danger';
  onClick?: () => void;
  title?: string;
}) {
  const inner = (
    <>
      <div className="lbl">{label}</div>
      <div className={cx('val', tone && `tone-${tone}`)}>{value}</div>
      {sub != null && <div className="sub">{sub}</div>}
    </>
  );
  return onClick
    ? <ButtonBase className="stat stat-btn" onClick={onClick} title={title}>{inner}</ButtonBase>
    : <div className="stat" title={title}>{inner}</div>;
}

/**
 * A boxed message inside a page: what is true, and usually what to do about it. The tone is in the
 * left rule and the icon, never in the colour of the text alone.
 */
export function Callout({ tone = 'info', icon, title, children, actions, className }: {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('callout', tone, className)} role={tone === 'danger' ? 'alert' : undefined}>
      {icon && <span className="callout-ico" aria-hidden="true">{icon}</span>}
      <div className="callout-body">
        {title && <div className="callout-title">{title}</div>}
        {children}
      </div>
      {actions && <div className="callout-actions">{actions}</div>}
    </div>
  );
}
