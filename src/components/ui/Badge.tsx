import { Children, type ReactNode } from 'react';
import { cx } from './cx';

/**
 * A short label on a thing: a state, a count, a name.
 *
 * No label is ever pill-shaped. What a label means picks how it is drawn, and most of them get no
 * container at all:
 *
 *   status   a coloured tone (success, warning, danger, info, accent) — a 6px square marker, or the
 *            icon when one is given, then the words in the tone colour. No box. "■ Live", "▲ High risk".
 *            Severity and risk are statuses with an icon; a row that carries one also gets the 3px
 *            left accent bar (see `.audit-row.is-fail`). Verdicts are statuses with a check / cross.
 *   tag      `neutral` — an identifier: a group, role, permission, scope, rule id. Monospace in a
 *            square-cornered (--radius-sm) subtle box, so a list of them reads as a set of tokens.
 *            `plain` + mono is the same box, outline only.
 *   meta     `plain` + `mono={false}` — draft, system, customized, member: small caps, muted, with
 *            its icon if it has one. It says something about the thing, not its health.
 *   count    a bare number ("12", "+3", "+3 more") — tabular, muted, no box.
 *
 * The role is inferred from `tone`, `mono` and the children; `variant` forces one. A state must be
 * said in the words (or icon + words), never by the colour alone.
 */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'plain';
export type BadgeVariant = 'status' | 'tag' | 'meta' | 'count';

const COUNT = /^[+−-]?\s?\d[\d\s,.]*(?:\s?more)?$/;

function textOf(children: ReactNode): string | null {
  const parts = Children.toArray(children);
  return parts.every((p) => typeof p === 'string' || typeof p === 'number') ? parts.join('') : null;
}

function badgeVariant(tone: BadgeTone, mono: boolean, children: ReactNode): BadgeVariant {
  if (tone !== 'neutral' && tone !== 'plain') return 'status';
  const text = textOf(children);
  if (text != null && COUNT.test(text.trim())) return 'count';
  return tone === 'plain' && !mono ? 'meta' : 'tag';
}

export function Badge({ tone = 'neutral', mono = true, variant, icon, title, className, children }: {
  tone?: BadgeTone;
  mono?: boolean;
  variant?: BadgeVariant;
  icon?: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const v = variant ?? badgeVariant(tone, mono, children);
  return (
    <span className={cx('badge', `is-${v}`, tone !== 'neutral' && tone, !mono && 'sans', icon != null && 'has-ico', className)} title={title}>
      {icon && <span className="badge-ico" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}

/** A key on the keyboard, written the way the screen expects it to be pressed. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
