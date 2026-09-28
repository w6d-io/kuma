import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Health, Module } from '../../api/home';
import { Badge, ButtonBase, Drawer, HealthItem, I, RelativeTime, Skeleton, cx } from '../../components/ui';
import { HEALTH_WORD, healthRows, type HealthRow } from '../../lib/home/briefing';
import { homeHref } from '../../lib/home/href';
import { ModuleFrame } from './ModuleFrame';
import { fromQuery } from './moduleKit';

/**
 * "Platform" — is the request path alive, listed in the order a request travels (home-design §4.2).
 * No separators between items: wrapped, one would start or end a line.
 * On a phone it folds to one line ("All 9 systems ok") with a row per item that is not ok.
 */
export function HealthStrip({ q }: { q: UseQueryResult<Module<Health>, Error> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const rows = q.data?.data ? healthRows(q.data.data.components) : [];
  // Not deployed is a choice of this deployment, not a fault: it neither counts against the platform
  // nor sets the mark's colour.
  const notOk = rows.filter((r) => r.state !== 'ok' && r.state !== 'not_deployed');
  const counted = rows.filter((r) => r.state !== 'not_deployed').length;

  return (
    <ModuleFrame<Health>
      id="home-health"
      title="Platform"
      className="home-health"
      {...fromQuery(q)}
      thing="platform health"
      skeleton={<div className="health-skeleton" aria-hidden="true"><Skeleton h={20} /><Skeleton h={20} w="70%" /></div>}
      notConnected={{ title: "Platform health isn't available", what: 'The console API could not read its own components.' }}
      aside={rows.length > 0 && <ButtonBase className="home-link" onClick={() => setOpen('all')}>Platform status <span aria-hidden="true">→</span></ButtonBase>}
    >
      {() => (
        <>
          <ButtonBase className="health-fold" aria-expanded={expanded} aria-controls="home-health-strip" onClick={() => setExpanded((v) => !v)}>
            <span className={cx('health-mark', notOk.some((r) => r.state === 'down') ? 'is-down' : notOk.some((r) => r.state === 'degraded') ? 'is-degraded' : 'is-ok')} aria-hidden="true" />
            <span className="flex-1">{notOk.length === 0 ? `All ${counted} systems ok` : `${counted - notOk.length} of ${counted} systems ok`}</span>
            <span className="health-fold-chev" aria-hidden="true">{expanded ? I.caret : I.caretRight}</span>
          </ButtonBase>
          <ul id="home-health-strip" className={cx('health-strip', expanded && 'is-expanded')} aria-label="Platform components, in request order">
            {rows.map((r) => (
              <li key={r.key} className={cx('health-cell', r.state !== 'ok' && r.state !== 'not_deployed' && 'not-ok')}>
                <HealthItem label={r.label} state={r.state} summary={r.summary} tip={`${r.tip} Checked every 15 s.`} onClick={() => setOpen(r.key)} />
              </li>
            ))}
          </ul>
          <StatusDrawer rows={rows} focus={open} onClose={() => setOpen(null)} />
        </>
      )}
    </ModuleFrame>
  );
}

const TONE = { ok: 'success', degraded: 'warning', down: 'danger', unknown: 'plain', not_deployed: 'plain' } as const;

function linkOf(r: HealthRow): string | null {
  if (!r.link) return null;
  if ('grafana' in r.link) return r.link.grafana;
  return homeHref({ page: r.link.page, params: r.link.params });
}

/** "Platform status": every component, its state and since when, what breaks while it is down. */
function StatusDrawer({ rows, focus, onClose }: { rows: HealthRow[]; focus: string | null; onClose: () => void }) {
  return (
    <Drawer open={focus != null} onClose={onClose} title="Platform status" eyebrow="Checked every 15 s">
      <ul className="status-list">
        {rows.map((r) => {
          const href = linkOf(r);
          return (
            <li key={r.key} className={cx('status-row', r.key === focus && 'is-focus')}>
              <div className="status-row-head">
                <span className="fw-semibold">{r.label}</span>
                <Badge tone={TONE[r.state]} mono={false} variant="status">{HEALTH_WORD[r.state]}</Badge>
              </div>
              <div className="small">{r.summary}{r.since && <> · since <RelativeTime at={r.since} suffix="" /></>}</div>
              {r.notes?.map((n) => <div key={n} className="small muted">{n} — not part of this deployment.</div>)}
              <div className="small muted">{r.tip}</div>
              {r.state === 'down' && <div className="small text-danger">While it is down: {r.consequence}</div>}
              {href && <a className="small" href={href} onClick={onClose} {...(href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}>Open <span aria-hidden="true">→</span></a>}
            </li>
          );
        })}
      </ul>
    </Drawer>
  );
}
