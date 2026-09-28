import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { ButtonBase } from './Button';
import { cx } from './cx';

/**
 * The two chart shapes the console draws, in SVG with no library (home-design §6): stacked bars over
 * time and a share meter. Colours come from `--chart-pass` / `--chart-fail` through classes, so both
 * themes and the contrast test hold; `forced-colors` gets a hatch on the second series.
 */

export interface Bucket { t: string; a: number; b?: number }

const GRID = 3;

/** A round top for the axis: three gridlines at a readable step (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ). */
function niceMax(v: number): number {
  if (v <= 0) return GRID;
  const raw = v / GRID;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((x) => x >= raw) ?? 10 * p;
  return Math.max(1, Math.ceil(step)) * GRID;
}

const fmtTime = (t: string, long: boolean) => {
  const d = new Date(t);
  return Number.isNaN(+d) ? t : long
    ? d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * Stacked bars, series `a` under series `b`, one per bucket. One bar is in the tab order at a time;
 * the arrow keys move between them (Home / End jump), and the focused or hovered bar shows its
 * figures. With `hrefOf` a bar is a link (to the audit log zoomed on that bucket). "View as table"
 * gives the same figures as rows.
 */
export function BarSeries({ buckets, labels, summary, hrefOf, height = 120, spanDays = false, className }: {
  buckets: Bucket[];
  labels: { a: string; b?: string };
  /** What a screen reader hears for the whole chart: "Sign-ins, last 24 h: 342, 21 failed". */
  summary: string;
  hrefOf?: (t: string) => string;
  height?: number;
  /** Buckets span hours of several days: ticks and tooltips name the day. */
  spanDays?: boolean;
  className?: string;
}) {
  const [at, setAt] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState(buckets.length - 1);
  const [table, setTable] = useState(false);
  const refs = useRef<(HTMLElement | SVGElement | null)[]>([]);
  // useId has characters an SVG `url(#…)` reference cannot carry.
  const tableId = `bars${useId().replace(/[^\w-]/g, "")}`;
  const max = niceMax(Math.max(0, ...buckets.map((x) => x.a + (x.b ?? 0))));
  const n = Math.max(1, buckets.length);
  const w = 100 / n;
  const gap = Math.min(w * 0.2, 0.6);
  const y = (v: number) => (v / max) * height;
  const tickEvery = Math.max(1, Math.round(n / 4));

  function onKey(e: KeyboardEvent) {
    const next = e.key === 'ArrowRight' ? Math.min(n - 1, focusIdx + 1)
      : e.key === 'ArrowLeft' ? Math.max(0, focusIdx - 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next == null) return;
    e.preventDefault();
    setFocusIdx(next);
    setAt(next);
    refs.current[next]?.focus();
  }

  const shown = at != null ? buckets[at] : null;
  const words = (x: Bucket) => `${fmtTime(x.t, true)}: ${x.a.toLocaleString()} ${labels.a}${labels.b ? `, ${(x.b ?? 0).toLocaleString()} ${labels.b}` : ''}`;

  return (
    <div className={cx('bars', className)}>
      <div className="bars-legend" aria-hidden="true">
        <span className="bars-key is-a">{labels.a}</span>
        {labels.b && <span className="bars-key is-b">{labels.b}</span>}
      </div>
      <div className="bars-plot" style={{ height }}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="group" aria-label={summary} onKeyDown={onKey} onMouseLeave={() => setAt(null)}>
          <defs>
            <pattern id={`${tableId}-hatch`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" className="bars-hatch" />
            </pattern>
          </defs>
          {Array.from({ length: GRID }, (_, i) => (
            <line key={i} className="bars-grid" x1={0} x2={100} y1={height - ((i + 1) / GRID) * height} y2={height - ((i + 1) / GRID) * height} vectorEffect="non-scaling-stroke" />
          ))}
          {buckets.map((x, i) => {
            const ha = y(x.a);
            const hb = y(x.b ?? 0);
            const bar = (
              <>
                <rect className="bars-hit" x={i * w} y={0} width={w} height={height} />
                <rect className="bars-a" x={i * w + gap / 2} y={height - ha} width={w - gap} height={ha} />
                {hb > 0 && <rect className="bars-b" x={i * w + gap / 2} y={height - ha - hb} width={w - gap} height={hb} />}
                {hb > 0 && <rect className="bars-b-hatch" fill={`url(#${tableId}-hatch)`} x={i * w + gap / 2} y={height - ha - hb} width={w - gap} height={hb} />}
              </>
            );
            const common = {
              ref: (el: HTMLElement | SVGElement | null) => { refs.current[i] = el; },
              className: cx('bars-bar', at === i && 'on'),
              tabIndex: i === focusIdx ? 0 : -1,
              'aria-label': words(x),
              onMouseEnter: () => setAt(i),
              onFocus: () => { setAt(i); setFocusIdx(i); },
              onBlur: () => setAt(null),
            };
            return hrefOf
              ? <a key={x.t} href={hrefOf(x.t)} {...common}>{bar}</a>
              : <g key={x.t} role="img" {...common}>{bar}</g>;
          })}
        </svg>
        <div className="bars-axis-y" aria-hidden="true">
          {Array.from({ length: GRID }, (_, i) => (
            <span key={i} style={{ bottom: `${((i + 1) / GRID) * 100}%` }}>{Math.round(((i + 1) / GRID) * max).toLocaleString()}</span>
          ))}
        </div>
        {shown && at != null && (
          <div className={cx('bars-tip', at > n / 2 && 'left')} style={{ left: `${(at + 0.5) * w}%` }} aria-hidden="true">
            <div className="bars-tip-t">{fmtTime(shown.t, true)}</div>
            <div><span className="bars-key is-a">{labels.a}</span> {shown.a.toLocaleString()}</div>
            {labels.b && <div><span className="bars-key is-b">{labels.b}</span> {(shown.b ?? 0).toLocaleString()}</div>}
          </div>
        )}
      </div>
      <div className="bars-axis-x" aria-hidden="true">
        {buckets.map((x, i) => (i % tickEvery === 0 ? <span key={x.t} style={{ left: `${i * w}%` }}>{fmtTime(x.t, spanDays)}</span> : null))}
      </div>
      <ButtonBase className="bars-table-toggle" aria-expanded={table} aria-controls={tableId} onClick={() => setTable((v) => !v)}>
        {table ? 'Hide table' : 'View as table'}
      </ButtonBase>
      {table && (
        <div id={tableId} className="table-scroll">
          <table className="table compact">
            <thead><tr><th scope="col">From</th><th scope="col" className="align-right">{labels.a}</th>{labels.b && <th scope="col" className="align-right">{labels.b}</th>}</tr></thead>
            <tbody>
              {buckets.map((x) => (
                <tr key={x.t}><td>{fmtTime(x.t, true)}</td><td className="align-right tabular">{x.a.toLocaleString()}</td>{labels.b && <td className="align-right tabular">{(x.b ?? 0).toLocaleString()}</td>}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * A share of a whole as a thin bar, neutral fill, with the figure in words beside it — the bar is
 * never the only carrier of the number.
 */
export function Meter({ value, of, label, className }: { value: number; of: number; label: string; className?: string }) {
  const pct = of > 0 ? Math.round((value / of) * 100) : 0;
  return (
    <span className={cx('meter', className)}>
      <span className="meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={of} aria-valuenow={value} aria-valuetext={`${pct}%, ${value.toLocaleString()} of ${of.toLocaleString()}`}>
        <span className="meter-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="meter-text tabular">{pct}% <span className="muted">({value.toLocaleString()} of {of.toLocaleString()})</span></span>
    </span>
  );
}
