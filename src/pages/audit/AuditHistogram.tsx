import type { AuditWindowSummary } from '../../api/audit';
import { Skeleton } from '../../components/ui';
import { bucketMs, toBars } from '../../lib/audit/histogram';

const H = 40;

/**
 * Events over the selected range, failures overlaid. Drawn in SVG (attributes, not inline styles);
 * each bar is a button that zooms the range to its bucket.
 */
export function AuditHistogram({ summary, loading, onZoom }: {
  summary: AuditWindowSummary | undefined; loading: boolean; onZoom: (bucketStart: string, ms: number) => void;
}) {
  if (loading) return <div className="audit-histo"><Skeleton h={H} /></div>;
  const series = summary?.series ?? [];
  if (!series.length) return null;
  const bars = toBars(series, H);
  const ms = bucketMs(series);
  const w = 100 / bars.length;
  return (
    <div className="audit-histo">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" role="group" aria-label="Events over time — select a bar to zoom">
        {bars.map((b, i) => (
          <g key={b.t} className="audit-bar" role="button" tabIndex={0}
            aria-label={`${new Date(b.t).toLocaleString()}: ${b.total} events, ${b.failed} failed`}
            onClick={() => onZoom(b.t, ms)}
            onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onZoom(b.t, ms); } }}>
            <title>{`${new Date(b.t).toLocaleString()} · ${b.total} events${b.failed ? ` · ${b.failed} failed` : ''}`}</title>
            <rect className="audit-bar-hit" x={i * w} y={0} width={w} height={H} />
            <rect className="audit-bar-total" x={i * w + w * 0.1} y={H - b.h} width={w * 0.8} height={b.h} />
            {b.hf > 0 && <rect className="audit-bar-failed" x={i * w + w * 0.1} y={H - b.hf} width={w * 0.8} height={b.hf} />}
          </g>
        ))}
      </svg>
    </div>
  );
}
