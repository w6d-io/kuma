import { useState, useRef, useEffect, useMemo } from 'react';
import { Button, I, PageHeader } from '../components/ui';
import { Pagination, usePagination } from '../components/ui/Pagination';
import { useApp } from '../contexts/AppContext';
import { useAudit, useAuditSummary, useAuditEvents } from '../api/hooks';
import type { AuditEvent } from '../api/types';
import { failurePct, localDayKey, riskOf, trend } from './audit/lib';
import { AuditAnalysis, AuditRiskHero, AuditSummaryBand } from './audit/AuditOverview';
import { AuditLog, AuditLogBody, type AuditTab, type StatusFilter } from './audit/AuditLog';

// Shared with Dashboard, AccessReview and the per-user trail.
export { riskOf } from './audit/lib';
export type { RiskInfo } from './audit/lib';
export { RiskBadge } from './audit/RiskBadge';

export function AuditPage() {
  const { setPage, setAuditFocus, auditFocus } = useApp();
  // Read the real audit stream directly (live query), NOT AppContext.audit —
  // that mirror was seeded with SEED placeholder demo events in DEV and a
  // `> 0` guard kept the fake rows when live audit was empty (GHOST-3). The
  // audit log must never show fabricated entries.
  const { data: audit = [], isError: auditError, isLoading: auditLoading } = useAudit();
  const summaryQ = useAuditSummary('24h');
  const summary = summaryQ.data;
  // Server-authoritative high-risk slice (spans retained history, not the 200-row
  // window). Fail-closed: on error fall back to client riskOf over the window.
  const riskQ = useAuditEvents({ risk: 'high', limit: 100 });
  const riskEvents = useMemo<AuditEvent[]>(() => {
    if (riskQ.isSuccess) return riskQ.data;
    if (riskQ.isError) return audit.filter(e => riskOf(e).level !== 'none');
    return [];
  }, [riskQ.isSuccess, riskQ.isError, riskQ.data, audit]);
  const riskFromWindow = !riskQ.isSuccess; // hero/Signals sourced from loaded window

  const [q, setQ] = useState("");
  const [tab, setTab] = useState<AuditTab>("changes");
  const [cat, setCat] = useState("all");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const scrollToLog = () => logRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Deep-link intent from other surfaces (Dashboard "Signals" cards, hero Review
  // that crossed a page). Applied once, then cleared.
  useEffect(() => {
    if (!auditFocus) return;
    if (auditFocus.tab) setTab(auditFocus.tab as typeof tab);
    if (auditFocus.eventId) setOpenId(auditFocus.eventId);
    setAuditFocus(null);
    // Let the tab switch commit before scrolling.
    const id = setTimeout(scrollToLog, 60);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditFocus]);

  // The three log layers (contract D1): Changes = the compliance record
  // (kind=change), Access = request/traffic telemetry (kind=access), Auth =
  // session/authn decisions (kind=auth). Signals = risk-only (any kind).
  const kindOf = (a: AuditEvent): string =>
    a.kind || (a.category === 'access' ? 'access' : a.category === 'auth' ? 'auth' : a.category === 'system' ? 'system' : 'change');

  // Signals is driven by the server risk slice; the other tabs by the window.
  const inTab = tab === 'signals'
    ? riskEvents
    : audit.filter(a => {
        const k = kindOf(a);
        if (tab === "changes") return k === "change" || k === "system";
        return k === tab;
      });

  const filtered = inTab.filter(a => {
    if (cat !== "all" && a.category !== cat) return false;
    if (statusF === "failed" && a.status !== "failed" && a.verb !== "fail" && a.verb !== "deny") return false;
    if (statusF === "ok" && (a.status === "failed" || a.verb === "fail" || a.verb === "deny")) return false;
    if (q) {
      const hay = `${a.who} ${a.verb} ${a.target} ${a.ip || ""} ${a.reason || ""} ${a.service || ""} ${a.path || ""} ${a.method || ""} ${a.changes?.summary || ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const tabCounts = {
    changes: audit.filter(a => { const k = kindOf(a); return k === "change" || k === "system"; }).length,
    access:  audit.filter(a => kindOf(a) === "access").length,
    auth:    audit.filter(a => kindOf(a) === "auth").length,
    signals: riskEvents.length,
  };
  // Category pills reflect the active tab's rows only.
  const catCounts = inTab.reduce<Record<string, number>>((acc, a) => { acc[a.category] = (acc[a.category] || 0) + 1; return acc; }, {});
  const failedCount = inTab.filter(a => a.status === "failed" || a.verb === "fail" || a.verb === "deny").length;
  const pg = usePagination(filtered.length, 50);
  const selectTab = (t: typeof tab) => { setTab(t); setCat("all"); pg.setPage(0); };
  const paged = filtered.slice(pg.from, pg.to);

  const groups = (() => {
    const gs: { day: string; label: string; entries: typeof filtered }[] = [];
    let last = "";
    for (const e of paged) {
      const day = localDayKey(e.ts) || e.when;
      if (day !== last) {
        const today = localDayKey(new Date().toISOString());
        const yesterday = localDayKey(new Date(Date.now() - 86400000).toISOString());
        const label = day === today ? "Today" : day === yesterday ? "Yesterday" : day;
        gs.push({ day, label, entries: [] });
        last = day;
      }
      gs[gs.length - 1].entries.push(e);
    }
    return gs;
  })();

  // Client-side CSV export of the currently filtered events. (Bounded to the
  // loaded window today; server-side /audit/export is the full-range path.)
  const exportCsv = () => {
    const cols = ["ts", "who", "verb", "category", "target", "service", "method", "path", "status", "statusCode", "ip", "reason", "severity"] as const;
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = filtered.map(e => cols.map(c => esc((e as unknown as Record<string, unknown>)[c])).join(","));
    const csv = [cols.join(","), ...body].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Summary band values (server window, else honest loaded-window fallback) ──
  const usingServerSummary = summaryQ.isSuccess && !!summary;
  const windowLabel = usingServerSummary ? (summary!.window || 'last 24h') : 'loaded window';
  const activityVal = usingServerSummary ? summary!.total : audit.length;
  const activityTrend = usingServerSummary ? trend(summary!.total, summary!.prevTotal) : null;
  const changesVal = usingServerSummary ? (summary!.byKind?.change ?? 0) : audit.filter(a => kindOf(a) === 'change').length;
  const changesTrend = usingServerSummary ? trend(summary!.byKind?.change, summary!.prevByKind?.change) : null;
  const failPct = failurePct(usingServerSummary ? summary : undefined, usingServerSummary ? undefined : audit);
  const peopleVal = usingServerSummary ? (summary!.activeActors ?? 0) : new Set(audit.map(a => a.who).filter(w => w && w !== 'system' && w !== 'anon')).size;
  const peopleTrend = usingServerSummary ? trend(summary!.activeActors, summary!.prevActiveActors) : null;

  // Analysis: category volume + failure overlay, and top denials/actors.
  const catBars = useMemo(() => {
    let rows: { key: string; total: number; failed: number }[];
    if (usingServerSummary && summary!.byCategory) {
      rows = Object.entries(summary!.byCategory).map(([key, v]) => ({ key, total: v.total, failed: v.failed }));
    } else {
      const acc: Record<string, { total: number; failed: number }> = {};
      for (const e of audit) {
        const k = e.category || 'system';
        acc[k] = acc[k] || { total: 0, failed: 0 };
        acc[k].total++;
        if (e.status === 'failed' || e.verb === 'fail' || e.verb === 'deny') acc[k].failed++;
      }
      rows = Object.entries(acc).map(([key, v]) => ({ key, ...v }));
    }
    return rows.sort((a, b) => b.total - a.total).slice(0, 8);
  }, [usingServerSummary, summary, audit]);
  const maxBar = Math.max(1, ...catBars.map(b => b.total));

  const topDenied = useMemo(() => {
    if (usingServerSummary && summary!.topDenied)
      return summary!.topDenied.slice(0, 6).map(d => ({ label: (d as { target?: string; key?: string }).target ?? (d as { key?: string }).key ?? '—', count: d.count }));
    const acc: Record<string, number> = {};
    for (const e of audit) {
      if (e.status === 'failed' || e.verb === 'fail' || e.verb === 'deny') {
        const k = e.who && e.who !== 'system' ? e.who : (e.target || 'unknown');
        acc[k] = (acc[k] || 0) + 1;
      }
    }
    return Object.entries(acc).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [usingServerSummary, summary, audit]);

  const topActors = useMemo(() => {
    if (usingServerSummary && summary!.topActors)
      return summary!.topActors.slice(0, 6).map(d => ({ label: (d as { actor?: string; key?: string }).actor ?? (d as { key?: string }).key ?? '—', count: d.count }));
    const acc: Record<string, number> = {};
    for (const e of audit) {
      if (kindOf(e) === 'change' && e.who && e.who !== 'system' && e.who !== 'anon') acc[e.who] = (acc[e.who] || 0) + 1;
    }
    return Object.entries(acc).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [usingServerSummary, summary, audit]);

  const heroEvents = riskEvents.slice(0, 6);

  const focusEvent = (e: AuditEvent) => {
    selectTab('signals');
    setOpenId(e.id);
    setTimeout(scrollToLog, 60);
  };

  return (
    <>
      <PageHeader
        title="Audit"
        sub={<>
          Who can do what, and who did what · <span className="mono">{windowLabel}</span>
          {!usingServerSummary && !summaryQ.isLoading && <> · <span className="muted">live summary unavailable — showing the loaded window</span></>}
        </>}
        actions={<Button icon={I.shield} onClick={() => setPage('accessreview')}>Access review</Button>}
      />

      <AuditSummaryBand
        windowLabel={windowLabel}
        activityVal={activityVal} activityTrend={activityTrend}
        changesVal={changesVal} changesTrend={changesTrend}
        failPct={failPct}
        peopleVal={peopleVal} peopleTrend={peopleTrend}
        onActivity={scrollToLog}
        onChanges={() => { selectTab('changes'); scrollToLog(); }}
        onFailures={() => { setStatusF('failed'); scrollToLog(); }}
        onPeople={() => setPage('accessreview')}
      />

      <AuditRiskHero
        loading={riskQ.isLoading && !riskQ.isError}
        fromWindow={riskFromWindow}
        total={riskEvents.length}
        events={heroEvents}
        onAll={() => { selectTab('signals'); scrollToLog(); }}
        onReview={focusEvent}
      />

      <AuditAnalysis
        catBars={catBars} maxBar={maxBar} topDenied={topDenied} topActors={topActors}
        onCategory={(key) => { selectTab('changes'); setCat(key); scrollToLog(); }}
      />

      <AuditLog
        logRef={logRef} tab={tab} onTab={selectTab} tabCounts={tabCounts}
        inTabCount={inTab.length} failedCount={failedCount}
        q={q} onQ={setQ} onExport={exportCsv} exportDisabled={filtered.length === 0}
        cat={cat} onCat={setCat} catCounts={catCounts} statusF={statusF} onStatus={setStatusF}
      >
        <AuditLogBody
          auditError={auditError}
          riskError={riskQ.isError}
          riskEmpty={riskEvents.length === 0}
          loading={auditLoading || (tab === 'signals' && riskQ.isLoading)}
          signals={tab === 'signals'}
          empty={filtered.length === 0}
          groups={groups}
          openId={openId}
          onToggle={(id) => setOpenId(openId === id ? null : id)}
        />
      </AuditLog>

      {filtered.length > pg.pageSize && (
        <Pagination page={pg.page} pageSize={pg.pageSize} total={filtered.length} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} sizes={[25, 50, 100, 200]} />
      )}
      <div className="small muted mt-12 text-center">
        Showing {filtered.length === 0 ? 0 : pg.from + 1}–{Math.min(pg.to, filtered.length)} of {filtered.length} events{filtered.length < inTab.length ? ` (${inTab.length} in ${tab})` : ""} · read-only
      </div>
      <div className="small muted mt-4 text-center audit-faint">
        Retention is bounded by the audit stream cap and is not tamper-evident (Redis-only store). A durable/WORM store is a documented upgrade path.
      </div>
    </>
  );
}
