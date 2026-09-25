import type { ReactNode, TableHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from './cx';
import { I } from './Icons';
import { SkeletonRows } from './Skeleton';

/**
 * Tables stay markup — `<Table><thead>…</thead><tbody>…</tbody></Table>` — because every table here
 * has cells of its own. The kit gives them one look, a sortable header cell, and the two rows every
 * table needs: nothing to show, and still loading.
 *
 * Wrapped in a scroll box so a wide table scrolls inside itself and never widens the page.
 */
export function Table({ className, children, wrap = true, ...rest }: TableHTMLAttributes<HTMLTableElement> & { wrap?: boolean }) {
  const table = <table className={cx('table', className)} {...rest}>{children}</table>;
  return wrap ? <div className="table-scroll">{table}</div> : table;
}

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string = string> { key: K; dir: SortDir }

/** A column clicked: ascending first, then flipping; a new column starts ascending again. */
export function nextSort<K extends string>(current: SortState<K> | null, key: K): SortState<K> {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** A sorted copy. Numbers as numbers, text by locale; ties keep their order; empty values last. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => unknown, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => {
      const empty = (x: unknown) => x === null || x === undefined || x === '';
      if (empty(a.v) || empty(b.v)) return empty(a.v) === empty(b.v) ? a.i - b.i : empty(a.v) ? 1 : -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.row);
}

/**
 * A header cell. Given `sortKey` and `onSort` it becomes a button that asks to sort by that column,
 * and says through `aria-sort` which way the column is sorted now.
 */
export function Th<K extends string>({ sortKey, sort, onSort, align, className, children, ...rest }: Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> & {
  sortKey?: K;
  sort?: SortState<K> | null;
  onSort?: (key: K) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const sortable = sortKey != null && onSort != null;
  const active = sortable && sort?.key === sortKey;
  const ariaSort = !sortable ? undefined : active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th aria-sort={ariaSort} className={cx(align && `align-${align}`, className)} {...rest}>
      {sortable
        ? (
          <button type="button" className={cx('th-sort', active && 'on')} onClick={() => onSort(sortKey)}>
            {children}
            <span className="th-sort-ico" aria-hidden="true">{active ? (sort!.dir === 'asc' ? I.caretUp : I.caret) : I.caret}</span>
          </button>
        )
        : children}
    </th>
  );
}

/** The row a table shows when it has none. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return <tr className="empty-row"><td colSpan={colSpan}>{children}</td></tr>;
}

/** Placeholder rows at the table's real column count, so nothing moves when the data lands. */
export function LoadingRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return <SkeletonRows cols={cols} rows={rows} />;
}
