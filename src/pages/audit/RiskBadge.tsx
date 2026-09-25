import { Badge, I } from '../../components/ui';
import type { AuditEvent } from '../../api/types';
import { riskOf, type Trend } from './lib';

// Reusable risk badge — used on the Audit log, both entity trails, and Signals.
export function RiskBadge({ e }: { e: AuditEvent }) {
  const r = riskOf(e);
  if (r.level === 'none') return null;
  return <Badge tone={r.tone || undefined} mono={false} title={`${r.level === 'critical' ? 'Critical' : 'Elevated'} risk · ${r.label}`}><span className="chip-ico">{r.level === 'critical' ? I.alert : I.info}</span>{r.label}</Badge>;
}

export function TrendPill({ t }: { t: Trend }) {
  if (!t) return null;
  const glyph = <span className="kv-ico">{t.dir === 'up' ? I.trendUp : t.dir === 'down' ? I.trendDown : I.trendFlat}</span>;
  return <span className="small muted mono">{glyph} {t.pct}%</span>;
}
