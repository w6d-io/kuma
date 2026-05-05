import { useState, useEffect, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Chip, Method, Avatar } from '../components/ui/Primitives';
import { resolvePerms } from '../hooks/useRbac';
import { api, type SimulateResponse } from '../api/client';

type TraceStep = { id: string; stage: string; label: string; detail: string; tone: string; body?: string };
type Decision = { steps: TraceStep[]; allowed: boolean; reason: string; latency: number };

// Maps the SimulateResponse from jinbe (which forwards to OPA's data.rbac.simulate
// rule) into the trace step shape rendered below. The trace mirrors the runtime
// pipeline (oathkeeper → opa) without re-deriving any authorization logic in JS,
// so a green ALLOW here cannot drift from a request-time deny.
function buildDecision(res: SimulateResponse, service: string, latency: number): Decision {
  const steps: TraceStep[] = [];
  const matched = res.matchedRule;

  steps.push({
    id: 'route',
    stage: 'oathkeeper',
    label: `Route map lookup · ${matched?.method ?? '?'} ${matched?.path ?? ''}`,
    detail: matched ? `matched ${matched.method} ${matched.path}` : 'no match',
    tone: matched ? 'ok' : 'warn',
    body: matched
      ? matched.permission ? `requires "${matched.permission}"` : 'public'
      : 'falls through to deny',
  });

  if (!matched) {
    return { steps, allowed: res.allowed, reason: 'route_not_found', latency };
  }

  if (!matched.permission) {
    steps.push({
      id: 'bypass', stage: 'oathkeeper',
      label: 'Public endpoint — skipping OPA',
      detail: 'no permission gate', tone: 'ok',
    });
    return { steps, allowed: true, reason: 'public', latency };
  }

  const groups = res.userInfo.groups;
  steps.push({
    id: 'kratos', stage: 'opa', label: 'Identity → groups',
    detail: groups.length ? groups.join(', ') : '(none)',
    tone: groups.length ? 'ok' : 'warn',
  });

  const roles = res.userInfo.roles;
  steps.push({
    id: 'roles', stage: 'opa', label: 'Groups → roles',
    detail: roles.length ? roles.map(r => `${service}:${r}`).join(', ') : '(none)',
    tone: roles.length ? 'ok' : 'err',
  });

  const perms = res.userInfo.permissions;
  const hasWildcard = perms.includes('*');
  const hasPerm = perms.includes(matched.permission) || hasWildcard;

  steps.push({
    id: 'check', stage: 'opa',
    label: `Permission check · "${matched.permission}"`,
    detail: hasPerm ? 'granted' : 'not granted',
    tone: hasPerm ? 'ok' : 'err',
    body: hasPerm
      ? hasWildcard ? 'super_admin wildcard ("*")' : `permission present in user_permissions`
      : `no role grants "${matched.permission}"`,
  });

  if (!res.allowed) {
    return { steps, allowed: false, reason: 'not_authorized', latency };
  }

  steps.push({ id: 'opa_allow', stage: 'opa', label: 'OPA decision', detail: 'allow', tone: 'ok' });
  steps.push({ id: 'forward', stage: 'upstream', label: `Forward to ${service}-upstream`, detail: 'with X-User / X-Groups headers', tone: 'ok' });
  return { steps, allowed: true, reason: 'authorized', latency };
}

export function SimulatorPage() {
  const { state, setPage, setUserDrawer } = useApp();
  const [userId, setUserId] = useState(state.users[1]?.id || "");
  const [service, setService] = useState("jinbe");
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/api/clusters/");

  const user = state.users.find(u => u.id === userId);
  const services = state.services.map(s => s.name).filter(n => n !== "global");

  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  // Debounced live OPA query — fires on any input change.
  useEffect(() => {
    if (!user) { setDecision(null); return; }
    const myId = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const t0 = performance.now();
      try {
        const res = await api.simulate({ email: user.email, service, method, path });
        if (myId !== reqId.current) return; // stale
        const latency = Math.round(performance.now() - t0);
        setDecision(buildDecision(res, service, latency));
      } catch (e) {
        if (myId !== reqId.current) return;
        const status = (e as { status?: number }).status;
        setError(status === 503 ? 'OPA unreachable — request-time decisions cannot be previewed.' : 'Simulator query failed.');
        setDecision(null);
      } finally {
        if (myId === reqId.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [user, service, method, path]);

  const verdictTone = !decision ? "info" : decision.allowed ? "ok" : "err";
  const verdictText = !decision ? "—" : decision.allowed ? "ALLOW" : "DENY";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Permission simulator</h1>
          <div className="sub">Live <span className="mono">oathkeeper → opa</span> decision via <span className="mono">POST /api/admin/rbac/simulate</span>. Same code path as request-time auth.</div>
        </div>
      </div>
      <div className="grid mb-12" style={{ gridTemplateColumns: "1fr 1.35fr", gap: 10 }}>
        <div className="panel">
          <div className="panel-head"><div><h3>Request</h3><div className="sub">What to simulate</div></div></div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="input-label">Identity</label>
              <select className="input mono" value={userId} onChange={e => setUserId(e.target.value)}>
                {state.users.map(u => <option key={u.id} value={u.id}>{u.email} — {u.groups.join(",") || "no groups"}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label">Service</label>
              <select className="input mono" value={service} onChange={e => setService(e.target.value)}>
                {services.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "110px 1fr", gap: 8 }}>
              <div>
                <label className="input-label">Method</label>
                <select className="input mono" value={method} onChange={e => setMethod(e.target.value)}>
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="input-label">Path</label>
                <input className="input mono" value={path} onChange={e => setPath(e.target.value)} placeholder="/api/..." />
              </div>
            </div>
            <div>
              <div className="input-label">Quick routes</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(state.routeMaps[service] || []).slice(0, 8).map((r, i) => (
                  <button key={i} className="chip" style={{ cursor: "pointer", fontFamily: "var(--font-mono)" }} onClick={() => { setMethod(r.method); setPath(r.path); }}>
                    <Method m={r.method} /> {r.path}
                  </button>
                ))}
              </div>
            </div>
            {user && (
              <div className="panel" style={{ padding: 10, background: "var(--panel-2)" }}>
                <div className="row" style={{ gap: 10 }}>
                  <Avatar email={user.email} size={28} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 12.5 }}>{user.name}</div>
                    <div className="small muted mono">{user.email}</div>
                    <div className="row mt-4" style={{ flexWrap: "wrap", gap: 4 }}>
                      {user.groups.length === 0 && <Chip tone="warn">no groups</Chip>}
                      {user.groups.map(g => <Chip key={g}>{g}</Chip>)}
                    </div>
                  </div>
                  <button className="btn ghost sm" onClick={() => setUserDrawer({ mode: "edit", user })}>Edit</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div><h3>Decision</h3><div className="sub">{loading ? 'Querying OPA…' : 'Live OPA decision'}</div></div>
            <div className="row" style={{ gap: 8 }}>
              {decision && <span className="mono small muted">{decision.latency} ms</span>}
              <div className={`verdict verdict-${verdictTone}`}>
                {decision?.allowed ? I.check : decision ? I.alert : I.info}
                <span>{verdictText}</span>
              </div>
            </div>
          </div>
          {error && (
            <div className="panel-body">
              <div className="small" style={{ color: 'var(--err, #ef4444)', padding: 12 }}>{error}</div>
            </div>
          )}
          {!error && decision && (
            <div className="panel-body">
              <ol className="trace">
                {decision.steps.map((s, i) => (
                  <li key={s.id} className={`trace-step trace-${s.tone}`}>
                    <div className="trace-dot"><span>{i + 1}</span></div>
                    <div className="trace-body">
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <div className="trace-label">
                          <span className="trace-stage mono">{s.stage}</span>
                          <span>{s.label}</span>
                        </div>
                        <span className="small mono" style={{ color: s.tone === "ok" ? "var(--ok)" : s.tone === "err" ? "var(--err)" : "var(--ink-3)" }}>{s.detail}</span>
                      </div>
                      {s.body && <div className="small muted mono mt-4">{s.body}</div>}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="simulator-reason">
                {decision.reason === "public" && "Route is public (no permission required). OPA not consulted."}
                {decision.reason === "not_authorized" && "OPA returned allow = false. No role grants the required permission."}
                {decision.reason === "authorized" && "OPA returned allow = true. Request forwarded to upstream with identity headers."}
                {decision.reason === "no_rule" && "No Oathkeeper access rule covers this service."}
                {decision.reason === "route_not_found" && "No route_map entry matches this method + path."}
                {decision.reason === "auth_failed" && "Authentication failed. Identity is inactive or no session cookie."}
              </div>
              {!decision.allowed && (
                <div className="row mt-12" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => setPage("groups")}>Adjust group roles →</button>
                  <button className="btn sm" onClick={() => setPage("users")}>Reassign user →</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {user && (() => {
        const { roles, perms } = resolvePerms(user, state);
        const svcs = Object.keys(state.roles);
        const hasAny = svcs.some(s => (perms[s] && perms[s].size) || (roles[s] && roles[s].length));
        if (!hasAny) return null;
        return (
          <div className="panel mb-12">
            <div className="panel-head"><div><h3>Effective permissions · {user.email}</h3></div></div>
            <div style={{ padding: 0 }}>
              <table className="table">
                <thead><tr><th>Service</th><th>Roles</th><th>Permissions</th></tr></thead>
                <tbody>
                  {svcs.map(svc => {
                    const svcRoles = roles[svc] || [];
                    const svcPerms = Array.from(perms[svc] || []);
                    if (svcRoles.length === 0) return null;
                    return (
                      <tr key={svc} style={{ background: svc === service ? "var(--accent-soft)" : undefined }}>
                        <td className="mono" style={{ fontWeight: 500, width: 120 }}>{svc}</td>
                        <td><span className="row" style={{ flexWrap: "wrap", gap: 4 }}>{svcRoles.map(r => <Chip key={r} tone="accent">{r}</Chip>)}</span></td>
                        <td>{svcPerms.includes("*") ? <Chip tone="err">* (full access)</Chip> : <span className="row" style={{ flexWrap: "wrap", gap: 4 }}>{svcPerms.slice(0, 12).map(p => <span key={p} className="perm-chip mono">{p}</span>)}{svcPerms.length > 12 && <span className="small muted">+{svcPerms.length - 12} more</span>}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </>
  );
}
