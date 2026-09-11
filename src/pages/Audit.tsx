import { useState, useRef, useEffect, useMemo } from 'react';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Method, EmptyHint } from '../components/ui/Primitives';
import { Pagination, usePagination } from '../components/ui/Pagination';
import { useApp } from '../contexts/AppContext';
import { useAudit, useAuditSummary, useAuditEvents } from '../api/hooks';
import type { AuditEvent, AuditSummary } from '../api/types';

// Audit timestamps are ISO/UTC. Render + bucket them in the operator's LOCAL
// time — a UTC string-slice showed the wrong clock time and could file an event
// under the wrong day. (Phase 1 will hoist these into one shared date util.)
const localDayKey = (t?: string): string => {
  if (!t) return "";
  const d = new Date(t);
  return isNaN(+d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const localTime = (t?: string): string => {
  if (!t) return "";
  const d = new Date(t);
  return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

// Grafana base for per-event trace deep-links (correlate by sessionId/actor,
// contract D3). Runtime-injected like __API_BASE__; empty = no link rendered.
function grafanaTraceUrl(e: AuditEvent): string | null {
  const base = ((window as any).__GRAFANA_URL__ as string | undefined)?.replace(/\/$/, '');
  if (!base || base.startsWith('${')) return null; // unset / un-substituted placeholder
  const sid = e.sessionId;
  const params = new URLSearchParams();
  if (sid) params.set('var-sessionId', sid);
  if (e.who && e.who !== 'anon' && e.who !== 'system') params.set('var-actor', e.who);
  return `${base}/d/auth-audit?${params.toString()}`;
}

const AUDIT_CATS: Record<string, { label: string; icon: keyof typeof I }> = {
  auth: { label: "Auth", icon: "key" },
  access: { label: "Access", icon: "shield" },
  rbac: { label: "RBAC", icon: "users" },
  policy: { label: "Policy", icon: "file" },
  service: { label: "Service", icon: "cube" },
  route: { label: "Route", icon: "route" },
  secret: { label: "Secret", icon: "lock" },
  directory: { label: "Directory", icon: "users" },
  bundle: { label: "Bundle", icon: "box" },
  system: { label: "System", icon: "cog" },
};

function verbTone(v: string) {
  if (["deny", "fail", "revoke", "delete"].includes(v)) return "err";
  if (["allow", "login", "create", "add", "commit"].includes(v)) return "ok";
  if (["logout", "expire", "revert"].includes(v)) return "warn";
  return "";
}

function statusTone(code?: number) {
  if (!code) return "";
  if (code < 300) return "ok";
  if (code < 400) return "info";
  if (code < 500) return "warn";
  return "err";
}

// ─── Shared risk classifier (Part E) ────────────────────────────────────────
// riskOf is DISPLAY-ONLY refinement. The `?risk=high` gate and the hero are
// server-authoritative via emit-time `severity` + `changes.flags` ([P2-3]); this
// only sharpens the label/badge for a row already in hand. Severity is expressed
// strictly through semantic tokens (--err / --warn) — NEVER --accent.
export interface RiskInfo { level: 'critical' | 'warn' | 'none'; label: string; tone: string }

const RISK_FLAG_LABEL: Record<string, string> = {
  grants_super_admin: 'grants super-admin',
  wildcard_permission: 'grants wildcard (*)',
  opened_to_public: 'opened to the public',
  auth_disabled: 'authentication disabled',
};

export function riskOf(e: AuditEvent): RiskInfo {
  const flags = e.changes?.flags ?? [];
  const sev = (e.severity || '').toLowerCase();
  const cat = (e.category || '').toLowerCase();
  const verb = (e.verb || '').toLowerCase();
  const target = (e.target || '').toLowerCase();
  const isFail = e.status === 'failed' || verb === 'fail' || verb === 'deny';

  // ── CRITICAL (P0) ─────────────────────────────────────────────
  // 1) An authoritative critical flag on the before→after diff.
  const critFlag = flags.find(f => f in RISK_FLAG_LABEL);
  if (critFlag) return { level: 'critical', label: RISK_FLAG_LABEL[critFlag], tone: 'err' };
  // 2) Server says critical/high (spans history; client just labels it).
  if (sev === 'critical' || sev === 'high')
    return { level: 'critical', label: shortLabel(e) || 'high-risk change', tone: 'err' };
  // 3) A wildcard grant surfaced in the diff even without a flag.
  if ((e.changes?.added ?? []).includes('*'))
    return { level: 'critical', label: 'grants wildcard (*)', tone: 'err' };
  // 4) Bundle import / restore — mass rewrite / exfil-adjacent.
  if ((cat === 'bundle' || target.includes('bundle') || target.includes('backup'))
      && ['import', 'restore', 'apply'].includes(verb) && !isFail)
    return { level: 'critical', label: verb === 'restore' ? 'config restored' : 'bundle imported', tone: 'err' };

  // ── WARN (P1/P2) ──────────────────────────────────────────────
  if (sev === 'warn' || sev === 'warning' || sev === 'medium')
    return { level: 'warn', label: shortLabel(e) || 'review', tone: 'warn' };
  // MFA disabled / login without a second factor.
  if (e.mfa === false && (cat === 'auth' || verb === 'login' || verb === 'mfa'))
    return { level: 'warn', label: 'no second factor', tone: 'warn' };
  // API-key / secret issuance.
  if (cat === 'secret' && ['create', 'issue', 'add', 'rotate'].includes(verb) && !isFail)
    return { level: 'warn', label: 'key issued', tone: 'warn' };
  // Privileged delete.
  if (verb === 'delete' && ['rbac', 'service', 'route', 'secret', 'access', 'directory'].includes(cat) && !isFail)
    return { level: 'warn', label: 'privileged delete', tone: 'warn' };
  // Denials (recon signal) on a privileged surface.
  if (isFail && (cat === 'access' || cat === 'rbac' || verb === 'deny'))
    return { level: 'warn', label: verb === 'deny' ? 'denied' : 'failed', tone: 'warn' };

  return { level: 'none', label: '', tone: '' };
}

// A concise label for a high-severity event when no known flag names it.
function shortLabel(e: AuditEvent): string {
  if (e.changes?.summary) {
    const s = e.changes.summary;
    return s.length > 40 ? s.slice(0, 38) + '…' : s;
  }
  const flag = (e.changes?.flags ?? []).find(f => f in RISK_FLAG_LABEL);
  if (flag) return RISK_FLAG_LABEL[flag];
  return '';
}

// Reusable risk badge — used on the Audit log, both entity trails, and Signals.
export function RiskBadge({ e }: { e: AuditEvent }) {
  const r = riskOf(e);
  if (r.level === 'none') return null;
  return <Chip tone={r.tone} mono={false} title={`${r.level === 'critical' ? 'Critical' : 'Elevated'} risk · ${r.label}`}><span className="chip-ico">{r.level === 'critical' ? I.alert : I.info}</span>{r.label}</Chip>;
}

// Plain-language sentence for a high-risk row on the hero.
function plainSentence(e: AuditEvent): string {
  if (e.changes?.summary) return e.changes.summary;
  const who = !e.who || e.who === 'system' ? 'The system' : (e.actorName || e.who.split('@')[0]);
  const verb = e.verb || 'changed';
  const what = e.target || e.path || e.category;
  return `${who} ${verb} ${what}`.trim();
}

// ─── Trend helper for the summary band ──────────────────────────────────────
function trend(cur?: number, prev?: number): { dir: 'up' | 'down' | 'flat'; pct: number } | null {
  if (cur == null || prev == null) return null;
  const delta = cur - prev;
  if (delta === 0) return { dir: 'flat', pct: 0 };
  const pct = prev === 0 ? 100 : Math.round((delta / prev) * 100);
  return { dir: delta > 0 ? 'up' : 'down', pct: Math.abs(pct) };
}
function TrendPill({ t }: { t: ReturnType<typeof trend> }) {
  if (!t) return null;
  const glyph = <span className="kv-ico">{t.dir === 'up' ? I.trendUp : t.dir === 'down' ? I.trendDown : I.trendFlat}</span>;
  return <span className="small muted" style={{ fontFamily: 'var(--font-mono)' }}>{glyph} {t.pct}%</span>;
}

// Normalize a failure rate that may arrive as a fraction (0..1) or a percent.
function failurePct(s?: AuditSummary, loaded?: AuditEvent[]): number {
  if (s) {
    if (typeof s.failureRate === 'number') return s.failureRate <= 1 ? s.failureRate * 100 : s.failureRate;
    const r = s.byResult || {};
    const failed = (r.denied || 0) + (r.failed || 0) + (r.error || 0);
    const total = s.total || Object.values(r).reduce((a, b) => a + b, 0);
    return total ? (failed / total) * 100 : 0;
  }
  if (loaded && loaded.length) {
    const failed = loaded.filter(e => e.status === 'failed' || e.verb === 'fail' || e.verb === 'deny').length;
    return (failed / loaded.length) * 100;
  }
  return 0;
}
const rateTone = (pct: number) => (pct >= 10 ? 'err' : pct >= 2 ? 'warn' : 'ok');

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
  const [tab, setTab] = useState<"changes" | "access" | "auth" | "signals">("changes");
  const [cat, setCat] = useState("all");
  const [statusF, setStatusF] = useState("all");
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
  const TAB_META: { id: typeof tab; label: string; sub: string }[] = [
    { id: "changes", label: "Changes", sub: "compliance record" },
    { id: "access",  label: "Access",  sub: "request telemetry" },
    { id: "auth",    label: "Auth",    sub: "sessions" },
    { id: "signals", label: "Signals", sub: "risk only" },
  ];
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
      <div className="page-head">
        <div>
          <h1>Audit</h1>
          <div className="sub">
            Who can do what, and who did what · <span className="mono">{windowLabel}</span>
            {!usingServerSummary && !summaryQ.isLoading && <> · <span className="muted">live summary unavailable — showing the loaded window</span></>}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setPage('accessreview')}>
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.shield}</span>
            Access review
          </button>
        </div>
      </div>

      {/* ── Summary band (posture) ── */}
      <div className="grid g4 mb-12" style={{ gap: 10 }}>
        <button className="stat stat-btn" onClick={scrollToLog}>
          <div className="lbl">Activity</div>
          <div className="val row" style={{ alignItems: 'baseline', gap: 8 }}>{activityVal}<TrendPill t={activityTrend} /></div>
          <div className="sub">events · {windowLabel}</div>
        </button>
        <button className="stat stat-btn" onClick={() => { selectTab('changes'); scrollToLog(); }}>
          <div className="lbl">Changes</div>
          <div className="val row" style={{ alignItems: 'baseline', gap: 8 }}>{changesVal}<TrendPill t={changesTrend} /></div>
          <div className="sub">config mutations</div>
        </button>
        <button className="stat stat-btn" onClick={() => { setStatusF('failed'); scrollToLog(); }}>
          <div className="lbl">Failures / denials</div>
          <div className="val" style={{ color: `var(--${rateTone(failPct)})` }}>{failPct.toFixed(failPct < 10 ? 1 : 0)}%</div>
          <div className="sub">{rateTone(failPct) === 'err' ? 'elevated — investigate' : rateTone(failPct) === 'warn' ? 'above baseline' : 'within baseline'}</div>
        </button>
        <button className="stat stat-btn" onClick={() => setPage('accessreview')}>
          <div className="lbl">Active people</div>
          <div className="val row" style={{ alignItems: 'baseline', gap: 8 }}>{peopleVal}<TrendPill t={peopleTrend} /></div>
          <div className="sub">distinct actors</div>
        </button>
      </div>

      {/* ── HERO: recent high-risk changes ── */}
      <div className="panel mb-12">
        <div className="panel-head">
          <div>
            <h3>Recent high-risk changes</h3>
            <div className="sub">
              Grants of broad power, weakened protection, and mass rewrites
              {riskFromWindow && <> · <span className="muted">from the loaded window (risk endpoint unavailable)</span></>}
            </div>
          </div>
          {riskEvents.length > 0 && <button className="btn ghost sm" onClick={() => { selectTab('signals'); scrollToLog(); }}>All signals →</button>}
        </div>
        <div style={{ padding: 0 }}>
          {riskQ.isLoading && !riskQ.isError ? (
            <div style={{ padding: 20 }}><EmptyHint>Loading…</EmptyHint></div>
          ) : heroEvents.length === 0 ? (
            <div style={{ padding: 18, display: 'flex', gap: 10, alignItems: 'center', color: 'var(--ink-3)' }}>
              <span style={{ color: 'var(--ok)' }}>{I.check}</span>
              <div className="small">No high-risk changes recorded in this window.</div>
            </div>
          ) : (
            heroEvents.map(e => {
              const r = riskOf(e);
              const tone = r.tone || 'warn';
              return (
                <div key={e.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)', borderLeft: `3px solid var(--${tone})` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <RiskBadge e={e} />
                      <span style={{ fontSize: 13, color: 'var(--ink)' }}>{plainSentence(e)}</span>
                    </div>
                    <div className="row small muted mt-4" style={{ gap: 8 }}>
                      {!e.who || e.who === 'system' ? <span className="mono">system</span> : (
                        <span className="row" style={{ gap: 6 }}><Avatar email={e.who} size={16} /><span className="mono">{e.who}</span></span>
                      )}
                      <span>·</span>
                      <span className="mono">{localTime(e.ts) || e.when}</span>
                      {e.service && <><span>·</span><span className="mono">{e.service}</span></>}
                    </div>
                  </div>
                  <button className="btn ghost sm" onClick={() => focusEvent(e)}>Review</button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Analysis row ── */}
      <div className="grid g2 mb-12" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
        <div className="panel">
          <div className="panel-head"><div><h3>Activity by category</h3><div className="sub">Events per category in this window</div></div></div>
          <div className="panel-body col" style={{ gap: 8 }}>
            {catBars.length === 0 ? <EmptyHint>No activity in this window.</EmptyHint> : catBars.map(b => {
              const meta = AUDIT_CATS[b.key];
              return (
                <button key={b.key} onClick={() => { selectTab('changes'); setCat(b.key); scrollToLog(); }}
                  style={{ display: 'grid', gridTemplateColumns: '84px 1fr 40px', gap: 10, alignItems: 'center', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                  <span className="small" style={{ color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 12, height: 12, display: 'grid', placeItems: 'center', opacity: 0.7 }}>{meta ? I[meta.icon] : I.dot}</span>
                    {meta?.label || b.key}
                  </span>
                  <span style={{ position: 'relative', height: 12, background: 'var(--panel-2)', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line)' }}>
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(b.total / maxBar) * 100}%`, background: 'color-mix(in srgb, var(--ink) 22%, transparent)' }} />
                  </span>
                  <span className="small mono muted" style={{ textAlign: 'right' }}>{b.total}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><div><h3>Top denials & actors</h3><div className="sub">Most-denied and most-active in this window</div></div></div>
          <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <div className="input-label">Denials</div>
              {topDenied.length === 0 ? <span className="small muted">— none —</span> : topDenied.map(d => (
                <div key={d.label} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
                  <span className="small mono ellip" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={d.label}>{(d.label || '—').split('@')[0]}</span>
                  <Chip tone="err">{d.count}</Chip>
                </div>
              ))}
            </div>
            <div>
              <div className="input-label">Actors</div>
              {topActors.length === 0 ? <span className="small muted">— none —</span> : topActors.map(d => (
                <div key={d.label} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
                  <span className="small mono ellip" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={d.label}>{(d.label || '—').split('@')[0]}</span>
                  <Chip>{d.count}</Chip>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Activity (merged into the same page as the overview) ── */}
      <div ref={logRef} className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', margin: '22px 0 8px', borderTop: '1px solid var(--line)', paddingTop: 18 }}>
        <div>
          <h3 style={{ margin: 0 }}>Activity</h3>
          <div className="sub">
            Read-only stream · {inTab.length} {tab}
            {failedCount > 0 && <> · <span style={{ color: "var(--err)" }}>{failedCount} denied / failed</span></>}
          </div>
        </div>
        <div className="page-actions">
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }}>{I.search}</span>
            <input className="input" style={{ paddingLeft: 30, minWidth: 280 }} placeholder="Search actor, target, IP, path…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <button className="btn" onClick={exportCsv} disabled={filtered.length === 0}>{I.download} Export CSV</button>
        </div>
      </div>

      {/* Log-layer tabs (contract D1) + Signals (risk only). */}
      <div className="audit-cats" style={{ marginBottom: 8 }}>
        <div className="seg">
          {TAB_META.map(t => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => selectTab(t.id)} title={t.sub}>
              {t.label} <span className="audit-cat-count">{tabCounts[t.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Category pills (scoped to the active tab) */}
      <div className="audit-cats">
        <button className={`audit-cat ${cat === "all" ? "on" : ""}`} onClick={() => setCat("all")}>
          <span>All events</span><span className="audit-cat-count">{inTab.length}</span>
        </button>
        {Object.entries(AUDIT_CATS).map(([key, meta]) => {
          const n = catCounts[key] || 0;
          if (n === 0) return null;
          return (
            <button key={key} className={`audit-cat ${cat === key ? "on" : ""}`} onClick={() => setCat(key)}>
              <span style={{ width: 14, height: 14, display: "grid", placeItems: "center", opacity: 0.7 }}>{I[meta.icon]}</span>
              <span>{meta.label}</span>
              <span className="audit-cat-count">{n}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <div className="seg">
          <button className={statusF === "all" ? "on" : ""} onClick={() => setStatusF("all")}>All</button>
          <button className={statusF === "ok" ? "on" : ""} onClick={() => setStatusF("ok")}>Success</button>
          <button className={statusF === "failed" ? "on" : ""} onClick={() => setStatusF("failed")}>Denied</button>
        </div>
      </div>

      {/* Column header */}
      <div className="audit-head">
        <div>Time</div><div>Actor</div><div>Event</div><div>Context</div><div>Result</div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        {/* Distinguish a failed load from a genuinely empty log — a blank audit
            trail must never be mistaken for "no activity" (finding #6). */}
        {auditError && (
          <div style={{ padding: 28 }}>
            <span className="small" style={{ color: "var(--danger, #c0392b)" }}>
              Failed to load the audit log — this is a load error, not an empty log. Reload to retry;
              do not treat the absence of events as "no activity".
            </span>
          </div>
        )}
        {!auditError && tab === 'signals' && riskQ.isError && riskEvents.length === 0 && (
          <div style={{ padding: 28 }}>
            <span className="small" style={{ color: "var(--danger, #c0392b)" }}>
              Failed to load the risk slice — this is a load error, not "no risk". Reload to retry.
            </span>
          </div>
        )}
        {!auditError && filtered.length === 0 && !(tab === 'signals' && riskQ.isError) && (
          <div style={{ padding: 28 }}><EmptyHint>{auditLoading || (tab === 'signals' && riskQ.isLoading) ? "Loading…" : "No events match."}</EmptyHint></div>
        )}
        {groups.map(g => (
          <div key={g.day} className="audit-day">
            <div className="audit-day-head">
              <span className="audit-day-label">{g.label}</span>
              <span className="audit-day-count">{g.entries.length} event{g.entries.length === 1 ? "" : "s"}</span>
            </div>
            {g.entries.map(e => {
              const meta = AUDIT_CATS[e.category] || { label: e.category, icon: "dot" as const };
              const isFail = e.status === "failed" || e.verb === "fail" || e.verb === "deny";
              const open = openId === e.id;
              const risk = riskOf(e);
              return (
                <div key={e.id} className={`audit-row ${isFail ? "is-fail" : ""} ${open ? "is-open" : ""}`} onClick={() => setOpenId(open ? null : e.id)}
                     style={risk.level !== 'none' && !isFail ? { boxShadow: `inset 2px 0 0 var(--${risk.tone})` } : undefined}>
                  {/* Time */}
                  <div className="audit-col-time">
                    <div className="mono small" style={{ color: "var(--ink)" }}>{localTime(e.ts) || e.when}</div>
                    <div className="small muted">{e.when}</div>
                  </div>

                  {/* Actor */}
                  <div className="audit-col-who">
                    {!e.who || e.who === "system" || e.who === "anon" || e.who === "anonymous" ? (
                      <div className="row" style={{ gap: 8 }}>
                        <div className="audit-sysavatar">{e.who === "anon" || e.who === "anonymous" ? "?" : "S"}</div>
                        <span className="small mono muted">{e.who || "system"}</span>
                      </div>
                    ) : (
                      <div className="row" style={{ gap: 8 }}>
                        <Avatar email={e.who} size={22} />
                        <div style={{ minWidth: 0 }}>
                          <span className="small mono">{e.actorName || (e.who || "").split("@")[0]}</span>
                          {e.actorName && <div className="small muted mono" style={{ fontSize: 10 }}>{e.who}</div>}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Event */}
                  <div className="audit-col-what">
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <span className="audit-cat-tag">
                        <span style={{ width: 11, height: 11, display: "grid", placeItems: "center", opacity: 0.75 }}>{I[meta.icon]}</span>
                        {meta.label}
                      </span>
                      <Chip tone={verbTone(e.verb)}>{e.verb}</Chip>
                      {e.method && <Method m={e.method} />}
                      <RiskBadge e={e} />
                    </div>
                    <div className="mono small" style={{ marginTop: 4, color: "var(--ink)" }}>
                      {e.changes?.summary || e.path || e.target}
                    </div>
                  </div>

                  {/* Context */}
                  <div className="audit-col-meta">
                    <div className="audit-meta-list">
                      {e.service && <span className="audit-kv"><span className="muted">svc</span> {e.service}</span>}
                      {e.statusCode && <span className="audit-kv"><span className="muted">http</span> <span style={{ color: `var(--${statusTone(e.statusCode)})` }}>{e.statusCode}</span></span>}
                      {e.responseTimeMs != null && <span className="audit-kv"><span className="muted">rt</span> {e.responseTimeMs.toFixed(1)}ms</span>}
                      {e.ip && <span className="audit-kv"><span className="muted">ip</span> {e.ip}</span>}
                      {e.ua && <span className="audit-kv ellip"><span className="muted">ua</span> {e.ua}</span>}
                      {e.mfa === true && <span className="audit-kv"><span className="muted">mfa</span> <span className="kv-ico">{I.check}</span></span>}
                      {e.mfa === false && <span className="audit-kv" style={{ color: "var(--err)" }}><span className="muted">mfa</span> <span className="kv-ico">{I.alert}</span></span>}
                    </div>
                  </div>

                  {/* Result */}
                  <div className="audit-col-status">
                    {isFail ? (
                      <Chip tone="err">{e.verb === "deny" ? "denied" : "failed"}</Chip>
                    ) : e.status === "applied" ? (
                      <Chip tone="ok">applied</Chip>
                    ) : e.verb === "allow" ? (
                      <Chip tone="ok">allowed</Chip>
                    ) : (
                      <Chip>ok</Chip>
                    )}
                  </div>

                  {/* Expanded detail */}
                  {open && (
                    <div className="audit-detail" onClick={ev => ev.stopPropagation()}>
                      {/* Before → after diff (change events) */}
                      {e.changes && (e.changes.summary || e.changes.added?.length || e.changes.removed?.length || e.changes.flags?.length || e.changes.fields) && (
                        <div className="panel" style={{ padding: 12, marginBottom: 10 }}>
                          {e.changes.summary && <div className="small" style={{ marginBottom: 8 }}>{e.changes.summary}</div>}
                          {(e.changes.flags?.length ?? 0) > 0 && (
                            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                              {e.changes.flags!.map(f => <Chip key={f} tone="err" mono={false}>{RISK_FLAG_LABEL[f] || f}</Chip>)}
                            </div>
                          )}
                          {(e.changes.added?.length ?? 0) > 0 && (
                            <div className="small" style={{ marginBottom: 4 }}><span className="muted">added</span> {e.changes.added!.map(a => <Chip key={a} tone="ok">+ {a}</Chip>)}</div>
                          )}
                          {(e.changes.removed?.length ?? 0) > 0 && (
                            <div className="small" style={{ marginBottom: 4 }}><span className="muted">removed</span> {e.changes.removed!.map(a => <Chip key={a} tone="err">− {a}</Chip>)}</div>
                          )}
                          {e.changes.fields && Object.entries(e.changes.fields).map(([k, v]) => (
                            <div key={k} className="small mono" style={{ marginTop: 2 }}>
                              <span className="muted">{k}</span> {String(v.from ?? '∅')} → {String(v.to ?? '∅')}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="audit-detail-grid">
                        <div><div className="muted small">Event ID</div><div className="mono small">{e.id}</div></div>
                        <div><div className="muted small">Timestamp</div><div className="mono small">{e.ts || "—"}</div></div>
                        <div><div className="muted small">Category</div><div className="mono small">{e.category}</div></div>
                        <div><div className="muted small">Action</div><div className="mono small">{e.verb}</div></div>
                        {e.severity && <div><div className="muted small">Severity</div><div className="mono small" style={{ color: risk.tone ? `var(--${risk.tone})` : undefined }}>{e.severity}</div></div>}
                        {e.method && <div><div className="muted small">HTTP Method</div><div className="mono small"><Method m={e.method} /></div></div>}
                        {e.path && <div><div className="muted small">Path</div><div className="mono small">{e.path}</div></div>}
                        {e.statusCode && <div><div className="muted small">Status Code</div><div className="mono small" style={{ color: `var(--${statusTone(e.statusCode)})` }}>{e.statusCode}</div></div>}
                        {e.responseTimeMs != null && <div><div className="muted small">Response Time</div><div className="mono small">{e.responseTimeMs.toFixed(2)} ms</div></div>}
                        {e.service && <div><div className="muted small">Service</div><div className="mono small">{e.service}</div></div>}
                        {e.targetEmail && <div><div className="muted small">Target</div><div className="mono small">{e.targetEmail}</div></div>}
                        {e.ip && <div><div className="muted small">IP Address</div><div className="mono small">{e.ip}</div></div>}
                        {e.ua && <div style={{ gridColumn: "span 2" }}><div className="muted small">User Agent</div><div className="mono small">{e.ua}</div></div>}
                        {e.target && e.target !== e.path && <div style={{ gridColumn: "span 2" }}><div className="muted small">Target</div><div className="mono small">{e.target}</div></div>}
                        {e.reason && <div style={{ gridColumn: "span 2" }}><div className="muted small">Reason</div><div className="mono small" style={{ color: "var(--err)" }}>{e.reason}</div></div>}
                      </div>
                      <div className="audit-detail-actions">
                        <button className="btn ghost sm" onClick={() => {
                          navigator.clipboard?.writeText(JSON.stringify(e, null, 2));
                        }}>Copy JSON</button>
                        {(() => {
                          const url = grafanaTraceUrl(e);
                          return url ? (
                            <a className="btn ghost sm" href={url} target="_blank" rel="noopener noreferrer"
                               title="Trace this actor/session in Grafana">Trace in Grafana <span className="kv-ico">{I.arrowOut}</span></a>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {filtered.length > pg.pageSize && (
        <Pagination page={pg.page} pageSize={pg.pageSize} total={filtered.length} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} sizes={[25, 50, 100, 200]} />
      )}
      <div className="small muted" style={{ marginTop: 10, textAlign: "center" }}>
        Showing {filtered.length === 0 ? 0 : pg.from + 1}–{Math.min(pg.to, filtered.length)} of {filtered.length} events{filtered.length < inTab.length ? ` (${inTab.length} in ${tab})` : ""} · read-only
      </div>
      <div className="small muted" style={{ marginTop: 6, textAlign: "center", opacity: 0.7 }}>
        Retention is bounded by the audit stream cap and is not tamper-evident (Redis-only store). A durable/WORM store is a documented upgrade path.
      </div>
    </>
  );
}
