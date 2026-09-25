import { Avatar, Badge, Button, Card, I, cx } from '../../components/ui';
import { Method } from '../../components/ui/Primitives';
import type { AuditEvent } from '../../api/types';
import { AUDIT_CATS, RISK_FLAG_LABEL, grafanaTraceUrl, localTime, riskOf, riskTextClass, statusToneClass, verbTone } from './lib';
import { RiskBadge } from './RiskBadge';

// Expanded detail under a log row: before→after diff, the full field grid, actions.
function AuditDetail({ e }: { e: AuditEvent }) {
  const risk = riskOf(e);
  const traceUrl = grafanaTraceUrl(e);
  return (
    <div className="audit-detail" onClick={ev => ev.stopPropagation()}>
      {/* Before → after diff (change events) */}
      {e.changes && (e.changes.summary || e.changes.added?.length || e.changes.removed?.length || e.changes.flags?.length || e.changes.fields) && (
        <Card pad="sm" className="mb-12">
          {e.changes.summary && <div className="small mb-8">{e.changes.summary}</div>}
          {(e.changes.flags?.length ?? 0) > 0 && (
            <div className="row gap-4 wrap mb-8">
              {e.changes.flags!.map(f => <Badge key={f} tone="danger" mono={false}>{RISK_FLAG_LABEL[f] || f}</Badge>)}
            </div>
          )}
          {(e.changes.added?.length ?? 0) > 0 && (
            <div className="small mb-4"><span className="muted">added</span> {e.changes.added!.map(a => <Badge key={a} tone="success">+ {a}</Badge>)}</div>
          )}
          {(e.changes.removed?.length ?? 0) > 0 && (
            <div className="small mb-4"><span className="muted">removed</span> {e.changes.removed!.map(a => <Badge key={a} tone="danger">− {a}</Badge>)}</div>
          )}
          {e.changes.fields && Object.entries(e.changes.fields).map(([k, v]) => (
            <div key={k} className="small mono mt-2">
              <span className="muted">{k}</span> {String(v.from ?? '∅')} → {String(v.to ?? '∅')}
            </div>
          ))}
        </Card>
      )}
      <div className="audit-detail-grid">
        <div><div className="muted small">Event ID</div><div className="mono small">{e.id}</div></div>
        <div><div className="muted small">Timestamp</div><div className="mono small">{e.ts || "—"}</div></div>
        <div><div className="muted small">Category</div><div className="mono small">{e.category}</div></div>
        <div><div className="muted small">Action</div><div className="mono small">{e.verb}</div></div>
        {e.severity && <div><div className="muted small">Severity</div><div className={cx('mono small', riskTextClass(risk.tone))}>{e.severity}</div></div>}
        {e.method && <div><div className="muted small">HTTP Method</div><div className="mono small"><Method m={e.method} /></div></div>}
        {e.path && <div><div className="muted small">Path</div><div className="mono small">{e.path}</div></div>}
        {e.statusCode && <div><div className="muted small">Status Code</div><div className={cx('mono small', statusToneClass(e.statusCode))}>{e.statusCode}</div></div>}
        {e.responseTimeMs != null && <div><div className="muted small">Response Time</div><div className="mono small">{e.responseTimeMs.toFixed(2)} ms</div></div>}
        {e.service && <div><div className="muted small">Service</div><div className="mono small">{e.service}</div></div>}
        {e.targetEmail && <div><div className="muted small">Target</div><div className="mono small">{e.targetEmail}</div></div>}
        {e.ip && <div><div className="muted small">IP Address</div><div className="mono small">{e.ip}</div></div>}
        {e.ua && <div className="span-2"><div className="muted small">User Agent</div><div className="mono small">{e.ua}</div></div>}
        {e.target && e.target !== e.path && <div className="span-2"><div className="muted small">Target</div><div className="mono small">{e.target}</div></div>}
        {e.reason && <div className="span-2"><div className="muted small">Reason</div><div className="mono small text-danger">{e.reason}</div></div>}
      </div>
      <div className="audit-detail-actions">
        <Button variant="ghost" size="sm" onClick={() => {
          navigator.clipboard?.writeText(JSON.stringify(e, null, 2));
        }}>Copy JSON</Button>
        {traceUrl ? (
          <a className="btn ghost sm" href={traceUrl} target="_blank" rel="noopener noreferrer"
             title="Trace this actor/session in Grafana">Trace in Grafana <span className="kv-ico">{I.arrowOut}</span></a>
        ) : null}
      </div>
    </div>
  );
}

export function AuditRow({ e, open, onToggle }: { e: AuditEvent; open: boolean; onToggle: () => void }) {
  const meta = AUDIT_CATS[e.category] || { label: e.category, icon: "dot" as const };
  const isFail = e.status === "failed" || e.verb === "fail" || e.verb === "deny";
  const risk = riskOf(e);
  const edge = risk.level !== 'none' && !isFail ? `risk-${risk.tone}` : undefined;
  return (
    <div className={cx('audit-row', isFail && 'is-fail', open && 'is-open', edge)} onClick={onToggle}>
      {/* Time */}
      <div className="audit-col-time">
        <div className="mono small text-default">{localTime(e.ts) || e.when}</div>
        <div className="small muted">{e.when}</div>
      </div>

      {/* Actor */}
      <div className="audit-col-who">
        {!e.who || e.who === "system" || e.who === "anon" || e.who === "anonymous" ? (
          <div className="row">
            <div className="audit-sysavatar">{e.who === "anon" || e.who === "anonymous" ? "?" : "S"}</div>
            <span className="small mono muted">{e.who || "system"}</span>
          </div>
        ) : (
          <div className="row">
            <Avatar email={e.who} size={22} />
            <div className="min-w-0">
              <span className="small mono">{e.actorName || (e.who || "").split("@")[0]}</span>
              {e.actorName && <div className="text-xs muted mono">{e.who}</div>}
            </div>
          </div>
        )}
      </div>

      {/* Event */}
      <div className="audit-col-what">
        <div className="row gap-4 wrap">
          <span className="audit-cat-tag">
            <span className="chip-ico audit-dim">{I[meta.icon]}</span>
            {meta.label}
          </span>
          <Badge tone={verbTone(e.verb)}>{e.verb}</Badge>
          {e.method && <Method m={e.method} />}
          <RiskBadge e={e} />
        </div>
        <div className="mono small mt-4 text-default">
          {e.changes?.summary || e.path || e.target}
        </div>
      </div>

      {/* Context */}
      <div className="audit-col-meta">
        <div className="audit-meta-list">
          {e.service && <span className="audit-kv"><span className="muted">svc</span> {e.service}</span>}
          {e.statusCode && <span className="audit-kv"><span className="muted">http</span> <span className={statusToneClass(e.statusCode)}>{e.statusCode}</span></span>}
          {e.responseTimeMs != null && <span className="audit-kv"><span className="muted">rt</span> {e.responseTimeMs.toFixed(1)}ms</span>}
          {e.ip && <span className="audit-kv"><span className="muted">ip</span> {e.ip}</span>}
          {e.ua && <span className="audit-kv ellip"><span className="muted">ua</span> {e.ua}</span>}
          {e.mfa === true && <span className="audit-kv"><span className="muted">mfa</span> <span className="kv-ico">{I.check}</span></span>}
          {e.mfa === false && <span className="audit-kv danger"><span className="muted">mfa</span> <span className="kv-ico">{I.alert}</span></span>}
        </div>
      </div>

      {/* Result */}
      <div className="audit-col-status">
        {isFail ? (
          <Badge tone="danger">{e.verb === "deny" ? "denied" : "failed"}</Badge>
        ) : e.status === "applied" ? (
          <Badge tone="success">applied</Badge>
        ) : e.verb === "allow" ? (
          <Badge tone="success">allowed</Badge>
        ) : (
          <Badge>ok</Badge>
        )}
      </div>

      {open && <AuditDetail e={e} />}
    </div>
  );
}
