import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import { useFieldControl } from './Field';

/**
 * Text inputs, selects and text areas. Same height as a button of the same size, so a toolbar of
 * mixed controls lines up; `mono` for identifiers, paths and anything else that is copied exactly.
 *
 * Inside a `Field` they pick up their id, description and invalid state from it.
 */
type ControlSize = 'sm' | 'md';

interface Shared {
  size?: ControlSize;
  mono?: boolean;
  /** Marks the value refused without a Field around it. */
  invalid?: boolean;
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, Shared {
  /** An icon inside the box, before the text — a magnifier on a search field. */
  leading?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ size = 'md', mono, invalid, leading, className, ref, ...rest }: InputProps) {
  const field = useFieldControl({ ...rest, invalid });
  const { invalid: isInvalid, ...aria } = field;
  const input = (
    <input
      ref={ref}
      {...rest}
      {...aria}
      className={cx('input', size, mono && 'mono', isInvalid && 'invalid', leading ? 'has-lead' : undefined, className)}
    />
  );
  if (!leading) return input;
  return (
    <span className={cx('input-wrap', size)}>
      <span className="input-lead" aria-hidden="true">{leading}</span>
      {input}
    </span>
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>, Shared {
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ size = 'md', mono, invalid, className, ref, children, ...rest }: SelectProps) {
  const { invalid: isInvalid, ...aria } = useFieldControl({ ...rest, invalid });
  return (
    <select ref={ref} {...rest} {...aria} className={cx('input', 'select', size, mono && 'mono', isInvalid && 'invalid', className)}>
      {children}
    </select>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, Omit<Shared, 'size'> {
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ mono, invalid, className, ref, ...rest }: TextareaProps) {
  const { invalid: isInvalid, ...aria } = useFieldControl({ ...rest, invalid });
  return <textarea ref={ref} {...rest} {...aria} className={cx('input', 'textarea', mono && 'mono', isInvalid && 'invalid', className)} />;
}
