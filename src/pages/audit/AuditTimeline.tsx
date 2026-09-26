import type { AuditEventV1 } from '../../api/audit';
import { AUDIT_ERROR_COPY, auditErrorKind } from '../../api/audit';
import { Badge, Button, ButtonBase, Callout, I, SkeletonText, cx } from '../../components/ui';
import { eventPhrase, eventSummary, groupByDay, resultTone, severityTone, timeOf } from '../../lib/audit/format';
import { ActorCell } from './Actor';
import { AuditEventDetail } from './AuditEventDetail';

/** One event as a row; the whole row opens the detail under it. */
function Row({ e, open, onToggle, platform, onOpenUser, orgName }: {
  e: AuditEventV1; open: boolean; onToggle: () => void; platform: boolean;
  onOpenUser?: (id: string) => void; orgName?: (id: string) => string;
}) {
  const sev = severityTone(e.severity);
  const failed = e.result !== 'success';
  return (
    <div className={cx('audit-row', failed && 'is-fail', sev === 'danger' && !failed && 'is-high', open && 'is-open')}>
      <ButtonBase className="audit-row-head" aria-expanded={open} onClick={onToggle}>
        <span className="mono small audit-time">{timeOf(e.ts)}</span>
        <ActorCell actor={e.actor} />
        <span className="audit-what min-w-0">
          <span className="small fw-medium">{eventPhrase(e.event)}</span>
          <span className="mono small muted audit-clip">{eventSummary(e)}</span>
        </span>
        <span className="audit-meta row gap-4 wrap">
          {platform && e.org_id && <Badge mono={false}>{orgName?.(e.org_id) ?? e.org_id}</Badge>}
          {e.site && <Badge>{e.site}</Badge>}
          {sev && <Badge tone={sev} mono={false}>{e.severity}</Badge>}
          {failed && <Badge tone={resultTone(e.result)} mono={false}>{e.result}{e.reason ? ` · ${e.reason}` : ''}</Badge>}
        </span>
        <span className="audit-caret" aria-hidden="true">{open ? I.caretUp : I.caret}</span>
      </ButtonBase>
      {open && <AuditEventDetail e={e} platform={platform} onOpenUser={onOpenUser} />}
    </div>
  );
}

export function AuditEvents({ events, openId, onToggle, platform, onOpenUser, orgName }: {
  events: AuditEventV1[]; openId: string | null; onToggle: (id: string) => void; platform: boolean;
  onOpenUser?: (id: string) => void; orgName?: (id: string) => string;
}) {
  return (
    <>
      {groupByDay(events).map((g) => (
        <section key={g.key} aria-label={g.label}>
          <div className="audit-day">{g.label}</div>
          {g.events.map((e) => (
            <Row key={e.event_id} e={e} open={openId === e.event_id} onToggle={() => onToggle(e.event_id)}
              platform={platform} onOpenUser={onOpenUser} orgName={orgName} />
          ))}
        </section>
      ))}
    </>
  );
}

/** The §5.2 error states. A 503 says outage, never "nothing happened". */
export function AuditError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const kind = auditErrorKind(error);
  const copy = AUDIT_ERROR_COPY[kind];
  const detail = kind === 'failed' && error instanceof Error && error.message ? error.message : copy.detail;
  return (
    <Callout tone={kind === 'not-available' ? 'info' : kind === 'out-of-scope' ? 'warning' : 'danger'} icon={kind === 'not-available' ? I.info : I.alert}
      title={copy.title}
      actions={copy.retry && onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined}>
      <div className="small">{detail}</div>
    </Callout>
  );
}

export function AuditLoading() {
  return <div className="p-12"><SkeletonText lines={6} /></div>;
}
