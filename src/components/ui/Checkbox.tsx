import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * A native checkbox with its label around it, so the whole line is the target.
 * `onChange` hands back the new state rather than the event. `indeterminate` draws a partial
 * selection — a "select all" over a list that is only partly selected.
 */
export function Checkbox({ checked, indeterminate, onChange, label, hint, disabled, className, name, value, id }: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  name?: string;
  value?: string;
  id?: string;
}) {
  return (
    <label className={cx('checkbox', disabled && 'disabled', className)}>
      <input
        id={id}
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        // The DOM property only: there is no attribute for it.
        ref={(el) => { if (el) el.indeterminate = !!indeterminate; }}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="checkbox-text">
        <span className="checkbox-label">{label}</span>
        {hint && <span className="checkbox-hint">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * One choice out of a few, all visible, each with room for a line of explanation. Native radios
 * under a `radiogroup`, so arrow keys move the choice the way every platform does.
 */
export function RadioGroup<V extends string>({ label, name, value, onChange, options, disabled, className }: {
  label: string;
  name: string;
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: ReactNode; hint?: ReactNode; disabled?: boolean }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('radio-group', className)}>
      {options.map((o) => (
        <label key={o.value} className={cx('checkbox', (disabled || o.disabled) && 'disabled')}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            disabled={disabled || o.disabled}
            onChange={() => onChange(o.value)}
          />
          <span className="checkbox-text">
            <span className="checkbox-label">{o.label}</span>
            {o.hint && <span className="checkbox-hint">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
