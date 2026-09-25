import { createContext, useContext, useId, type AriaAttributes, type ReactNode } from 'react';
import { cx } from './cx';

/**
 * A label, the control it names, and what is said about the value: a hint, a warning, an error.
 *
 * The control inside reads the field from context, so `<Field label="Email"><Input /></Field>` is
 * enough to tie the label to the input and the messages to `aria-describedby` — no ids to thread by
 * hand, and no way to forget one.
 *
 * A WARNING is not an error: the value is accepted and the form can go on ("this host is shared
 * with another site"). Only `error` marks the control invalid.
 */
interface FieldState {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldState | null>(null);

/** For a control: the id, description and state its field gives it, overridden by its own props. */
export function useFieldControl(own: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: AriaAttributes['aria-invalid']; required?: boolean; invalid?: boolean }) {
  const field = useContext(FieldContext);
  const invalid = own.invalid ?? field?.invalid ?? false;
  return {
    id: own.id ?? field?.id,
    'aria-describedby': [field?.describedBy, own['aria-describedby']].filter(Boolean).join(' ') || undefined,
    'aria-invalid': own['aria-invalid'] ?? (invalid || undefined),
    required: own.required ?? (field?.required || undefined),
    invalid,
  };
}

export interface FieldProps {
  label: ReactNode;
  /** The control's own id, when the caller needs to know it. Generated otherwise. */
  htmlFor?: string;
  hint?: ReactNode;
  warning?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Label beside the control rather than above it — for a switch or a checkbox row. */
  inline?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, warning, error, required = false, inline, className, children }: FieldProps) {
  const auto = useId();
  const id = htmlFor ?? findChildId(children) ?? `f${auto}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const warnId = warning ? `${id}-warn` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, warnId, errId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: !!error, required }}>
      <div className={cx('field', inline && 'inline', className)}>
        <label className="field-label" htmlFor={id}>
          {label}
          {required && <span className="field-required" aria-hidden="true"> *</span>}
        </label>
        <div className="field-control">{children}</div>
        {hint && <div id={hintId} className="field-hint">{hint}</div>}
        {warning && <div id={warnId} className="field-warning">{warning}</div>}
        {error && <div id={errId} className="field-error">{error}</div>}
      </div>
    </FieldContext.Provider>
  );
}

// A control that brings its own id keeps it: the label must point at what is really there.
function findChildId(children: ReactNode): string | undefined {
  const only = Array.isArray(children) ? undefined : children;
  if (only && typeof only === 'object' && 'props' in only) {
    const id = (only.props as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}
