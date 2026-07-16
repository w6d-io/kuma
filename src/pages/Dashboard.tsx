import React, { useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession, useAudit } from '../api/hooks';
import { I } from '../components/ui/Icons';
import { Chip, Avatar } from '../components/ui/Primitives';
import { ROLE_LEVEL } from '../hooks/useRbac';

export function DashboardPage() {
  const app = useApp();
  const { state, setPage, setUserDrawer, setGroupDrawer, setServiceDrawer, apiError } = app;
  // Real audit stream (not the SEED-polluted AppContext.audit mirror — same
  // fix as the Audit page; "Recent changes" must show real events only).
  const { data: audit = [] } = useAudit();
  const { data: session } = useSession();
  const hasAdmin = !!session?.permissions?.some((p) => p === '*' || p === 'admin:read');
  const isForbidden = !hasAdmin || (apiError as { status?: number } | null)?.status === 403;

  const totalUsers = state.users.length;
  const activeUsers = state.users.filter(u => u.active).length;
  const totalGroups = Object.keys(state.groups).length;
  const totalServices = state.services.length;

  const issues = useMemo(() => {
    const out: { kind: string; msg: string; where: string }[] = [];
    Object.entries(state.groups).forEach(([g, map]) => {
      Object.entries(map).forEach(([svc, roles]) => {
        const svcRoles = state.roles[svc];
        if (!svcRoles) { out.push({ kind: "err", msg: `group "${g}" references service "${svc}" which has no roles`, where: svc }); return; }
        roles.forEach(r => { if (!svcRoles[r]) out.push({ kind: "err", msg: `group "${g}" → ${svc}:${r} — role not defined`, where: `${g}` }); });
      });
    });
    Object.entries(state.routeMaps).forEach(([svc, routes]) => {
      const svcRoles = state.roles[svc] || {};
      const allPerms = new Set<string>();
      Object.values(svcRoles).forEach(perms => perms.forEach(p => allPerms.add(p)));
      routes.forEach(r => {
        if (r.permission && !allPerms.has(r.permission) && !Object.values(svcRoles).some(ps => ps.includes("*"))) {
          out.push({ kind: "warn", msg: `${svc}: ${r.method} ${r.path} requires "${r.permission}" — no role grants it`, where: svc });
        }
      });
    });
    state.users.forEach(u => {
      u.groups.forEach(g => { if (!state.groups[g]) out.push({ kind: "err", msg: `user ${u.email} → group "${g}" does not exist`, where: u.email }); });
    });
    return out;
  }, [state]);

  // Real, permission-derived signals only. (The old "dormant > 7 days" signal
  // was a regex over a display string that actually matched "≥ 1 day / never"
  // — cut until there is a real last-active timestamp to key on.)
  const signals = useMemo(() => {
    const out: { id: string; label: string; value: number; total: number; tone: string; hint: string; onClick: () => void }[] = [];
    const wildcardHolders = state.users.filter(u => u.groups.some(g => {
      const gm = state.groups[g] || {};
      return Object.entries(gm).some(([svc, roles]) => roles.some(r => (state.roles[svc]?.[r] || []).includes("*")));
    }));
    out.push({ id: "super", label: "Full-access users", value: wildcardHolders.length, total: state.users.length, tone: wildcardHolders.length > 3 ? "warn" : "ok", hint: wildcardHolders.length ? "Hold a wildcard (*) permission — review periodically" : "No user holds a wildcard", onClick: () => setPage("users") });
    const orphans = state.users.filter(u => u.groups.length === 0);
    out.push({ id: "orphan", label: "Users without groups", value: orphans.length, total: state.users.length, tone: orphans.length ? "warn" : "ok", hint: orphans.length ? "Can't reach anything until assigned" : "Every user is assigned", onClick: () => setPage("users") });
    let wildcards = 0;
    Object.entries(state.roles).forEach(([, m]) => { Object.entries(m).forEach(([, perms]) => { if (perms.includes("*")) wildcards++; }); });
    out.push({ id: "wild", label: "Wildcard (*) roles", value: wildcards, total: Object.values(state.roles).reduce((a, m) => a + Object.keys(m).length, 0), tone: wildcards ? "info" : "ok", hint: "Grant every permission in their service", onClick: () => setPage("services") });
    return out;
  }, [state, setPage]);

  const matrixServices = state.services.map(s => s.name).filter(n => n !== "global");
  const groupRows = Object.entries(state.groups)
    .map(([g, m]) => {
      const cells = matrixServices.map(svc => {
        const roles = m[svc] || [];
        const highest = roles.reduce((acc, r) => Math.max(acc, ROLE_LEVEL[r] ?? 2), -1);
        return { svc, roles, level: highest };
      });
      const sum = cells.reduce((a, c) => a + (c.level + 1), 0);
      return { g, cells, sum, usersCount: state.users.filter(u => u.groups.includes(g)).length };
    })
    .sort((a, b) => b.sum - a.sum);

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
          <div className="sub">{totalUsers} users · {totalGroups} groups · {totalServices} services</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setPage("simulator")}>
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.sparkle}</span>
            Simulate access
          </button>
          <button className="btn primary" onClick={() => setUserDrawer({ mode: "assign" })}>
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.plus}</span>
            Assign user to group
          </button>
        </div>
      </div>

      {/* KPIs — real, actionable counts only */}
      <div className="grid g3 mb-12" style={{ gap: 10 }}>
        <StatBtn lbl="Users" val={state.usersLoading ? `${totalUsers}+` : totalUsers} sub={`${activeUsers} active · ${totalUsers - activeUsers} inactive`} onClick={() => setPage("users")} />
        <StatBtn lbl="Groups" val={totalGroups} sub="bundles of roles across services" onClick={() => setPage("groups")} />
        <StatBtn lbl="Services" val={totalServices} sub="apps with their own roles" onClick={() => setPage("services")} />
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

      {/* Matrix + Needs attention */}
      <div className="grid g2 mb-12" style={{ gridTemplateColumns: "1.55fr 1fr", gap: 10 }}>
        <div className="panel">
          <div className="panel-head">
            <div><h3>Group × service coverage</h3><div className="sub">Darker cell = higher privilege</div></div>
            <div className="row" style={{ gap: 6 }}>
              <span className="small muted">none</span>
              {[0, 1, 2, 3, 4].map(l => <div key={l} className={`mx-legend mx-l${l}`} />)}
              <span className="small muted">admin</span>
            </div>
          </div>
          <div style={{ padding: 14, overflowX: "auto" }}>
            <table className="matrix">
              <thead>
                <tr>
                  <th className="matrix-corner"></th>
                  {matrixServices.map(svc => <th key={svc} className="matrix-col"><span className="mono">{svc}</span></th>)}
                  <th className="matrix-col small muted" style={{ textAlign: "right", paddingRight: 2 }}>users</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map(row => (
                  <tr key={row.g} className="matrix-row" onClick={() => setGroupDrawer({ mode: "edit", name: row.g })}>
                    <th className="matrix-group"><span className="mono">{row.g}</span></th>
                    {row.cells.map(c => (
                      <td key={c.svc} className="matrix-cell">
                        {c.level < 0 ? (
                          <div className="mx-dot mx-empty" title="no access" />
                        ) : (
                          <div className={`mx-dot mx-l${c.level}`} title={c.roles.join(", ")}>
                            <span className="mono">{c.roles.slice(0, 2).join(", ")}{c.roles.length > 2 ? ` +${c.roles.length - 2}` : ""}</span>
                          </div>
                        )}
                      </td>
                    ))}
                    <td className="matrix-cell" style={{ textAlign: "right", paddingRight: 4 }}>
                      <span className="mono small muted">{row.usersCount}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div><h3>Needs attention</h3><div className="sub">{issues.length === 0 ? "no integrity issues" : `${issues.length} issue${issues.length > 1 ? "s" : ""}`}</div></div>
            {issues.length === 0 ? <Chip tone="ok">healthy</Chip> : <Chip tone="warn">{issues.length}</Chip>}
          </div>
          <div style={{ padding: 0 }}>
            {issues.length === 0 ? (
              <div style={{ padding: 20, display: "flex", gap: 10, alignItems: "center", color: "var(--ink-3)" }}>
                <span style={{ color: "var(--ok)" }}>{I.check}</span>
                <div>
                  <div style={{ color: "var(--ink-2)", fontSize: 12.5 }}>All groups reference valid roles.</div>
                  <div className="small muted mt-4">Every permission in a route is granted by at least one role.</div>
                </div>
              </div>
            ) : (
              <div>
                {issues.slice(0, 8).map((it, i) => (
                  <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ color: it.kind === "err" ? "var(--err)" : "var(--warn)", marginTop: 1 }}>{it.kind === "err" ? I.alert : I.info}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="small" style={{ color: "var(--ink)" }}>{it.msg}</div>
                      <div className="small muted mono mt-4">{it.where}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
            <QuickAction ico={I.group} title="New group" sub="Bundle roles across services" onClick={() => setGroupDrawer({ mode: "create" })} />
            <QuickAction ico={I.service} title="Register service" sub="Add an app with its own roles" onClick={() => setServiceDrawer({ mode: "create" })} />
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
