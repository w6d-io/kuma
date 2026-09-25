import type { ReactNode, Ref } from 'react';
import { Button, Card, EmptyHint, I, Input, Segmented, Tabs } from '../../components/ui';
import { SkeletonText } from '../../components/ui/Skeleton';
import type { AuditEvent } from '../../api/types';
import { AUDIT_CATS } from './lib';
import { AuditRow } from './AuditRow';

export type AuditTab = "changes" | "access" | "auth" | "signals";
export type StatusFilter = "all" | "ok" | "failed";

const TAB_META: { id: AuditTab; label: string; sub: string }[] = [
  { id: "changes", label: "Changes", sub: "compliance record" },
  { id: "access",  label: "Access",  sub: "request telemetry" },
  { id: "auth",    label: "Auth",    sub: "sessions" },
  { id: "signals", label: "Signals", sub: "risk only" },
];

// ── Activity (merged into the same page as the overview) ──
export function AuditLog({
  logRef, tab, onTab, tabCounts, inTabCount, failedCount, q, onQ, onExport, exportDisabled,
  cat, onCat, catCounts, statusF, onStatus, children,
}: {
  logRef: Ref<HTMLDivElement>;
  tab: AuditTab;
  onTab: (t: AuditTab) => void;
  tabCounts: Record<AuditTab, number>;
  inTabCount: number;
  failedCount: number;
  q: string;
  onQ: (q: string) => void;
  onExport: () => void;
  exportDisabled: boolean;
  cat: string;
  onCat: (c: string) => void;
  catCounts: Record<string, number>;
  statusF: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  children: ReactNode;
}) {
  const catOptions = [
    { value: "all", label: "All events", count: inTabCount },
    ...Object.entries(AUDIT_CATS)
      .filter(([key]) => (catCounts[key] || 0) > 0)
      .map(([key, meta]) => ({ value: key, label: meta.label, icon: I[meta.icon], count: catCounts[key] })),
  ];
  return (
    <>
      <div ref={logRef} className="audit-log-head">
        <div>
          <h3 className="m-0">Activity</h3>
          <div className="sub">
            Read-only stream · {inTabCount} {tab}
            {failedCount > 0 && <> · <span className="text-danger">{failedCount} denied / failed</span></>}
          </div>
        </div>
        <div className="page-actions">
          <Input size="sm" leading={I.search} className="audit-search" placeholder="Search actor, target, IP, path…" value={q} onChange={e => onQ(e.target.value)} />
          <Button size="sm" icon={I.download} onClick={onExport} disabled={exportDisabled}>Export CSV</Button>
        </div>
      </div>

      {/* Log-layer tabs (contract D1) + Signals (risk only). */}
      <Tabs label="Log layer" className="mb-8" value={tab} onChange={onTab}
        items={TAB_META.map(t => ({ value: t.id, label: <span title={t.sub}>{t.label}</span>, count: tabCounts[t.id] }))} />

      {/* Category filter (scoped to the active tab) + result filter */}
      <div className="audit-filters">
        <Segmented label="Category" value={cat} onChange={onCat} options={catOptions} />
        <Segmented label="Result" value={statusF} onChange={onStatus} options={[
          { value: "all", label: "All" },
          { value: "ok", label: "Success" },
          { value: "failed", label: "Denied" },
        ]} />
      </div>

      {/* Column header */}
      <div className="audit-head">
        <div>Time</div><div>Actor</div><div>Event</div><div>Context</div><div>Result</div>
      </div>

      <Card>{children}</Card>
    </>
  );
}

// Body of the log panel: load-error / empty / loading states, then day groups.
export function AuditLogBody({ auditError, riskError, riskEmpty, loading, signals, empty, groups, openId, onToggle }: {
  auditError: boolean;
  riskError: boolean;
  /** The risk slice itself is empty (not just the filtered view). */
  riskEmpty: boolean;
  loading: boolean;
  signals: boolean;
  empty: boolean;
  groups: { day: string; label: string; entries: AuditEvent[] }[];
  openId: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      {/* Distinguish a failed load from a genuinely empty log — a blank audit
          trail must never be mistaken for "no activity" (finding #6). */}
      {auditError && (
        <div className="p-24">
          <span className="small text-danger">
            Failed to load the audit log — this is a load error, not an empty log. Reload to retry;
            do not treat the absence of events as "no activity".
          </span>
        </div>
      )}
      {!auditError && signals && riskError && riskEmpty && (
        <div className="p-24">
          <span className="small text-danger">
            Failed to load the risk slice — this is a load error, not "no risk". Reload to retry.
          </span>
        </div>
      )}
      {!auditError && empty && !(signals && riskError) && (
        loading
          ? <div className="p-16" aria-busy="true" aria-label="Loading events"><SkeletonText lines={6} /></div>
          : <div className="p-24"><EmptyHint>No events match.</EmptyHint></div>
      )}
      {groups.map(g => (
        <div key={g.day} className="audit-day">
          <div className="audit-day-head">
            <span className="audit-day-label">{g.label}</span>
            <span className="audit-day-count">{g.entries.length} event{g.entries.length === 1 ? "" : "s"}</span>
          </div>
          {g.entries.map(e => (
            <AuditRow key={e.id} e={e} open={openId === e.id} onToggle={() => onToggle(e.id)} />
          ))}
        </div>
      ))}
    </>
  );
}
