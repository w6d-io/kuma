import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * Before and after, field by field — the review step of anything that changes configuration.
 * Each field is changed, added, removed or unchanged; unchanged ones are hidden unless asked for,
 * because the point of a review is the part that moves.
 *
 * Values are compared by content (lists and objects too) and shown as text: a list joined with
 * commas, an object as JSON.
 */
export type DiffKind = 'same' | 'changed' | 'added' | 'removed';

export interface FieldDiff {
  key: string;
  label: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

type Record_ = Record<string, unknown>;

export function diffFields(before: Record_, after: Record_, labels: Record<string, string> = {}): FieldDiff[] {
  const keys = [...Object.keys(before), ...Object.keys(after).filter((k) => !(k in before))];
  return keys.map((key) => {
    const inB = key in before;
    const inA = key in after;
    const kind: DiffKind = !inA ? 'removed' : !inB ? 'added' : same(before[key], after[key]) ? 'same' : 'changed';
    return { key, label: labels[key] ?? key, kind, before: before[key], after: after[key] };
  });
}

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function show(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) return v.map(show).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const WORD: Record<DiffKind, string> = { same: 'unchanged', changed: 'changed', added: 'added', removed: 'removed' };

export function DiffView({ before, after, labels, showUnchanged, title, className }: {
  before: Record_;
  after: Record_;
  labels?: Record<string, string>;
  showUnchanged?: boolean;
  title?: ReactNode;
  className?: string;
}) {
  const rows = diffFields(before, after, labels).filter((f) => showUnchanged || f.kind !== 'same');
  return (
    <div className={cx('diffview', className)}>
      {title && <div className="diffview-title">{title}</div>}
      {rows.length === 0
        ? <div className="diffview-none">No changes.</div>
        : (
          <dl className="diffview-list">
            {rows.map((f) => (
              <div key={f.key} className={cx('diffview-row', f.kind)}>
                <dt>{f.label}<span className="diffview-kind">{WORD[f.kind]}</span></dt>
                <dd>
                  {f.kind !== 'added' && f.kind !== 'same' && <del className="diffview-before">{show(f.before)}</del>}
                  {f.kind === 'same' && <span className="diffview-same">{show(f.after)}</span>}
                  {f.kind !== 'removed' && f.kind !== 'same' && <ins className="diffview-after">{show(f.after)}</ins>}
                </dd>
              </div>
            ))}
          </dl>
        )}
    </div>
  );
}
