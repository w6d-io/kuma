import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Method, EmptyHint } from '../components/ui/Primitives';
import { Pagination, usePagination } from '../components/ui/Pagination';

const AUDIT_CATS: Record<string, { label: string; icon: keyof typeof I }> = {
  auth: { label: "Auth", icon: "key" },
  access: { label: "Access", icon: "shield" },
  rbac: { label: "RBAC", icon: "users" },
  policy: { label: "Policy", icon: "file" },
  service: { label: "Service", icon: "cube" },
  route: { label: "Route", icon: "route" },
  secret: { label: "Secret", icon: "lock" },
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

export function AuditPage() {
  const { audit } = useApp();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [statusF, setStatusF] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = audit.filter(a => {
    if (cat !== "all" && a.category !== cat) return false;
    if (statusF === "failed" && a.status !== "failed" && a.verb !== "fail" && a.verb !== "deny") return false;
    if (statusF === "ok" && (a.status === "failed" || a.verb === "fail" || a.verb === "deny")) return false;
    if (q) {
      const hay = `${a.who} ${a.verb} ${a.target} ${a.ip || ""} ${a.reason || ""} ${a.service || ""} ${a.path || ""} ${a.method || ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const catCounts = audit.reduce<Record<string, number>>((acc, a) => { acc[a.category] = (acc[a.category] || 0) + 1; return acc; }, {});
  const failedCount = audit.filter(a => a.status === "failed" || a.verb === "fail" || a.verb === "deny").length;

  const pg = usePagination(filtered.length, 50);
  const paged = filtered.slice(pg.from, pg.to);

  const groups = (() => {
    const gs: { day: string; label: string; entries: typeof filtered }[] = [];
    let last = "";
    for (const e of paged) {
      const day = (e.ts || "").slice(0, 10) || e.when;
      if (day !== last) {
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const label = day === today ? "Today" : day === yesterday ? "Yesterday" : day;
        gs.push({ day, label, entries: [] });
        last = day;
      }
      gs[gs.length - 1].entries.push(e);
    }
    return gs;
  })();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <div className="sub">
            Read-only stream · {audit.length} total
            {failedCount > 0 && <> · <span style={{ color: "var(--err)" }}>{failedCount} denied / failed</span></>}
          </div>
        </div>
        <div className="page-actions">
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }}>{I.search}</span>
            <input className="input" style={{ paddingLeft: 30, minWidth: 280 }} placeholder="Search actor, target, IP, path…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <button className="btn">{I.download} Export CSV</button>
        </div>
      </div>

      {/* Category pills */}
      <div className="audit-cats">
        <button className={`audit-cat ${cat === "all" ? "on" : ""}`} onClick={() => setCat("all")}>
          <span>All events</span><span className="audit-cat-count">{audit.length}</span>
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
        {filtered.length === 0 && <div style={{ padding: 28 }}><EmptyHint>No events match.</EmptyHint></div>}
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
              return (
                <div key={e.id} className={`audit-row ${isFail ? "is-fail" : ""} ${open ? "is-open" : ""}`} onClick={() => setOpenId(open ? null : e.id)}>
                  {/* Time */}
                  <div className="audit-col-time">
                    <div className="mono small" style={{ color: "var(--ink)" }}>{(e.ts || "").slice(11, 19) || e.when}</div>
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
                    </div>
                    <div className="mono small" style={{ marginTop: 4, color: "var(--ink)" }}>
                      {e.path || e.target}
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
                      {e.mfa === true && <span className="audit-kv"><span className="muted">mfa</span> ✓</span>}
                      {e.mfa === false && <span className="audit-kv" style={{ color: "var(--err)" }}><span className="muted">mfa</span> ✗</span>}
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
                      <div className="audit-detail-grid">
                        <div><div className="muted small">Event ID</div><div className="mono small">{e.id}</div></div>
                        <div><div className="muted small">Timestamp</div><div className="mono small">{e.ts || "—"}</div></div>
                        <div><div className="muted small">Category</div><div className="mono small">{e.category}</div></div>
                        <div><div className="muted small">Action</div><div className="mono small">{e.verb}</div></div>
                        {e.method && <div><div className="muted small">HTTP Method</div><div className="mono small"><Method m={e.method} /></div></div>}
                        {e.path && <div><div className="muted small">Path</div><div className="mono small">{e.path}</div></div>}
                        {e.statusCode && <div><div className="muted small">Status Code</div><div className="mono small" style={{ color: `var(--${statusTone(e.statusCode)})` }}>{e.statusCode}</div></div>}
                        {e.responseTimeMs != null && <div><div className="muted small">Response Time</div><div className="mono small">{e.responseTimeMs.toFixed(2)} ms</div></div>}
                        {e.service && <div><div className="muted small">Service</div><div className="mono small">{e.service}</div></div>}
                        {e.ip && <div><div className="muted small">IP Address</div><div className="mono small">{e.ip}</div></div>}
                        {e.ua && <div style={{ gridColumn: "span 2" }}><div className="muted small">User Agent</div><div className="mono small">{e.ua}</div></div>}
                        {e.target && e.target !== e.path && <div style={{ gridColumn: "span 2" }}><div className="muted small">Target</div><div className="mono small">{e.target}</div></div>}
                        {e.reason && <div style={{ gridColumn: "span 2" }}><div className="muted small">Reason</div><div className="mono small" style={{ color: "var(--err)" }}>{e.reason}</div></div>}
                      </div>
                      <div className="audit-detail-actions">
                        <button className="btn ghost sm" onClick={() => {
                          navigator.clipboard?.writeText(JSON.stringify(e, null, 2));
                        }}>Copy JSON</button>
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
        Showing {pg.from + 1}–{pg.to} of {filtered.length} events{filtered.length < audit.length ? ` (${audit.length} total)` : ""} · read-only
      </div>
    </>
  );
}
