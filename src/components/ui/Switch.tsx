import { cx } from './cx';

/**
 * An on/off setting that takes effect at once. `role="switch"` so a reader says "on" or "off"
 * rather than "pressed"; `label` names it when no visible text does.
 */
export function Switch({ on, onChange, label, disabled, id, className }: {
  on: boolean;
  onChange: (on: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label ?? 'Toggle'}
      disabled={disabled}
      className={cx('switch', on && 'on', className)}
      onClick={() => onChange(!on)}
    />
  );
}
