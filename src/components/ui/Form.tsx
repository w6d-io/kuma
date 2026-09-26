import { Children, isValidElement, type CSSProperties, type ReactNode } from 'react';
import { cx } from './cx';
import { Field } from './Field';

/**
 * The layout of a form, so no screen lines up its own fields.
 *
 * `FormGrid` stacks fields at one rhythm (`--field-gap`). With `labels="aside"` every label moves
 * into one column as wide as the longest of them, and every control, checkbox and message into the
 * column beside it: the controls start on one vertical line whatever their labels say.
 *
 * `FieldRow` puts fields side by side — service | namespace | port — on three shared lines: labels,
 * controls, messages. A label that wraps or a hint under one field moves nothing in the others.
 * Widths are shares (`<Field span={2}>`); anything that is not a Field (a button, a checkbox) sits
 * on the controls' line, centred on it. Below 640 px the fields stack.
 */
export function FormGrid({ labels = 'above', className, children }: {
  labels?: 'above' | 'aside';
  className?: string;
  children: ReactNode;
}) {
  return <div className={cx('form-grid', labels === 'aside' && 'aside', className)}>{children}</div>;
}

export function FieldRow({ cols, className, children }: {
  /** A grid template of your own, for a field wrapped in another component. Derived otherwise. */
  cols?: string;
  className?: string;
  children: ReactNode;
}) {
  // One column per child: a Field takes its share of what is left, anything else its own width.
  const template = cols ?? Children.toArray(children).filter(isValidElement).map((c) => {
    if (c.type !== Field) return 'max-content';
    const span = (c.props as { span?: number }).span ?? 1;
    return `minmax(0, ${span}fr)`;
  }).join(' ');
  return <div className={cx('form-row', className)} style={{ '--form-cols': template } as CSSProperties}>{children}</div>;
}

/**
 * A row of controls over a list or a panel: search, filters, then — after the spacer — what acts on
 * the result. One height (`size`, sm by default) so every piece shares a centre line.
 */
export function Toolbar({ size = 'sm', label, inset = false, className, children }: {
  size?: 'sm' | 'md';
  /** Drawn as the top strip of a Card, ruled off from the table under it. */
  inset?: boolean;
  /** Names the toolbar for a screen reader when there is more than one on the screen. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return <div role="toolbar" aria-label={label} className={cx('toolbar', size, inset && 'inset', className)}>{children}</div>;
}

/** Pushes what follows to the far end of a Toolbar. */
export function ToolbarSpacer() {
  return <span className="toolbar-spacer" aria-hidden="true" />;
}

/**
 * The buttons that finish a form: right-aligned, primary last, on one baseline. `start` holds what
 * sits apart at the other end — a destructive action or a note.
 */
export function ActionBar({ start, align = 'end', divider = false, className, children }: {
  start?: ReactNode;
  /** `start` for the buttons under a form in a page's flow rather than at the foot of a panel. */
  align?: 'start' | 'end';
  divider?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx('action-bar', align === 'start' && 'start', divider && 'divider', className)}>
      {start && <div className="action-bar-start">{start}</div>}
      <div className="action-bar-end">{children}</div>
    </div>
  );
}
