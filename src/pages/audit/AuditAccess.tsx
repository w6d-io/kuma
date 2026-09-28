import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditApi, auditErrorKind, type GatewayAccess } from '../../api/audit';
import { Button, Callout, Card, Checkbox, EmptyRow, I, SkeletonText, Stat, Table, Th } from '../../components/ui';
import { ActorCell } from './Actor';
import { AuditHistogram } from './AuditHistogram';
import { AuditError } from './AuditTimeline';

const n = (x: number) => x.toLocaleString();

/**
 * What the gateway let through and what it refused, by person and host (`GET /audit/access`).
 *
 * The event log holds refusals and changes; this is the other half — every request the gateway
 * decided, counted rather than listed (one line per request would be tens of thousands a day).
 * Unauthenticated traffic is almost all scanners: counted apart, its hosts shown only on request.
 */
export function AuditAccess({ range, onOpenUser }: { range: { from: string; to: string }; onOpenUser: (id: string) => void }) {
  const [showAnon, setShowAnon] = useState(false);
  const q = useQuery({
    queryKey: ['audit', 'log', 'access', range],
    queryFn: () => auditApi.gatewayAccess(range),
    retry: (count, err) => auditErrorKind(err) === 'store-down' && count < 1,
    staleTime: 60_000,
  });

  if (q.isError) {
    if ((q.error as { status?: number } | null)?.status === 403) {
      return <Callout tone="info" icon={I.info} title="For platform readers">Gateway decisions name no organisation, so they cannot be cut to yours. Your organisation&rsquo;s events are under Events.</Callout>;
    }
    return <AuditError error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!q.data) return <Card pad="md"><SkeletonText lines={5} /></Card>;
  return <AccessView data={q.data} showAnon={showAnon} onShowAnon={setShowAnon} onOpenUser={onOpenUser} />;
}

export function AccessView({ data, showAnon, onShowAnon, onOpenUser }: {
  data: GatewayAccess; showAnon: boolean; onShowAnon: (v: boolean) => void; onOpenUser: (id: string) => void;
}) {
  const { totals } = data;
  const signedIn = { allowed: totals.allowed - totals.unauthenticated.allowed, denied: totals.denied - totals.unauthenticated.denied };
  const hosts = showAnon ? data.hosts : data.hosts.filter((h) => h.allowed + h.denied > h.unauthenticated);
  const summary = { window: '', total: totals.allowed + totals.denied, series: data.series.map((b) => ({ t: b.t, total: b.allowed + b.denied, failed: b.denied })) };
  return (
    <div className="col gap-12">
      <div className="rb-stats">
        <Stat label="Allowed" value={n(signedIn.allowed)} sub="signed-in requests" />
        <Stat label="Denied" value={n(signedIn.denied)} tone={signedIn.denied ? 'warning' : undefined} sub="signed-in requests" />
        <Stat label="Unauthenticated" value={n(totals.unauthenticated.denied + totals.unauthenticated.allowed)}
          sub={`${n(totals.unauthenticated.denied)} denied · ${n(totals.unauthenticated.allowed)} to public routes`} />
      </div>

      <Card pad="sm" className="audit-histo-card">
        <span className="small muted">Gateway decisions · allowed and denied, unauthenticated included</span>
        <AuditHistogram summary={summary} loading={false} onZoom={() => {}} />
      </Card>

      {data.truncated && <Callout tone="warning" icon={I.info}>Only the busiest people and hosts are listed. Narrow the range for the rest.</Callout>}

      <Card title="People and services" sub="Signed-in requests the gateway decided, busiest first">
        <Table>
          <thead><tr><Th>Who</Th><Th kind="num">Allowed</Th><Th kind="num">Denied</Th><Th>Hosts</Th><Th kind="actions"><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {data.subjects.length === 0 ? <EmptyRow colSpan={5}>No signed-in requests in this range.</EmptyRow> : data.subjects.map((s) => (
              <tr key={s.subject}>
                <td><ActorCell actor={{ type: s.kind, id: s.subject }} /></td>
                <td className="num">{n(s.allowed)}</td>
                <td className="num">{s.denied ? <span className="text-warning">{n(s.denied)}</span> : 0}</td>
                <td className="mono text-xs audit-clip" title={s.hosts.join(', ')}>{s.hosts.join(', ')}</td>
                <td className="actions">{s.kind === 'user' && <Button size="sm" variant="ghost" onClick={() => onOpenUser(s.subject)}>Events</Button>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Hosts" actions={<Checkbox checked={showAnon} onChange={() => onShowAnon(!showAnon)} label="Show hosts with only unauthenticated traffic" />}>
        <Table>
          <thead><tr><Th>Host</Th><Th kind="num">Allowed</Th><Th kind="num">Denied</Th><Th kind="num">Unauthenticated</Th></tr></thead>
          <tbody>
            {hosts.length === 0 ? <EmptyRow colSpan={4}>No hosts to show.</EmptyRow> : hosts.map((h) => (
              <tr key={h.host}>
                <td className="mono small">{h.host}</td>
                <td className="num">{n(h.allowed)}</td>
                <td className="num">{n(h.denied)}</td>
                <td className="num muted">{n(h.unauthenticated)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {data.queryMs != null && <div className="small muted text-center">{data.queryMs} ms · counted from the gateway log · read-only</div>}
    </div>
  );
}
