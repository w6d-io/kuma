import { useState } from 'react';
import { I } from './Icons';
import { Button } from './Button';
import { Select } from './Input';
import { cx } from './cx';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  sizes?: number[];
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, sizes = [10, 25, 50, 100] }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  const pages = buildPageNumbers(page, totalPages);

  return (
    <div className="pagination">
      <div className="row">
        <span className="small muted mono">{from}–{to} of {total}</span>
        {onPageSizeChange && (
          <Select size="sm" className="w-auto" aria-label="Rows per page" value={pageSize} onChange={e => { onPageSizeChange(Number(e.target.value)); onPageChange(0); }}>
            {sizes.map(s => <option key={s} value={s}>{s} / page</option>)}
          </Select>
        )}
      </div>
      <nav className="pagination-pages" aria-label="Pages">
        <Button size="sm" variant="ghost" iconOnly icon={I.caretLeft} aria-label="Previous page" title="Previous" disabled={page === 0} onClick={() => onPageChange(page - 1)} />
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} className="pagination-gap">…</span>
          ) : (
            <Button
              key={p}
              size="sm"
              variant={p === page ? 'secondary' : 'ghost'}
              className={cx('icon-only', p === page && 'on')}
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onPageChange(p as number)}
            >
              {(p as number) + 1}
            </Button>
          )
        )}
        <Button size="sm" variant="ghost" iconOnly icon={I.chev} aria-label="Next page" title="Next" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)} />
      </nav>
    </div>
  );
}

function buildPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const pages: (number | '...')[] = [0];
  if (current > 2) pages.push('...');
  for (let i = Math.max(1, current - 1); i <= Math.min(total - 2, current + 1); i++) pages.push(i);
  if (current < total - 3) pages.push('...');
  pages.push(total - 1);
  return pages;
}

export function usePagination(total: number, defaultSize = 25) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(defaultSize);
  const effectivePage = page * pageSize >= total ? 0 : page;
  const from = effectivePage * pageSize;
  const to = Math.min(from + pageSize, total);
  return { page: effectivePage, pageSize, setPage, setPageSize, from, to, total };
}
