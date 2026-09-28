import { useMemo, useState, type ReactNode } from 'react';
import { cx } from './cx';
import { I } from './Icons';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { Input } from './Input';
import { useFieldControl } from './Field';

/**
 * Many choices in named groups — scopes by site, permissions by resource — each group with its own
 * "all of them" box (partly ticked when some are), and a filter once the list is long.
 *
 * A group is a fieldset, so a screen reader names it before its boxes. The value is a set: an option
 * listed under two groups is one choice, ticked or cleared in both at once. The filter only hides
 * boxes; what is ticked stays ticked, and the count above says how many.
 */
export interface ChecklistOption { value: string; label: ReactNode; hint?: ReactNode; search?: string; disabled?: boolean }
export interface ChecklistGroup { id: string; label: ReactNode; hint?: ReactNode; options: ChecklistOption[] }

export function ChecklistGroups({ groups, value, onChange, label, searchAt = 12, searchLabel = 'Filter', className }: {
  groups: ChecklistGroup[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Names the whole set: "Scopes". */
  label: string;
  /** The filter appears once there are this many options. */
  searchAt?: number;
  searchLabel?: string;
  className?: string;
}) {
  // Inside a Field: its hint describes the whole group.
  const field = useFieldControl({});
  const [needle, setNeedle] = useState('');
  const picked = useMemo(() => new Set(value), [value]);
  const all = useMemo(() => [...new Set(groups.flatMap((g) => g.options.map((o) => o.value)))], [groups]);
  const q = needle.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, options: q ? g.options.filter((o) => (o.search ?? o.value).toLowerCase().includes(q)) : g.options }))
    .filter((g) => g.options.length > 0);

  const set = (values: string[], on: boolean) => {
    const next = new Set(picked);
    for (const v of values) {
      if (on) next.add(v);
      else next.delete(v);
    }
    onChange(all.filter((v) => next.has(v)).concat([...next].filter((v) => !all.includes(v))));
  };

  return (
    <div className={cx('checklist', className)} role="group" id={field.id} aria-label={label} aria-describedby={field['aria-describedby']}>
      <div className="checklist-head">
        <span className="checklist-count" aria-live="polite">{picked.size} of {all.length} selected</span>
        {all.length >= searchAt && (
          <Input size="sm" id={field.id ? `${field.id}-filter` : undefined} leading={I.search} aria-label={`${searchLabel} ${label.toLowerCase()}`} placeholder={`${searchLabel}…`} value={needle} onChange={(e) => setNeedle(e.target.value)} />
        )}
        {picked.size > 0 && <Button size="sm" variant="ghost" onClick={() => set([...picked], false)}>Clear</Button>}
      </div>
      {shown.length === 0 && <div className="empty-hint">Nothing matches “{needle}”.</div>}
      {shown.map((g) => {
        const values = g.options.filter((o) => !o.disabled).map((o) => o.value);
        const on = values.filter((v) => picked.has(v)).length;
        return (
          <fieldset key={g.id} className="checklist-group">
            <legend className="sr-only">{g.label}</legend>
            {values.length > 1 ? (
              <Checkbox
                className="checklist-all"
                checked={on === values.length}
                indeterminate={on > 0 && on < values.length}
                onChange={(v) => set(values, v)}
                label={<span className="fw-medium">{g.label}</span>}
                hint={g.hint ?? `${on} of ${values.length}${q ? ' shown' : ''}`}
              />
            ) : (
              <div className="checklist-title">
                <span className="fw-medium">{g.label}</span>
                {g.hint && <span className="checkbox-hint">{g.hint}</span>}
              </div>
            )}
            <div className="checklist-options">
              {g.options.map((o) => (
                <Checkbox key={o.value} size="sm" checked={picked.has(o.value)} disabled={o.disabled} onChange={(v) => set([o.value], v)} label={o.label} hint={o.hint} />
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
