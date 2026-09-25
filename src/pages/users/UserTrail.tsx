import { Badge, Card, EmptyHint, cx } from '../../components/ui';
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
    <div className={cx("audit-trail-row", risk.level !== "none" && `risk-${risk.tone}`)}>
      <span className="small muted mono nowrap audit-trail-when">{e.when}</span>
      <div className="flex-1 min-w-0">
        <div className="row gap-4 wrap">
          <Badge tone={isFail ? "danger" : "neutral"}>{e.verb}</Badge>
          <span className="small mono audit-clip">{e.changes?.summary || e.target || e.path || e.category}</span>
          <RiskBadge e={e} />
          {isFail && <Badge tone="danger">{e.verb === "deny" ? "denied" : "failed"}</Badge>}
        </div>
        {(added.length > 0 || removed.length > 0) && (
          <div className="row mt-4 gap-4 wrap">
            {added.map(a => <Badge key={`a-${a}`} tone="success">+ {a}</Badge>)}
            {removed.map(r => <Badge key={`r-${r}`} tone="danger">− {r}</Badge>)}
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
    <Card title={title} sub={sub} actions={<Badge>{rows.length}</Badge>} pad="none">
      {q.isError ? (
        <div className="p-12"><ApiErrorState compact what="this activity" error={q.error} onRetry={() => q.refetch()} /></div>
      ) : rows.length === 0 ? (
        <div className="p-16"><EmptyHint>{q.isLoading ? "Loading…" : "Nothing recorded in the retained window."}</EmptyHint></div>
      ) : rows.map(e => <TrailRow key={e.id} e={e} />)}
    </Card>
  );

  return (
    <div className="col gap-12">
      {section("What they did", `Actions by ${user.email}`, didQ, did)}
      {section("What was done to them", "Access & privilege changes targeting this user", doneQ, done)}
      <div className="small muted text-center audit-faint">
        Only recent activity is kept — older entries may have aged out.
      </div>
    </div>
  );
}
