import { Chip, EmptyHint } from '../../components/ui/Primitives';
import { useAuditEvents } from '../../api/hooks';
import { RiskBadge, riskOf } from '../Audit';
import type { User, AuditEvent } from '../../api/types';
import { ApiErrorState } from '../../components/ApiErrorState';

// One row of a per-user trail. Renders the plain event + group-diff chips from
// the `changes` envelope (added/removed groups) + a risk badge.
function TrailRow({ e }: { e: AuditEvent }) {
  const isFail = e.status === "failed" || e.verb === "fail" || e.verb === "deny";
  const risk = riskOf(e);
  const added = e.changes?.added ?? [];
  const removed = e.changes?.removed ?? [];
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderBottom: "1px solid var(--line)", borderLeft: risk.level !== "none" ? `2px solid var(--${risk.tone})` : "2px solid transparent" }}>
      <span className="small muted mono nowrap" style={{ width: 60, flexShrink: 0 }}>{e.when}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Chip tone={isFail ? "err" : ""}>{e.verb}</Chip>
          <span className="small mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{e.changes?.summary || e.target || e.path || e.category}</span>
          <RiskBadge e={e} />
          {isFail && <Chip tone="err">{e.verb === "deny" ? "denied" : "failed"}</Chip>}
        </div>
        {(added.length > 0 || removed.length > 0) && (
          <div className="row mt-4" style={{ gap: 4, flexWrap: "wrap" }}>
            {added.map(a => <Chip key={`a-${a}`} tone="ok">+ {a}</Chip>)}
            {removed.map(r => <Chip key={`r-${r}`} tone="err">− {r}</Chip>)}
          </div>
        )}
        {(e.service || e.who) && <div className="small muted mono mt-4">{[e.service, e.who].filter(Boolean).join(" · ")}</div>}
      </div>
    </div>
  );
}

// Per-user trail (Part D): "Did" (actor == email) + "Done to them"
// (target == user:<email>, matched via the emit-time targetEmail). Fail-closed:
// react-query's isError distinguishes a load failure from an empty trail.
export function UserTrail({ user }: { user: User }) {
  const didQ = useAuditEvents({ actor: user.email, limit: 50 });
  const doneQ = useAuditEvents({ target: `user:${user.email}`, limit: 50 });
  const did = didQ.data ?? [];
  const done = doneQ.data ?? [];

  const section = (title: string, sub: string, q: ReturnType<typeof useAuditEvents>, rows: AuditEvent[]) => (
    <div className="panel">
      <div className="panel-head"><div><h3>{title}</h3><div className="sub">{sub}</div></div><Chip>{rows.length}</Chip></div>
      <div style={{ padding: 0 }}>
        {q.isError ? (
          <div style={{ padding: 12 }}><ApiErrorState compact what="this activity" error={q.error} onRetry={() => q.refetch()} /></div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 14 }}><EmptyHint>{q.isLoading ? "Loading…" : "Nothing recorded in the retained window."}</EmptyHint></div>
        ) : rows.map(e => <TrailRow key={e.id} e={e} />)}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {section("What they did", `Actions by ${user.email}`, didQ, did)}
      {section("What was done to them", "Access & privilege changes targeting this user", doneQ, done)}
      <div className="small muted" style={{ textAlign: "center", opacity: 0.7 }}>
        Only recent activity is kept — older entries may have aged out.
      </div>
    </div>
  );
}
