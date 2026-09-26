import { Badge, I } from '../../components/ui';
import type { AuditEvent } from '../../api/types';
import { riskOf } from './lib';

// Risk badge for a legacy trail event — used by Access review.
export function RiskBadge({ e }: { e: AuditEvent }) {
  const r = riskOf(e);
  if (r.level === 'none') return null;
  return <Badge tone={r.tone || undefined} mono={false} title={`${r.level === 'critical' ? 'Critical' : 'Elevated'} risk · ${r.label}`}><span className="chip-ico">{r.level === 'critical' ? I.alert : I.info}</span>{r.label}</Badge>;
}
