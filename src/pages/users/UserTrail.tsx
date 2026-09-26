import { useMemo, useState } from 'react';
import type { User } from '../../api/types';
import { Badge, Button, ButtonBase, Card, EmptyHint, I, Segmented, cx } from '../../components/ui';
import { eventPhrase, eventSummary, resultTone, severityTone, timeOf } from '../../lib/audit/format';
import { splitTimeline, timelineWindow, type TimelineSegment } from '../../lib/audit/timeline';
import { ActorCell } from '../audit/Actor';
import { AuditEventDetail } from '../audit/AuditEventDetail';
import { AuditError } from '../audit/AuditTimeline';
import { useUserTimeline } from '../audit/queries';

const SEGMENTS: { value: TimelineSegment; label: string }[] = [
  { value: 'did', label: 'Did' },
  { value: 'done', label: 'Done to them' },
  { value: 'logins', label: 'Logins' },
];

/**
 * The drawer's Activity tab (AUD-12): one person's events by Kratos id — the
 * events they caused, the ones aimed at them, and their sign-ins — 30 days at a time.
 */
export function UserTrail({ user }: { user: User }) {
  const [now] = useState(() => Date.now());
  const [k, setK] = useState(0);
  const [seg, setSeg] = useState<TimelineSegment>('did');
  const [openId, setOpenId] = useState<string | null>(null);
  const range = useMemo(() => timelineWindow(k, now), [k, now]);
  const q = useUserTimeline(user.id, range);
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.events) ?? [], [q.data]);
  const split = useMemo(() => splitTimeline(all, user.id), [all, user.id]);
  const rows = split[seg];
  const platform = q.data?.pages[0]?.scope.platform ?? false;
  const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });

  return (
    <div className="col gap-12">
      <div className="row justify-between gap-8 wrap">
        <Segmented label="Activity" value={seg} onChange={(v) => { setSeg(v); setOpenId(null); }}
          options={SEGMENTS.map((s) => ({ ...s, count: q.isSuccess ? split[s.value].length : undefined }))} />
        <span className="small muted">{day(range.from)} – {day(range.to)}</span>
      </div>
      <Card pad="none">
        {q.isError ? <div className="p-12"><AuditError error={q.error} onRetry={() => q.refetch()} /></div>
          : q.isLoading ? <div className="p-16"><EmptyHint>Loading…</EmptyHint></div>
          : rows.length === 0 ? <div className="p-16"><EmptyHint>Nothing recorded in these 30 days.</EmptyHint></div>
          : rows.map((e) => {
            const open = openId === e.event_id;
            const sev = severityTone(e.severity);
            return (
              <div key={e.event_id} className={cx('audit-row', 'compact', e.result !== 'success' && 'is-fail', open && 'is-open')}>
                <ButtonBase className="audit-trail-head" aria-expanded={open} onClick={() => setOpenId(open ? null : e.event_id)}>
                  <span className="mono text-xs muted">{day(e.ts)} {timeOf(e.ts)}</span>
                  <span className="small fw-medium">{eventPhrase(e.event)}</span>
                  <span className="mono small muted audit-clip">{eventSummary(e)}</span>
                  {seg === 'done' && <ActorCell actor={e.actor} />}
                  {sev && <Badge tone={sev} mono={false}>{e.severity}</Badge>}
                  {e.result !== 'success' && <Badge tone={resultTone(e.result)} mono={false}>{e.result}</Badge>}
                </ButtonBase>
                {open && <AuditEventDetail e={e} platform={platform} />}
              </div>
            );
          })}
      </Card>
      <div className="row justify-center gap-8">
        {q.hasNextPage
          ? <Button size="sm" variant="ghost" icon={I.caret} loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load older</Button>
          : q.isSuccess && k < 13 && <Button size="sm" variant="ghost" icon={I.clock} onClick={() => { setK(k + 1); setOpenId(null); }}>Previous 30 days</Button>}
        {k > 0 && <Button size="sm" variant="ghost" onClick={() => { setK(0); setOpenId(null); }}>Back to latest</Button>}
      </div>
    </div>
  );
}
