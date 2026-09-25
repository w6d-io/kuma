import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

/**
 * Switches between views of one thing. A real tablist: one tab in the tab order, the arrow keys move
 * between them (wrapping), Home and End jump to the ends — so a keyboard gets through four tabs with
 * one Tab press instead of four.
 *
 * The panel is the caller's: render the selected view below. `idBase` ties each tab to its panel
 * (`${idBase}-panel-${value}`) when the caller gives the panel that id.
 *
 * Tabs switch VIEWS. For a setting with a few values — a time window, a filter — use `Segmented`.
 */
export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
}

export function Tabs<V extends string>({ items, value, onChange, label, idBase, full, className }: {
  items: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Names the set of tabs for a reader. */
  label: string;
  idBase?: string;
  /** Tabs share the width equally — inside a drawer. */
  full?: boolean;
  className?: string;
}) {
  const refs = useRef(new Map<V, HTMLButtonElement>());
  const enabled = items.filter((i) => !i.disabled);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = enabled.findIndex((i) => i.value === value);
    const next =
      e.key === 'ArrowRight' ? enabled[(at + 1) % enabled.length]
      : e.key === 'ArrowLeft' ? enabled[(at - 1 + enabled.length) % enabled.length]
      : e.key === 'Home' ? enabled[0]
      : e.key === 'End' ? enabled[enabled.length - 1]
      : undefined;
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={cx('tabs', full && 'full', className)} onKeyDown={onKeyDown}>
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            ref={(el) => { if (el) refs.current.set(it.value, el); else refs.current.delete(it.value); }}
            type="button"
            role="tab"
            id={idBase ? `${idBase}-tab-${it.value}` : undefined}
            aria-controls={idBase ? `${idBase}-panel-${it.value}` : undefined}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            disabled={it.disabled}
            className={cx('tab', on && 'on')}
            onClick={() => onChange(it.value)}
          >
            {it.icon && <span className="tab-ico" aria-hidden="true">{it.icon}</span>}
            {it.label}
            {it.count != null && <span className="tab-count">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A setting with a few values, all visible — the value is pressed. Each option is a button with
 * `aria-pressed`, grouped under a label, so it reads as one control with a state.
 */
export function Segmented<V extends string>({ options, value, onChange, label, size = 'sm', className }: {
  options: { value: V; label: ReactNode; icon?: ReactNode; count?: number; title?: string }[];
  value: V;
  onChange: (value: V) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx('segmented', size, className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          className={cx('seg-opt', o.value === value && 'on')}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <span className="tab-ico" aria-hidden="true">{o.icon}</span>}
          {o.label}
          {o.count != null && <span className="tab-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
