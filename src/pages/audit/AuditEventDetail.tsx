import { useState } from 'react';
import type { AuditEventV1, ChainStatus } from '../../api/audit';
import { Badge, Button, Callout, I } from '../../components/ui';
import { eventHash, grafanaBase, routeOf, traceLink, whyDeniedHash } from '../../lib/audit/format';
import { RISK_FLAG_LABEL } from './lib';
import { ActorReveal } from './Actor';
import { useActor, useReveal } from './useActor';
import { useAuditEventDetail } from './queries';

const CHAIN: Record<ChainStatus, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  verified: { tone: 'success', label: 'chain verified' },
  unverified: { tone: 'warning', label: 'not yet verified' },
  broken: { tone: 'danger', label: 'integrity check failed' },
};

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'span-2' : undefined}>
      <div className="muted small">{label}</div>
      <div className="mono small audit-break">{children}</div>
    </div>
  );
}

/**
 * Everything one event carries, and what to do next: the diff, the fields, where it sits in the hash
 * chain, the trace (while Tempo keeps it), and for a denial the Access checker asked the same
 * question of today's policy.
 */
export function AuditEventDetail({ e, platform, onOpenUser }: { e: AuditEventV1; platform: boolean; onOpenUser?: (id: string) => void }) {
  const chainQ = useAuditEventDetail(e.event_id, e.ts);
  const chain = chainQ.data?.chain;
  const trace = platform ? traceLink(e, grafanaBase()) : { kind: 'none' as const };
  const route = routeOf(e);
  const actor = useActor(e.actor);
  const { reveal, busy } = useReveal();
  const [copied, setCopied] = useState<'json' | 'link' | null>(null);
  const [whyProblem, setWhyProblem] = useState<string | null>(null);

  const copy = (what: 'json' | 'link') => {
    const text = what === 'json' ? JSON.stringify(e, null, 2) : `${location.origin}${location.pathname}${eventHash(e)}`;
    void navigator.clipboard?.writeText(text).then(() => setCopied(what), () => undefined);
  };

  const whyDenied = async () => {
    setWhyProblem(null);
    const id = e.actor.id;
    const email = actor.email ?? (id ? await reveal(id) : null);
    const hash = email ? whyDeniedHash(e, email) : null;
    if (hash) window.location.hash = hash;
    else setWhyProblem('The Access checker needs the person\'s email, and this id could not be looked up.');
  };

  const c = e.changes;
  return (
    <div className="audit-detail">
      {chain === 'broken' && (
        <Callout tone="danger" icon={I.alert} title="Integrity check failed">
          This event does not match the hash chain. It may have been altered, or the events around it removed. Security has been alerted.
        </Callout>
      )}
      {e.integrity === 'none' && (
        <Callout tone="info" icon={I.info}>Imported from the legacy trail — not integrity-protected.</Callout>
      )}
      {c && (c.summary || c.added?.length || c.removed?.length || c.fields || (e.flags?.length ?? 0) > 0) && (
        <div className="audit-diff">
          {c.summary && <div className="small mb-4">{c.summary}</div>}
          {(e.flags?.length ?? 0) > 0 && (
            <div className="row gap-4 wrap mb-4">{e.flags!.map((f) => <Badge key={f} tone="danger" mono={false}>{RISK_FLAG_LABEL[f] || f}</Badge>)}</div>
          )}
          {(c.added?.length ?? 0) > 0 && <div className="row gap-4 wrap mb-4">{c.added!.map((a) => <Badge key={a} tone="success">+ {a}</Badge>)}</div>}
          {(c.removed?.length ?? 0) > 0 && <div className="row gap-4 wrap mb-4">{c.removed!.map((a) => <Badge key={a} tone="danger">− {a}</Badge>)}</div>}
          {c.fields && Object.entries(c.fields).map(([k, v]) => (
            <div key={k} className="small mono"><span className="muted">{k}</span> {String(v.from ?? '∅')} → {String(v.to ?? '∅')}</div>
          ))}
        </div>
      )}

      <div className="audit-grid">
        <div className="span-2"><div className="muted small">Actor</div><ActorReveal actor={e.actor} /></div>
        <Field label="Event">{e.event}</Field>
        <Field label="Result">{e.result}{e.reason ? ` · ${e.reason}` : ''}</Field>
        <Field label="Time">{e.ts}</Field>
        <Field label="Source">{e.source ?? '—'}{e.service_version ? ` ${e.service_version}` : ''}</Field>
        {e.target && <Field label="Target">{e.target.type}{e.target.id ? ` · ${e.target.id}` : ''}</Field>}
        {e.org_id && <Field label="Organisation">{e.org_id}</Field>}
        {e.site && <Field label="Site">{e.site}</Field>}
        {e.actor.auth && <Field label="Sign-in">{[e.actor.auth.method, e.actor.auth.aal].filter(Boolean).join(' · ')}</Field>}
        {e.actor.ip_net && <Field label="Network">{e.actor.ip_net}</Field>}
        {e.actor.ua_family && <Field label="Client">{e.actor.ua_family}</Field>}
        <Field label="Event ID">{e.event_id}</Field>
        {e.request_id && <Field label="Request">{e.request_id}</Field>}
        {e.trace_id && <Field label="Trace">{e.trace_id}</Field>}
        <Field label="Hash chain" wide>
          {e.chain_id && <>{e.chain_id} </>}{e.seq != null ? `#${e.seq}` : 'no position'}
          {e.prev_hash && <> · prev {e.prev_hash.slice(0, 19)}…</>}
          {e.hash && <> · {e.hash.slice(0, 19)}…</>}
          {' '}
          {chain ? <Badge tone={CHAIN[chain].tone} mono={false}>{CHAIN[chain].label}</Badge>
            : chainQ.isLoading ? <span className="muted">checking…</span>
            : <span className="muted">verification unavailable</span>}
        </Field>
      </div>

      <div className="row gap-8 wrap mt-8">
        {e.result === 'denied' && route && (
          <Button size="sm" icon={I.shield} loading={busy === e.actor.id} onClick={() => void whyDenied()}
            title="Asks today's policy the same question — policy at the time may differ">Why was this denied?</Button>
        )}
        {e.actor.type === 'user' && e.actor.id && onOpenUser && (
          <Button size="sm" variant="ghost" icon={I.users} onClick={() => onOpenUser(e.actor.id!)}>Their activity</Button>
        )}
        {trace.kind === 'link' && (
          <a className="btn ghost sm" href={trace.url} target="_blank" rel="noopener noreferrer">Open trace <span className="kv-ico">{I.arrowOut}</span></a>
        )}
        {trace.kind === 'expired' && <span className="small muted">Trace expired (kept 7 days)</span>}
        <Button size="sm" variant="ghost" icon={I.copy} onClick={() => copy('json')}>{copied === 'json' ? 'Copied' : 'Copy JSON'}</Button>
        <Button size="sm" variant="ghost" icon={I.copy} onClick={() => copy('link')}>{copied === 'link' ? 'Copied' : 'Copy link'}</Button>
      </div>
      {e.result === 'denied' && route && <div className="text-xs muted mt-4">The checker shows the decision under current policy; policy at the time may differ.</div>}
      {whyProblem && <div className="small text-warning mt-4">{whyProblem}</div>}
    </div>
  );
}
