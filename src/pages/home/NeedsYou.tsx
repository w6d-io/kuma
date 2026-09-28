import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Attention, Module } from '../../api/home';
import { Button, ButtonBase, I, QueueItem, RelativeTime, cx } from '../../components/ui';
import { ageOf } from '../../lib/home/briefing';
import { homeHref } from '../../lib/home/href';
import { ModuleFrame, RowsSkeleton } from './ModuleFrame';
import { fromQuery, presentItem, sourceWords } from './moduleKit';

const DESKTOP = 5;
const PHONE = 3;

/**
 * "Needs you" — everything that needs a human, ranked by the server, each one click from where it is
 * handled (home-design §4.3). Not dismissable: an item leaves when its condition clears. Five rows
 * (three on a phone), then the rest in place.
 */
/** Something about the viewer's own account, ranked first (the two-step sign-in requirement). */
export interface PersonalItem {
  title: string;
  detail: string;
  href: string;
}

export function NeedsYou({ q, personal }: { q: UseQueryResult<Module<Attention>, Error>; personal?: PersonalItem | null }) {
  const [all, setAll] = useState(false);
  const items = q.data?.data?.items ?? [];
  const mine = personal ? 1 : 0;
  return (
    <ModuleFrame<Attention>
      id="home-attention"
      title="Needs you"
      count={items.length + mine || undefined}
      className={cx('home-attention', items.length + mine === 0 && 'is-empty')}
      {...fromQuery(q)}
      thing="what needs you"
      skeleton={<RowsSkeleton rows={3} />}
      notConnected={{ title: "The queue isn't available", what: 'Apply requests, site problems and recertifications appear here.' }}
    >
      {(data, m) => {
        const unchecked = Object.entries(m.sources ?? {}).filter(([, v]) => v.state !== 'ok').map(([k]) => sourceWords(k));
        if (data.items.length === 0 && !personal) {
          return (
            <div className="queue-empty">
              <span className="queue-empty-ico" aria-hidden="true">{I.check}</span>
              <div className="flex-1 min-w-0">
                <div className="fw-medium">{unchecked.length ? 'Nothing needs you in what we could check' : 'Nothing needs you'}</div>
                <div className="small muted">
                  {unchecked.length
                    ? <>Couldn't check {unchecked.join(', ')}. <ButtonBase className="home-link" onClick={() => void q.refetch()}>Retry</ButtonBase></>
                    : <>We watch sites, apply requests, the gateway, policy sync, certificates, full-access accounts and recertification. Checked <RelativeTime at={m.asOf} />.</>}
                </div>
              </div>
            </div>
          );
        }
        const more = data.items.length > PHONE;
        return (
          <>
            <ul className={cx('queue', all && 'is-all')} aria-label="Things that need you, most urgent first">
              {personal && (
                <li key="two-step">
                  <QueueItem severity="warning" title={personal.title} detail={personal.detail} href={personal.href} />
                </li>
              )}
              {data.items.map((it, i) => { const v = presentItem(it); return (
                <li key={it.id} className={cx(i >= PHONE && 'beyond-phone', i >= DESKTOP && 'beyond-desktop')}>
                  <QueueItem
                    severity={it.severity}
                    icon={v.icon}
                    title={v.title}
                    detail={v.detail}
                    age={ageOf(it.since)}
                    ageTitle={`Since ${new Date(it.since).toLocaleString()}`}
                    href={homeHref(it.target)}
                    actionable={it.actionable}
                  />
                </li>
              ); })}
            </ul>
            {more && !all && (
              <div className={cx('queue-more', data.items.length <= DESKTOP && 'phone-only')}>
                <Button size="sm" variant="ghost" onClick={() => setAll(true)}>Show all {data.items.length} <span aria-hidden="true">→</span></Button>
              </div>
            )}
            {data.truncated && (
              <p className="home-foot muted">Showing {data.items.length} — more in each area: <a href="#/sites">Sites</a> · <a href="#/accessreview">Access review</a></p>
            )}
            {unchecked.length > 0 && <p className="home-foot muted">Couldn't check {unchecked.join(', ')}.</p>}
          </>
        );
      }}
    </ModuleFrame>
  );
}
