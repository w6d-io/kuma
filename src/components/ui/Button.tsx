import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx';

/**
 * The console's buttons. Four variants in two sizes, and nothing else.
 *
 *   primary    the one thing a screen is for — at most one per view
 *   secondary  every other action (the default)
 *   ghost      actions that sit inside content: row actions, close, "load more"
 *   danger     removes or revokes something; the confirm step says what
 *
 * `md` (36px) is for page headers, forms and dialog footers; `sm` (28px) for toolbars, table rows
 * and anything inside a card header.
 *
 * `type` defaults to "button". A bare `<button>` defaults to "submit", and inside a form that turns
 * an innocent click — a tab, a disclosure — into a submission.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'>;

export interface ButtonProps extends Native {
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: 'button' | 'submit' | 'reset';
  /** Drawn before the label. */
  icon?: ReactNode;
  /** Drawn after the label — a caret, an external-link arrow. */
  trailing?: ReactNode;
  /** A square button with only the icon. Needs `aria-label`: there is no text to read. */
  iconOnly?: boolean;
  /** Busy: disabled, announced, and a spinner in place of the icon. The label stays, so the width does. */
  loading?: boolean;
  /** A keyboard hint drawn at the end: `⌘↵`. */
  kbd?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary', size = 'md', type = 'button', icon, trailing, iconOnly, loading, kbd,
  disabled, className, children, ref, ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', variant !== 'secondary' && variant, size, iconOnly && 'icon-only', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon && <span className="btn-ico" aria-hidden="true">{icon}</span>}
      {!iconOnly && children}
      {trailing && <span className="btn-ico" aria-hidden="true">{trailing}</span>}
      {kbd && <kbd className="btn-kbd">{kbd}</kbd>}
    </button>
  );
}

/**
 * A button with no look of its own, for a clickable surface the kit does not draw: a navigation
 * row, a selectable card, a list item. Still a real button — focusable, `type="button"`, and the
 * focus ring every button gets.
 */
export interface ButtonBaseProps extends Native {
  type?: 'button' | 'submit' | 'reset';
  ref?: Ref<HTMLButtonElement>;
}

export function ButtonBase({ type = 'button', className, ref, ...rest }: ButtonBaseProps) {
  return <button ref={ref} type={type} className={cx('btn-base', className)} {...rest} />;
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
