import { Badge, Button, Card, EmptyRow, I, Table, Th } from '../../components/ui';
import { goSites, sitesHref } from '../../lib/sites/route';
import { accessChips, accessWord, rewriteParts } from '../../lib/sites/hosts';
import type { HostServiceDetail } from '../../lib/sites/types';
import { StatusBadge } from './parts';

/**
 * One service of a host, in plain words (Sites by address): the request path turning into the path its
 * backend receives, who may reach it, page or API, its state, its routes — and the way into the site's
 * existing editor for anything to change. Nothing is edited here.
 */

/** The request path → backend path, the stripped part struck through and the added base marked. */
export function RewriteFlow({ path, s }: { path: string; s: Pick<HostServiceDetail, 'upstream'> }) {
  const r = rewriteParts(path, s.upstream);
  const u = s.upstream;
  return (
    <div className="host-flow" aria-label={`Requests to ${path} reach ${u ? `${u.service}.${u.namespace}:${u.port}` : 'no backend'}`}>
      <span className="mono">{path}</span>
      <span className="muted" aria-hidden="true">→</span>
      <span className="mono">
        {r.added && <ins className="host-flow-add">{r.added}</ins>}
        {r.before}
        {r.stripped && <del className="host-flow-strip" title="Removed by the gateway (strip path)">{r.stripped}</del>}
        {r.after}
      </span>
      {u && <><span className="muted">at</span><span className="mono host-flow-backend">{u.service}.{u.namespace}:{u.port}</span></>}
    </div>
  );
}

export function HostServicePanel({ s }: { s: HostServiceDetail }) {
  const open = (tab?: 'routes' | 'access' | 'gates') => goSites(sitesHref({ view: 'site', name: s.site, tab }));
  const prefix = s.pathPrefix ?? '';
  const chips = accessChips(s.access);
  return (
    <Card
      title={<span className="mono">{prefix || '/'}</span>}
      sub={<span>{s.displayName} <span className="muted mono small">{s.site}</span></span>}
      actions={<StatusBadge status={s.status} />}
    >
      <div className="stack gap-12">
        <RewriteFlow path={`${prefix}/…`} s={s} />
        <dl className="host-kv">
          <dt>Who can reach it</dt>
          <dd>
            <span className="row gap-4 wrap">
              {chips.length === 0 ? <span className="muted">Nobody: every path is refused</span> : chips.map((c) => <Badge key={c.word} tone={c.tone} mono={false}>{c.word}</Badge>)}
            </span>
            {s.access.permissions.length > 1 && <div className="small muted mono mt-4">{s.access.permissions.join(', ')}</div>}
          </dd>
          <dt>Type</dt>
          <dd>{s.kind === 'api' ? 'API: answers in JSON, not listed on "Where to?"' : 'Page: people open it in a browser'}</dd>
          <dt>State</dt>
          <dd className="row gap-4 wrap">
            <StatusBadge status={s.status} />
            {s.draft && <Badge tone="plain" mono={false} icon={I.edit}>draft waiting</Badge>}
            {s.pendingRequest && <Badge tone="warning" mono={false}>request to apply</Badge>}
          </dd>
          {s.sharedBackendWith.length > 0 && (
            <>
              <dt>Same backend as</dt>
              <dd className="row gap-4 wrap">
                {s.sharedBackendWith.map((n) => (
                  <Button key={n} size="sm" variant="ghost" onClick={() => goSites(sitesHref({ view: 'site', name: n }))}>{n}</Button>
                ))}
              </dd>
            </>
          )}
        </dl>

        <Table aria-label={`Routes of ${s.site}`}>
          <thead><tr><Th>Path</Th><Th>Methods</Th><Th>Needs</Th><Th>Backend receives</Th></tr></thead>
          <tbody>
            {s.routes.length === 0 && !s.catchAll && <EmptyRow colSpan={4}>No route yet.</EmptyRow>}
            {s.routes.map((r) => (
              <tr key={r.id}>
                <td className="mono small break-all">{r.path}</td>
                <td className="small">{r.methods.join(', ')}</td>
                <td className="small">{accessWord(r.access)}</td>
                <td className="mono small break-all">{r.backendPath}</td>
              </tr>
            ))}
            {s.catchAll && (
              <tr>
                <td className="small muted">everything else</td>
                <td className="small">any</td>
                <td className="small">{accessWord(s.catchAll.access)}</td>
                <td className="mono small break-all">{s.catchAll.access.kind === 'deny' ? '—' : s.catchAll.backendPath}</td>
              </tr>
            )}
          </tbody>
        </Table>

        <div className="row gap-8 wrap">
          <Button size="sm" icon={I.route} onClick={() => open('routes')}>Edit routes</Button>
          <Button size="sm" icon={I.shield} onClick={() => open('access')}>Edit access</Button>
          <Button size="sm" icon={I.gate} onClick={() => open('gates')}>Advanced</Button>
          <Button size="sm" variant="ghost" onClick={() => open()}>Open site</Button>
        </div>
      </div>
    </Card>
  );
}
