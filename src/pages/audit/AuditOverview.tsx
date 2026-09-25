import { Avatar, Badge, Button, ButtonBase, Card, EmptyHint, I, Stat, cx } from '../../components/ui';
import { SkeletonText } from '../../components/ui/Skeleton';
import type { AuditEvent } from '../../api/types';
import { AUDIT_CATS, localTime, plainSentence, rateTone, riskOf, type Trend } from './lib';
import { RiskBadge, TrendPill } from './RiskBadge';

// ── Summary band (posture) ──
export function AuditSummaryBand({ windowLabel, activityVal, activityTrend, changesVal, changesTrend, failPct, peopleVal, peopleTrend, onActivity, onChanges, onFailures, onPeople }: {
  windowLabel: string;
  activityVal: number; activityTrend: Trend;
  changesVal: number; changesTrend: Trend;
  failPct: number;
  peopleVal: number; peopleTrend: Trend;
  onActivity: () => void; onChanges: () => void; onFailures: () => void; onPeople: () => void;
}) {
  const tone = rateTone(failPct);
  return (
    <div className="grid g4 mb-12">
      <Stat label="Activity" onClick={onActivity}
        value={<span className="row items-baseline">{activityVal}<TrendPill t={activityTrend} /></span>}
        sub={<>events · {windowLabel}</>} />
      <Stat label="Changes" onClick={onChanges}
        value={<span className="row items-baseline">{changesVal}<TrendPill t={changesTrend} /></span>}
        sub="config mutations" />
      <Stat label="Failures / denials" onClick={onFailures} tone={tone}
        value={<>{failPct.toFixed(failPct < 10 ? 1 : 0)}%</>}
        sub={tone === 'danger' ? 'elevated — investigate' : tone === 'warning' ? 'above baseline' : 'within baseline'} />
      <Stat label="Active people" onClick={onPeople}
        value={<span className="row items-baseline">{peopleVal}<TrendPill t={peopleTrend} /></span>}
        sub="distinct actors" />
    </div>
  );
}

// ── HERO: recent high-risk changes ──
export function AuditRiskHero({ loading, fromWindow, total, events, onAll, onReview }: {
  loading: boolean;
  fromWindow: boolean;
  total: number;
  events: AuditEvent[];
  onAll: () => void;
  onReview: (e: AuditEvent) => void;
}) {
  return (
    <Card className="mb-12" pad="none" title="Recent high-risk changes"
      sub={<>
        Grants of broad power, weakened protection, and mass rewrites
        {fromWindow && <> · <span className="muted">from the loaded window (risk endpoint unavailable)</span></>}
      </>}
      actions={total > 0 ? <Button variant="ghost" size="sm" onClick={onAll}>All signals →</Button> : undefined}>
      {loading ? (
        <div className="p-16" aria-busy="true" aria-label="Loading signals"><SkeletonText lines={3} /></div>
      ) : events.length === 0 ? (
        <div className="row gap-12 p-16 muted">
          <span className="text-success">{I.check}</span>
          <div className="small">No high-risk changes recorded in this window.</div>
        </div>
      ) : (
        events.map(e => {
          const r = riskOf(e);
          return (
            <div key={e.id} className={cx('audit-hero-row', r.tone === 'danger' && 'risk-danger')}>
              <div className="flex-1 min-w-0">
                <div className="row wrap">
                  <RiskBadge e={e} />
                  <span className="text-base text-default">{plainSentence(e)}</span>
                </div>
                <div className="row small muted mt-4">
                  {!e.who || e.who === 'system' ? <span className="mono">system</span> : (
                    <span className="row gap-4"><Avatar email={e.who} size={16} /><span className="mono">{e.who}</span></span>
                  )}
                  <span>·</span>
                  <span className="mono">{localTime(e.ts) || e.when}</span>
                  {e.service && <><span>·</span><span className="mono">{e.service}</span></>}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onReview(e)}>Review</Button>
            </div>
          );
        })
      )}
    </Card>
  );
}

type Ranked = { label: string; count: number }[];

function RankList({ title, rows, tone }: { title: string; rows: Ranked; tone?: 'danger' }) {
  return (
    <div>
      <div className="input-label">{title}</div>
      {rows.length === 0 ? <span className="small muted">— none —</span> : rows.map(d => (
        <div key={d.label} className="row justify-between py-4">
          <span className="small mono truncate" title={d.label}>{(d.label || '—').split('@')[0]}</span>
          <Badge tone={tone}>{d.count}</Badge>
        </div>
      ))}
    </div>
  );
}

// ── Analysis row: category volume, top denials & actors ──
export function AuditAnalysis({ catBars, maxBar, topDenied, topActors, onCategory }: {
  catBars: { key: string; total: number; failed: number }[];
  maxBar: number;
  topDenied: Ranked;
  topActors: Ranked;
  onCategory: (key: string) => void;
}) {
  return (
    <div className="audit-analysis mb-12">
      <Card title="Activity by category" sub="Events per category in this window">
        <div className="col">
          {catBars.length === 0 ? <EmptyHint>No activity in this window.</EmptyHint> : catBars.map(b => {
            const meta = AUDIT_CATS[b.key];
            return (
              <ButtonBase key={b.key} className="audit-bar-row" onClick={() => onCategory(b.key)}>
                <span className="small text-muted row gap-4">
                  <span className="audit-bar-ico">{meta ? I[meta.icon] : I.dot}</span>
                  {meta?.label || b.key}
                </span>
                <progress className="audit-bar" value={b.total} max={maxBar} aria-hidden="true" />
                <span className="small mono muted text-right">{b.total}</span>
              </ButtonBase>
            );
          })}
        </div>
      </Card>
      <Card title="Top denials & actors" sub="Most-denied and most-active in this window">
        <div className="audit-rank-grid">
          <RankList title="Denials" rows={topDenied} tone="danger" />
          <RankList title="Actors" rows={topActors} />
        </div>
      </Card>
    </div>
  );
}
