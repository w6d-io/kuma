import React, { useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession, useAudit, useStats, useAuditEvents } from '../api/hooks';
import { Avatar, Badge, Button, ButtonBase, Card, EmptyRow, PageHeader, Stat, Table, I, cx, type BadgeTone } from '../components/ui';
import { riskOf } from './audit/lib';

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
    return ([
      { id: 'grants', label: 'Privileged grants', value: grants, tone: grants ? 'danger' : 'success', hint: 'super-admin or wildcard (*) granted' },
      { id: 'keys', label: 'Keys issued', value: keys, tone: keys ? 'warning' : 'success', hint: 'secrets / API keys created' },
      { id: 'denials', label: 'Denials', value: denials, tone: denials > 10 ? 'danger' : denials ? 'warning' : 'success', hint: 'access denied / failed (loaded window)' },
      { id: 'critical', label: 'High-risk events', value: critical, tone: critical ? 'danger' : 'success', hint: 'critical severity in the window' },
    ] as { id: string; label: string; value: number; tone: BadgeTone; hint: string }[]);
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
    const out: { id: string; label: string; value: number; total: number; tone: BadgeTone; hint: string; onClick: () => void }[] = [];
    // Full-access users: hold a group granting a wildcard (*). From the cached
    // stats walk — no client-side directory scan.
    const fullAccess = stats?.fullAccess ?? 0;
    out.push({ id: "super", label: "Full-access users", value: fullAccess, total: stats?.total ?? state.users.length, tone: fullAccess > 3 ? "warning" : "success", hint: fullAccess ? "Hold a wildcard (*) permission — review periodically" : "No user holds a wildcard", onClick: () => setPage("users") });
    // Empty groups: defined but with no members — cleanup candidates.
    const emptyGroups = stats ? Object.keys(state.groups).filter(g => !stats.perGroup[g]) : [];
    out.push({ id: "empty", label: "Empty groups", value: emptyGroups.length, total: Object.keys(state.groups).length, tone: emptyGroups.length ? "info" : "success", hint: emptyGroups.length ? "No members — candidates for cleanup" : "Every group has members", onClick: () => setPage("groups") });
    return out;
  }, [state, stats, setPage]);


  // A non-admin (e.g. a delegated org admin) legitimately has no access to the
  // platform console — but their landing page must not be a red brick wall.
  // Point them at the surface they *can* use instead of "Access denied".
  if (isForbidden) {
    return (
      <div className="dash-forbidden">
        <Card pad="md" className="dash-forbidden-card">
          <span className="dash-forbidden-ico">{I.globe}</span>
          <div className="text-lg fw-semibold">Manage your organization</div>
          <div className="small muted leading-relaxed">
            The platform console is for administrators. You can invite and manage the people in your organization from the Org Admin area.
          </div>
          <Button variant="primary" onClick={() => setPage("orgadmin")}>Go to Org Admin</Button>
        </Card>
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Overview"
        sub={`${totalUsers} users · ${totalGroups} groups`}
        actions={<Button variant="primary" icon={I.shield} onClick={() => setGrant({})}>Grant access</Button>}
      />

      {/* KPIs — real, actionable counts only */}
      <div className="grid g3 mb-12">
        <Stat label="Users" value={totalUsers} sub={`${activeUsers} active · ${totalUsers - activeUsers} inactive`} onClick={() => setPage("users")} />
        <Stat label="Groups" value={totalGroups} sub="bundles of roles across services" onClick={() => setPage("groups")} />
      </div>

      {/* Security signals — deep-link into the Audit "Signals" (risk-only) tab */}
      <Card
        className="mb-12"
        title="Security signals"
        sub="Risk activity — click to open the Signals log"
        actions={<Button variant="ghost" size="sm" onClick={goSignals}>Open Signals →</Button>}
        pad="none"
      >
        <div className="signal-grid cols-4">
          {securityCards.map(c => (
            <ButtonBase key={c.id} className="signal-tile" onClick={goSignals}>
              <div className="row justify-between">
                <span className="small muted">{c.label}</span>
                {c.tone !== "success" && <Badge tone={c.tone}>{c.tone === "danger" ? "review" : "watch"}</Badge>}
              </div>
              <span className={cx("signal-value", c.value ? `text-${c.tone}` : undefined)}>{c.value}</span>
              <div className="small muted">{c.hint}</div>
            </ButtonBase>
          ))}
        </div>
      </Card>

      {/* Signals */}
      <Card className="mb-12" title="Signals" sub="Quick read on access posture" pad="none">
        <div className="signal-grid cols-3">
          {signals.map(s => (
            <ButtonBase key={s.id} className="signal-tile" onClick={s.onClick}>
              <div className="row justify-between">
                <span className="small muted">{s.label}</span>
                <Badge tone={s.tone}>{s.tone === "success" ? "ok" : s.tone === "warning" ? "review" : "info"}</Badge>
              </div>
              <div className="row items-baseline gap-4">
                <span className="signal-value">{s.value}</span>
                <span className="muted small">/ {s.total}</span>
              </div>
              <div className="small muted">{s.hint}</div>
            </ButtonBase>
          ))}
        </div>
      </Card>

      {/* Activity + Quick actions */}
      <div className="grid dash-split mb-12">
        <Card
          title="Recent changes"
          sub="Latest configuration changes"
          actions={<Button variant="ghost" size="sm" onClick={() => setPage("audit")}>View all →</Button>}
          pad="none"
        >
          <Table>
            <thead><tr><th>When</th><th>Who</th><th>Change</th><th>Status</th></tr></thead>
            <tbody>
              {audit.slice(0, 6).map(c => (
                <tr key={c.id}>
                  <td className="muted nowrap">{c.when}</td>
                  <td>{!c.who || c.who === "system" ? <span className="mono muted">{c.who || "system"}</span> : <span className="row gap-4"><Avatar email={c.who} size={18} /><span className="small">{(c.who || "").split("@")[0]}</span></span>}</td>
                  <td><span className="mono small"><b className="fw-semibold">{c.verb}</b> {c.target}</span></td>
                  <td>
                    {c.status === "applied" && <Badge tone="success">applied</Badge>}
                    {c.status === "failed" && <Badge tone="danger">failed</Badge>}
                  </td>
                </tr>
              ))}
              {audit.length === 0 && <EmptyRow colSpan={4}>No changes recorded yet.</EmptyRow>}
            </tbody>
          </Table>
        </Card>

        <Card title="Quick actions" sub="Common operations">
          <div className="grid g2">
            <QuickAction ico={I.shield} title="Who can do what" sub="Each site's routes, the permission they need, and who holds it" onClick={() => setPage("roles")} />
          </div>
        </Card>
      </div>
    </>
  );
}

function QuickAction({ ico, title, sub, onClick }: { ico: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <ButtonBase className="quick-action" onClick={onClick}>
      <span className="quick-action-ico">{ico}</span>
      <div>
        <div className="fw-medium">{title}</div>
        <div className="small muted mt-4">{sub}</div>
      </div>
    </ButtonBase>
  );
}
