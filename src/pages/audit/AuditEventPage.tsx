import { Button, Card, I, PageHeader, SkeletonText } from '../../components/ui';
import { useSession } from '../../api/hooks';
import { useApp } from '../../contexts/AppContext';
import { permits } from '../../policy/model';
import { eventPhrase } from '../../lib/audit/format';
import { AuditEventDetail } from './AuditEventDetail';
import { AuditError } from './AuditTimeline';
import { useAuditEventDetail } from './queries';

/** One event on its own page (`#/audit/event/<id>?ts=…`), for a link pasted into a ticket. */
export function AuditEventPage({ id, ts }: { id: string; ts?: string }) {
  const { setPage } = useApp();
  const q = useAuditEventDetail(id, ts);
  const e = q.data?.event;
  // The single-event response carries no scope. Grafana is platform-only, so the trace link is
  // offered to a platform reader, as on the list.
  const platform = permits(useSession().data?.permissions, 'admin:read');
  return (
    <>
      <PageHeader eyebrow="Audit" title={e ? eventPhrase(e.event) : 'Audit event'} sub={<span className="mono">{id}</span>}
        actions={<Button icon={I.caretLeft} onClick={() => setPage('audit')}>All events</Button>} />
      <Card pad="md">
        {q.isError ? <AuditError error={q.error} onRetry={() => q.refetch()} />
          : !e ? <SkeletonText lines={6} />
          : <AuditEventDetail e={e} platform={platform} />}
      </Card>
    </>
  );
}
