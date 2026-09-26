import { useEffect, useState } from 'react';
import { Badge, ButtonBase, Callout, Card, Drawer, EmptyRow, I, LoadingRows, PageHeader, Segmented, Table, Th, cx } from '../../components/ui';
import { useGateway, useRollout } from '../../api/gateway';
import { notAvailable } from '../../api/sites';
import { KIND_LABEL } from '../../lib/gateway/catalog';
import { gatewayHref, parseGatewayHash, rowsOf, type GatewayView } from '../../lib/gateway/logic';
import { HANDLER_KINDS, type HandlerChange, type HandlerKind } from '../../lib/gateway/types';
import { QueryError } from '../sites/parts';
import { useSession } from '../../api/hooks';
import { permits } from '../../policy/model';
import { HandlerPanel } from './HandlerPanel';
import { ChangeReview } from './ChangeReview';
import '../sites/sites.css';
import './gateway.css';

/**
 * Gateway handlers (GW-3): every Oathkeeper authenticator, authorizer, mutator and error handler —
 * on or off, its global config, and the sites that use it. Changing one is a platform change: it
 * is previewed with risk flags, applied, and rolled out pod by pod, with a rollback at hand.
 */

function useGatewayView(): GatewayView {
  const [v, setV] = useState(() => parseGatewayHash(window.location.hash));
  useEffect(() => {
    const on = () => setV(parseGatewayHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return v;
}

const go = (href: string) => { if (window.location.hash !== href) window.location.hash = href; };

export function GatewayPage() {
  const view = useGatewayView();
  const { data: session } = useSession();
  // Changing the gateway is `sites:apply` at jinbe; platform write admins are let through to the
  // server, which decides.
  const perms = { canRead: permits(session?.permissions, 'admin:read'), canApply: permits(session?.permissions, 'sites:apply') || permits(session?.permissions, 'admin:write') };
  const gw = useGateway();
  const rollout = useRollout();
  const [review, setReview] = useState<HandlerChange[] | null>(null);
  const [filter, setFilter] = useState<'all' | HandlerKind>(view.kind && !view.name ? view.kind : 'all');
  const unavailable = !!gw.error && notAvailable(gw.error);
  const kinds = filter === 'all' ? HANDLER_KINDS : [filter];
  const selected = view.kind && view.name ? rowsOf(gw.data, view.kind).find((r) => r.name === view.name) : undefined;
  const level = (['basic', 'advanced', 'expert'] as const).find((l) => l === view.query.level) ?? 'basic';
  const canEdit = perms.canApply && !!gw.data;

  return (
    <div className="page-enter">
      <PageHeader title="Gateway handlers" sub="How the gateway recognises callers, checks permissions, what services receive and how errors look — for every site at once." />
      {gw.data?.managed === false && (
        <Callout tone="info" icon={I.info} className="mb-12" title="Not managed by kuma yet">
          The gateway runs its {gw.data.source ?? 'chart'} config. The first change applied here adopts it as it is — nothing else moves.
        </Callout>
      )}
      {rollout.data?.state === 'running' && (
        <Callout tone="info" icon={I.sync} className="mb-12" title={`Rolling out gateway config v${rollout.data.version}`}>
          {rollout.data.stages.filter((s) => s.state === 'done').length} of {rollout.data.stages.length} steps done. Requests keep being served.
        </Callout>
      )}
      {unavailable && (
        <Callout tone="info" icon={I.clock} className="mb-12" title="Not available on this server yet">
          The catalog below is what the gateway can run; whether each one is on, its config and the sites using it arrive with /api/admin/gateway.
        </Callout>
      )}
      {gw.error && !unavailable ? <QueryError error={gw.error} what="the gateway config" /> : null}
      {!perms.canApply && perms.canRead && <Callout tone="info" icon={I.info} className="mb-12">You can look around. Changing the gateway needs a platform admin.</Callout>}

      <div className="site-toolbar">
        <Segmented
          label="Kind"
          value={filter}
          onChange={(k) => { setFilter(k); go(gatewayHref(k === 'all' ? null : k)); }}
          options={[{ value: 'all', label: 'All' }, ...HANDLER_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))]}
        />
        {gw.data && <span className="small muted">Config v{gw.data.version}{gw.data.production ? ' · PRODUCTION' : ''}</span>}
      </div>

      <div className="stack gap-16">
        {kinds.map((kind) => {
          const rows = rowsOf(gw.data, kind);
          return (
            <Card key={kind} pad="none" title={KIND_LABEL[kind]} sub={<span className="mono">{kind}{kind === 'errors' && gw.data?.errorFallback?.length ? ` · fallback: ${gw.data.errorFallback.join(', ')}` : ''}</span>}>
              <Table aria-label={KIND_LABEL[kind]} className="gw-table">
                <thead><tr><Th>Handler</Th><Th>State</Th><Th>Used by</Th><Th>What it does</Th></tr></thead>
                <tbody>
                  {gw.isLoading && <LoadingRows cols={4} rows={3} />}
                  {!gw.isLoading && rows.length === 0 && <EmptyRow colSpan={4}>None.</EmptyRow>}
                  {!gw.isLoading && rows.map((r) => (
                    <tr key={r.name} className={cx(selected?.name === r.name && selected.kind === kind && 'site-row-open')}>
                      <td>
                        <ButtonBase className="site-row-name" onClick={() => go(gatewayHref(kind, r.name))}>
                          <span className="fw-medium">{r.info.label}</span><span className="mono small muted">{r.name}</span>
                        </ButtonBase>
                      </td>
                      <td>
                        {unavailable ? <Badge tone="neutral" mono={false}>unknown</Badge>
                          : r.live !== undefined && r.live !== r.enabled
                            ? <Badge tone="info" icon={I.sync} mono={false}>{r.enabled ? 'Enabling…' : 'Disabling…'}</Badge>
                            : <Badge tone={r.enabled ? 'success' : 'neutral'} icon={r.enabled ? I.check : I.lock} mono={false}>{r.enabled ? 'Enabled' : 'Not enabled'}</Badge>}
                      </td>
                      <td className="small">{[r.platform && 'platform', r.usedBy.length && `${r.usedBy.length} site${r.usedBy.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || '—'}{r.locked ? <> <Badge tone="plain" mono={false} icon={I.lock}>locked</Badge></> : null}</td>
                      <td className="small muted">{r.info.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          );
        })}
      </div>

      <Drawer
        open={!!selected}
        size="lg"
        onClose={() => { setReview(null); go(gatewayHref(filter === 'all' ? null : filter)); }}
        title={selected?.info.label ?? ''}
        eyebrow={selected ? KIND_LABEL[selected.kind] : undefined}
      >
        {selected && (review
          ? <ChangeReview changes={review} state={gw.data} canApply={perms.canApply} onDone={() => { setReview(null); void gw.refetch(); }} />
          : <HandlerPanel key={`${selected.kind}/${selected.name}/${gw.data?.version ?? 0}`} row={selected} level={level} canEdit={canEdit}
              onLevel={(l) => go(gatewayHref(selected.kind, selected.name, { level: l === 'basic' ? undefined : l }))}
              onReview={setReview} />)}
      </Drawer>
    </div>
  );
}
