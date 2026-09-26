import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Callout, Card, EmptyHint, I, Table, Th } from '../../../components/ui';
import { sitesApi, useSiteStatus, useInvalidateSite, notAvailable } from '../../../api/sites';
import type { Condition } from '../../../lib/sites/types';
import type { SiteEditor } from '../useSiteEditor';
import { NotAvailable, QueryError } from '../parts';
import { timeAgo } from '../../../lib/sites/format';
import { useSitePerms } from '../usePerms';
import { useSiteAction } from '../useAction';

/**
 * Status (site-ux.md §9.2 "Show conditions", §10.2 drift): the Site object's conditions, its child
 * Rule / Ingress / Certificate objects with per-pod loading, recent events, and drift against what
 * kuma applied. All from endpoints being built (S-3); each part says so until it answers.
 */

function Conditions({ list }: { list: Condition[] }) {
  if (list.length === 0) return <EmptyHint>No conditions reported.</EmptyHint>;
  return (
    <div className="pills">
      {list.map((c) => (
        <Badge key={c.type} tone={c.status === 'True' ? 'success' : c.status === 'False' ? 'danger' : 'neutral'} mono={false} title={[c.reason, c.message, c.lastTransitionTime].filter(Boolean).join(' · ')}>
          {c.type}={c.status}{c.reason ? ` (${c.reason})` : ''}
        </Badge>
      ))}
    </div>
  );
}

export function StatusTab({ ed }: { ed: SiteEditor }) {
  const status = useSiteStatus(ed.name, { poll: true });
  const events = useQuery({ queryKey: ['sites', 'events', ed.name], queryFn: () => sitesApi.events(ed.name), retry: false, refetchInterval: (q) => (notAvailable(q.state.error) ? false : 10_000) });
  const drift = useQuery({ queryKey: ['sites', 'drift', ed.name], queryFn: () => sitesApi.drift(ed.name), retry: false, enabled: !ed.system });
  const perms = useSitePerms();
  const invalidate = useInvalidateSite();
  const { run, busy } = useSiteAction();
  const applied = ed.detail.data?.applied;

  return (
    <div className="stack gap-16">
      {applied && (
        <Card title="What kuma applied">
          <p className="small m-0">v{applied.version} by {applied.by} · {timeAgo(applied.at)}</p>
          <ul className="site-list mono small">{applied.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </Card>
      )}

      <Card title="Site object" sub="Reconciled by the Site operator: Validated · RulesSynced · RulesLoaded · IngressReady · CertificateReady">
        {status.isLoading ? <EmptyHint>Loading…</EmptyHint> : status.error ? <QueryError error={status.error} what="the Site object’s status" /> : status.data && (
          <div className="stack gap-12">
            <Conditions list={status.data.conditions} />
            <p className="small m-0">observedGeneration {status.data.observedGeneration} / generation {status.data.generation}{status.data.observedGeneration < status.data.generation ? ' — the operator has not caught up yet' : ''}</p>
            <Table aria-label="Child objects">
              <thead><tr><Th>Object</Th><Th>Conditions</Th><Th>Spec</Th><Th>Loaded on</Th></tr></thead>
              <tbody>
                {status.data.children.map((c) => (
                  <tr key={`${c.kind}/${c.name}`}>
                    <td className="mono small">{c.kind}/{c.name}</td>
                    <td><Conditions list={c.conditions} /></td>
                    <td className="small">{c.expectedHash ? (c.specHash === c.expectedHash ? 'as applied' : <span className="text-warning">differs (edited outside kuma)</span>) : '—'}</td>
                    <td className="small">{c.loadedOn?.map((p) => `${p.pod} ${p.loaded ? '✓' : '✗'}`).join(' · ') ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      {!ed.system && (
        <Card title="Drift" sub="What is live compared with what kuma applied (permissions and the gateway objects).">
          {drift.error ? (notAvailable(drift.error) ? <NotAvailable what="drift detection" /> : <QueryError error={drift.error} what="drift" />)
            : !drift.data ? <EmptyHint>Loading…</EmptyHint>
            : drift.data.items.length === 0 ? <p className="small m-0">{I.check} Live matches what kuma applied.</p>
            : (
              <Callout tone="warning" icon={I.alert} title={`${ed.current?.displayName} differs from what kuma applied`} actions={perms.canApply && <>
                <Button size="sm" loading={busy === 'Restore'} onClick={async () => { if (applied) { await run('Restore', () => sitesApi.rollback(ed.name, applied.version, 'restore what kuma applied (drift)'), 'Restored'); invalidate(ed.name); } }}>Restore what kuma applied</Button>
                <Button size="sm" loading={busy === 'Accept'} onClick={async () => { await run('Accept', () => sitesApi.acceptDrift(ed.name), 'Folded into a draft'); invalidate(ed.name); }}>Accept into the site</Button>
              </>}>
                <ul className="site-list small">
                  {drift.data.items.map((d, i) => (
                    <li key={i}>{d.artefact} · {d.field}: <span className="mono">{JSON.stringify(d.expected)}</span> → <span className="mono">{JSON.stringify(d.actual)}</span>{d.changedBy ? ` (by ${d.changedBy}${d.at ? `, ${timeAgo(d.at)}` : ''})` : ''}</li>
                  ))}
                </ul>
                <p className="small mb-0">The operator reverts edits to its own objects on its next reconcile — “Restore” is what will happen anyway; “Accept” keeps the change as a new draft.</p>
              </Callout>
            )}
        </Card>
      )}

      <Card title="Events" sub="Kubernetes events for the Site and its children, newest first.">
        {events.error ? <QueryError error={events.error} what="events" /> : !events.data ? <EmptyHint>Loading…</EmptyHint> : events.data.length === 0 ? <EmptyHint>No events.</EmptyHint> : (
          <ul className="site-list small">
            {events.data.slice(0, 20).map((e, i) => (
              <li key={i}><span className="mono muted">{new Date(e.at).toLocaleTimeString()}</span> <Badge tone={e.type === 'Warning' ? 'warning' : 'neutral'} mono={false}>{e.reason}</Badge> {e.summary ?? e.message}{e.object ? <span className="muted mono"> {e.object}</span> : null}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
