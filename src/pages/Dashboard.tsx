import React, { useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession, useAudit, useStats, useAuditEvents } from '../api/hooks';
import { I } from '../components/ui/Icons';
import { Chip, Avatar } from '../components/ui/Primitives';
import { riskOf } from './Audit';

export function DashboardPage() {
  const app = useApp();
  const { state, setPage, setGrant, apiError, setAuditFocus } = app;
  // Real audit stream (not the SEED-polluted AppContext.audit mirror — same
  // fix as the Audit page; "Recent changes" must show real events only).
  const { data: audit = [] } = useAudit();
  // Server-authoritative high-risk slice (spans retained history). Fail-closed:
  // on error, derive from the loaded window via the shared riskOf classifier.
  const riskQ = useAuditEvents({ risk: 'high', limit: 100 });
  const riskEvents = riskQ.isSuccess ? riskQ.data : audit.filter(e => riskOf(e).level !== 'none');
  const goSignals = () => { setAuditFocus({ tab: 'signals' }); setPage('audit'); };

  const securityCards = useMemo(() => {
    const has = (e: typeof riskEvents[number], f: string) => (e.changes?.flags ?? []).includes(f);
    const grants = riskEvents.filter(e => has(e, 'grants_super_admin') || has(e, 'wildcard_permission') || (e.changes?.added ?? []).includes('*')).length;
    const keys = riskEvents.filter(e => (e.category || '') === 'secret' && ['create', 'issue', 'add', 'rotate'].includes(e.verb)).length;
    const denials = audit.filter(e => e.status === 'failed' || e.verb === 'fail' || e.verb === 'deny').length;
    const critical = riskEvents.filter(e => riskOf(e).level === 'critical').length;
    return [
      { id: 'grants', label: 'Privileged grants', value: grants, tone: grants ? 'err' : 'ok', hint: 'super-admin or wildcard (*) granted' },
      { id: 'keys', label: 'Keys issued', value: keys, tone: keys ? 'warn' : 'ok', hint: 'secrets / API keys created' },
      { id: 'denials', label: 'Denials', value: denials, tone: denials > 10 ? 'err' : denials ? 'warn' : 'ok', hint: 'access denied / failed (loaded window)' },
      { id: 'critical', label: 'High-risk events', value: critical, tone: critical ? 'err' : 'ok', hint: 'critical severity in the window' },
    ];
  }, [riskEvents, audit]);
  const { data: session } = useSession();
  // Directory counts from the cached stats endpoint — no full-directory walk.
  const { data: stats } = useStats();
  const hasAdmin = !!session?.permissions?.some((p) => p === '*' || p === 'admin:read');
  const isForbidden = !hasAdmin || (apiError as { status?: number } | null)?.status === 403;

  const totalUsers = stats?.total ?? state.users.length;
  const activeUsers = stats?.active ?? state.users.filter(u => u.active).length;
  const totalGroups = Object.keys(state.groups).length;

  // The integrity checks that lived here walked group → service → role and the route maps, all from
  // the registry this console used to keep. The engine decides against documents synced from Git, so
  // the same question — a route requiring a permission no role carries — is answered on the APIs
  // screen, against what is actually loaded.

  // Real, permission-derived signals only. (The old "dormant > 7 days" signal
  // was a regex over a display string that actually matched "≥ 1 day / never"
  // — cut until there is a real last-active timestamp to key on.)
  const signals = useMemo(() => {
    const out: { id: string; label: string; value: number; total: number; tone: string; hint: string; onClick: () => void }[] = [];
    // Full-access users: hold a group granting a wildcard (*). From the cached
    // stats walk — no client-side directory scan.
    const fullAccess = stats?.fullAccess ?? 0;
    out.push({ id: "super", label: "Full-access users", value: fullAccess, total: stats?.total ?? state.users.length, tone: fullAccess > 3 ? "warn" : "ok", hint: fullAccess ? "Hold a wildcard (*) permission — review periodically" : "No user holds a wildcard", onClick: () => setPage("users") });
    // Empty groups: defined but with no members — cleanup candidates.
    const emptyGroups = stats ? Object.keys(state.groups).filter(g => !stats.perGroup[g]) : [];
    out.push({ id: "empty", label: "Empty groups", value: emptyGroups.length, total: Object.keys(state.groups).length, tone: emptyGroups.length ? "info" : "ok", hint: emptyGroups.length ? "No members — candidates for cleanup" : "Every group has members", onClick: () => setPage("groups") });
    return out;
  }, [state, stats, setPage]);


  // A non-admin (e.g. a delegated org admin) legitimately has no access to the
  // platform console — but their landing page must not be a red brick wall.
  // Point them at the surface they *can* use instead of "Access denied".
  if (isForbidden) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: 24 }}>
        <div className="panel" style={{ maxWidth: 520, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14 }}>
          <span style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>{I.globe}</span>
          <div style={{ fontWeight: 600, fontSize: 17 }}>Manage your organization</div>
          <div className="small muted" style={{ lineHeight: 1.6 }}>
            The platform console is for administrators. You can invite and manage the people in your organization from the Org Admin area.
          </div>
          <button className="btn primary" onClick={() => setPage("orgadmin")}>Go to Org Admin</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <div className="sub">{totalUsers} users · {totalGroups} groups</div>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setGrant({})}>
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.shield}</span>
            Grant access
          </button>
        </div>
      </div>

      {/* KPIs — real, actionable counts only */}
      <div className="grid g3 mb-12" style={{ gap: 10 }}>
        <StatBtn lbl="Users" val={totalUsers} sub={`${activeUsers} active · ${totalUsers - activeUsers} inactive`} onClick={() => setPage("users")} />
        <StatBtn lbl="Groups" val={totalGroups} sub="bundles of roles across services" onClick={() => setPage("groups")} />
      </div>

      {/* Security signals — deep-link into the Audit "Signals" (risk-only) tab */}
      <div className="panel mb-12">
        <div className="panel-head">
          <div><h3>Security signals</h3><div className="sub">Risk activity — click to open the Signals log</div></div>
          <button className="btn ghost sm" onClick={goSignals}>Open Signals →</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
          {securityCards.map((c, i) => (
            <button key={c.id} onClick={goSignals}
              style={{ padding: "14px 16px", textAlign: "left", background: "transparent", border: "none", borderLeft: i ? "1px solid var(--line)" : "none", cursor: "pointer", display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <span className="small muted">{c.label}</span>
                {c.tone !== "ok" && <Chip tone={c.tone}>{c.tone === "err" ? "review" : "watch"}</Chip>}
              </div>
              <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.4, color: c.value ? `var(--${c.tone})` : "var(--ink)" }}>{c.value}</span>
              <div className="small muted">{c.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Signals */}
      <div className="panel mb-12">
        <div className="panel-head">
          <div><h3>Signals</h3><div className="sub">Quick read on access posture</div></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
          {signals.map((s, i) => (
            <button key={s.id} onClick={s.onClick}
              style={{ padding: "14px 16px", textAlign: "left", background: "transparent", border: "none", borderLeft: i ? "1px solid var(--line)" : "none", cursor: "pointer", display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <span className="small muted">{s.label}</span>
                <Chip tone={s.tone}>{s.tone === "ok" ? "ok" : s.tone === "warn" ? "review" : "info"}</Chip>
              </div>
              <div className="row" style={{ alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.4 }}>{s.value}</span>
                <span className="muted small">/ {s.total}</span>
              </div>
              <div className="small muted">{s.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Activity + Quick actions */}
      <div className="grid g2 mb-12" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 10 }}>
        <div className="panel">
          <div className="panel-head">
            <div><h3>Recent changes</h3><div className="sub">Latest configuration changes</div></div>
            <button className="btn ghost sm" onClick={() => setPage("audit")}>View all →</button>
          </div>
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Change</th><th>Status</th></tr></thead>
            <tbody>
              {audit.slice(0, 6).map(c => (
                <tr key={c.id}>
                  <td className="muted nowrap">{c.when}</td>
                  <td>{!c.who || c.who === "system" ? <span className="mono muted">{c.who || "system"}</span> : <span className="row" style={{ gap: 6 }}><Avatar email={c.who} size={18} /><span className="small">{(c.who || "").split("@")[0]}</span></span>}</td>
                  <td><span className="mono small"><b style={{ fontWeight: 600 }}>{c.verb}</b> {c.target}</span></td>
                  <td>
                    {c.status === "applied" && <Chip tone="ok">applied</Chip>}
                    {c.status === "failed" && <Chip tone="err">failed</Chip>}
                  </td>
                </tr>
              ))}
              {audit.length === 0 && (
                <tr><td colSpan={4} className="muted small" style={{ padding: 16 }}>No changes recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-head"><div><h3>Quick actions</h3><div className="sub">Common operations</div></div></div>
          <div className="panel-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <QuickAction ico={I.shield} title="See what is enforced" sub="Each API, its routes, and who can reach them" onClick={() => setPage("apis")} />
          </div>
        </div>
      </div>
    </>
  );
}

function StatBtn({ lbl, val, sub, onClick }: { lbl: string; val: number | string; sub: string; onClick: () => void }) {
  return (
    <button className="stat stat-btn" onClick={onClick}>
      <div className="lbl">{lbl}</div>
      <div className="val">{val}</div>
      <div className="sub">{sub}</div>
    </button>
  );
}

function QuickAction({ ico, title, sub, onClick }: { ico: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button className="panel quick-action" onClick={onClick}>
      <span className="quick-action-ico">{ico}</span>
      <div>
        <div style={{ fontWeight: 500, fontSize: 12.5 }}>{title}</div>
        <div className="small muted mt-4">{sub}</div>
      </div>
    </button>
  );
}
