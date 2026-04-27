import { useState } from 'react';
import { I } from './Icons';

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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderTop: "1px solid var(--line)", fontSize: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="small muted mono">{from}–{to} of {total}</span>
        {onPageSizeChange && (
          <select className="input" style={{ width: "auto", padding: "2px 6px", fontSize: 11 }} value={pageSize} onChange={e => { onPageSizeChange(Number(e.target.value)); onPageChange(0); }}>
            {sizes.map(s => <option key={s} value={s}>{s} / page</option>)}
          </select>
        )}
      </div>
      <div className="row" style={{ gap: 2 }}>
        <PgBtn disabled={page === 0} onClick={() => onPageChange(page - 1)} title="Previous">
          <span style={{ transform: "rotate(180deg)", display: "grid", placeItems: "center" }}>{I.chev}</span>
        </PgBtn>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} style={{ padding: "0 4px", color: "var(--ink-4)" }}>…</span>
          ) : (
            <PgBtn key={p} active={p === page} onClick={() => onPageChange(p as number)}>
              {(p as number) + 1}
            </PgBtn>
          )
        )}
        <PgBtn disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)} title="Next">
          {I.chev}
        </PgBtn>
      </div>
    </div>
  );
}

function PgBtn({ children, disabled, active, onClick, title }: { children: React.ReactNode; disabled?: boolean; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={title}
      style={{
        width: 28, height: 28, borderRadius: "var(--radius)",
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        background: active ? "var(--accent)" : "var(--panel)",
        color: active ? "white" : disabled ? "var(--ink-4)" : "var(--ink)",
        display: "grid", placeItems: "center", cursor: disabled ? "default" : "pointer",
        fontSize: 11, fontWeight: active ? 600 : 400, opacity: disabled ? 0.4 : 1,
      }}>
      {children}
    </button>
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
