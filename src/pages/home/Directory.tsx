import type { UseQueryResult } from '@tanstack/react-query';
import type { Changes, ChangeItem, HomeSite, Module, People, SitesSummary } from '../../api/home';
import { Avatar, Badge, Button, I, Meter, RelativeTime, cx } from '../../components/ui';
import { eventPhrase } from '../../lib/audit/format';
import { homeHref } from '../../lib/home/href';
import { sitesHref } from '../../lib/sites/route';
import { byDay, type Persona } from '../../lib/home/briefing';
import { ModuleFrame, RowsSkeleton } from './ModuleFrame';
import { fromQuery } from './moduleKit';

/** Sites, recent changes and people: the Home's inventory, below what needs doing (home-design §4.7–4.9). */

// ── Sites ───────────────────────────────────────────────────────────────────

const STATUS: Record<HomeSite['status'], { word: string; tone: 'success' | 'warning' | 'info' | 'plain' }> = {
  live: { word: 'Live', tone: 'success' },
  attention: { word: 'Needs attention', tone: 'warning' },
  draft: { word: 'Draft', tone: 'info' },
  paused: { word: 'Paused', tone: 'plain' },
};

function SiteRow({ s }: { s: HomeSite }) {
  const st = STATUS[s.status];
  const notReady = s.status === 'live' && s.ready === false;
  return (
    <a className="home-row site-row" href={sitesHref({ view: 'site', name: s.name })}>
      <Badge tone={notReady ? 'warning' : st.tone} mono={false} variant="status">{notReady ? 'Live · not ready' : st.word}</Badge>
      <span className="home-row-main truncate">{s.displayName}</span>
      {s.appliedVersion != null && <span className="home-row-meta tabular">v{s.appliedVersion}</span>}
      <span className="home-row-time">
        {s.status === 'draft' ? <RelativeTime at={s.draftAt} /> : s.appliedAt ? <RelativeTime at={s.appliedAt} /> : null}
      </span>
      <span className="home-row-chev" aria-hidden="true">{I.caretRight}</span>
    </a>
  );
}

export function SitesModule({ q, persona, canPlug }: { q: UseQueryResult<Module<SitesSummary>, Error>; persona: Persona; canPlug: boolean }) {
  const org = persona === 'org_admin';
  const data = q.data?.data;
  const total = data ? data.counts.live + data.counts.attention + data.counts.draft + data.counts.paused : undefined;
  return (
    <ModuleFrame<SitesSummary>
      id="home-sites"
      title={org ? 'Your sites' : 'Sites'}
      count={total}
      className="home-sites"
      {...fromQuery(q)}
      thing="sites"
      aside={<a className="home-link" href={org ? '#/orgadmin' : '#/sites'}>All sites <span aria-hidden="true">→</span></a>}
      skeleton={<RowsSkeleton rows={4} />}
      notConnected={{ title: "Sites aren't connected yet", what: 'Sites and their state come from the cluster.' }}
    >
      {(d) => {
        const list = (org ? d.list.filter((s) => s.status !== 'draft') : d.list).slice(0, 7);
        if (list.length === 0) {
          return (
            <div className="home-empty">
              <div className="fw-medium">No sites yet</div>
              {canPlug
                ? <>
                    <p className="small muted">Plug your first site — give it an address and tell us where it runs. It's usually live in under a minute.</p>
                    <Button size="sm" variant="primary" icon={I.plus} onClick={() => { window.location.hash = '#/sites/new'; }}>Plug a site</Button>
                  </>
                : <p className="small muted">No sites have been plugged yet.</p>}
            </div>
          );
        }
        const counts = ([['live', 'live'], ['attention', 'attention'], ['draft', 'draft'], ['paused', 'paused']] as const)
          .filter(([k]) => d.counts[k] > 0);
        return (
          <>
            <ul className="plain-list home-rows">{list.map((s) => <li key={s.name}><SiteRow s={s} /></li>)}</ul>
            {!org && (
              <p className="home-foot">
                {counts.map(([k, label], i) => (
                  <span key={k}>{i > 0 && ' · '}<a href={sitesHref({ view: 'list', query: { filter: k } })}>{d.counts[k]} {label}</a></span>
                ))}
                {d.pendingRequests > 0 && <> · <a href={sitesHref({ view: 'list', query: { view: 'requests' } })}>{d.pendingRequests} {d.pendingRequests === 1 ? 'request' : 'requests'} waiting</a></>}
              </p>
            )}
            {!org && d.migration && <p className="home-foot muted"><a href={sitesHref({ view: 'migrate' })}>Migration: {d.migration.phase}</a></p>}
          </>
        );
      }}
    </ModuleFrame>
  );
}

// ── Recent changes ──────────────────────────────────────────────────────────

const FAILED: ReadonlySet<string> = new Set(['failure', 'failed', 'error', 'denied']);

function ChangeRow({ c }: { c: ChangeItem }) {
  const d = new Date(c.ts);
  const human = c.actor.type === 'user';
  // The legacy stream says `ok`, the audit log `success`; only a refusal or a failure is marked.
  const failed = FAILED.has(c.result);
  return (
    <a className={cx('home-row change-row', failed && 'is-failed')} href={homeHref(c.link)}>
      <time className="home-row-time tabular" dateTime={c.ts} title={d.toLocaleString()}>{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      <span className="change-actor">
        {human ? <Avatar name={c.actor.label} size={20} /> : <span className="change-system" aria-hidden="true">{I.cog}</span>}
        <span className="truncate">{c.actor.label}</span>
      </span>
      <span className="home-row-main truncate">{eventPhrase(c.event)}{c.target ? ` ${c.target.label}` : ''}</span>
      {failed && <Badge tone="danger" mono={false} variant="status">{c.result}</Badge>}
      <span className="home-row-chev" aria-hidden="true">{I.caretRight}</span>
    </a>
  );
}

export function RecentChanges({ q }: { q: UseQueryResult<Module<Changes>, Error> }) {
  return (
    <ModuleFrame<Changes>
      id="home-changes"
      title="Recent changes"
      className="home-changes"
      {...fromQuery(q)}
      thing="recent changes"
      aside={<a className="home-link" href="#/audit">Audit trail <span aria-hidden="true">→</span></a>}
      skeleton={<RowsSkeleton rows={5} />}
      notConnected={{ title: "Recent changes aren't connected yet", what: 'Changes come from the audit log.' }}
    >
      {(d) => {
        if (d.items.length === 0) {
          return <div className="home-empty"><div className="fw-medium">No changes yet</div><p className="small muted">Changes made here, by the operator or through the API show up here.</p></div>;
        }
        // Eight rows on a wide screen, three on a phone; a day whose rows are all past the third goes too.
        const days = byDay(d.items.slice(0, 8));
        const firstIndex = days.map((_, i) => days.slice(0, i).reduce((n, g) => n + g.items.length, 0));
        return (
          <div className="change-days">
            {days.map((g, gi) => (
              <div key={g.label} className={cx('change-day', firstIndex[gi] >= 3 && 'beyond-phone')}>
                <h3 className="home-sub">{g.label}</h3>
                <ul className="plain-list home-rows">
                  {g.items.map((c, i) => <li key={c.eventId} className={cx(firstIndex[gi] + i >= 3 && 'beyond-phone')}><ChangeRow c={c} /></li>)}
                </ul>
              </div>
            ))}
            {d.source === 'redis-legacy' && <p className="home-foot muted">From the legacy audit stream.</p>}
          </div>
        );
      }}
    </ModuleFrame>
  );
}

// ── People ──────────────────────────────────────────────────────────────────

export function PeopleModule({ q, persona }: { q: UseQueryResult<Module<People>, Error>; persona: Persona }) {
  return (
    <ModuleFrame<People>
      id="home-people"
      title="People"
      className="home-people"
      {...fromQuery(q)}
      thing="people"
      skeleton={<RowsSkeleton rows={3} />}
      notConnected={{ title: "People counts aren't available", what: 'Counts come from the identity directory.' }}
    >
      {(p) => {
        if (persona === 'org_admin') {
          const orgs = p.byOrg ?? [];
          if (orgs.length === 0) return <p className="home-note">No members yet.</p>;
          return (
            <ul className="plain-list people-list">
              {orgs.map((o) => <li key={o.orgId}><a href="#/orgadmin"><b className="tabular">{o.members.toLocaleString()}</b> {o.members === 1 ? 'member' : 'members'} in {o.name}</a></li>)}
              {p.orgsTotal != null && p.orgsTotal > orgs.length && <li className="muted">and {p.orgsTotal - orgs.length} more organizations</li>}
            </ul>
          );
        }
        const users = persona === 'support' ? null : '#/users';
        const pair = (n: number, words: string, href: string | null, tip?: string) => (
          href ? <a href={href} title={tip}><b className="tabular">{n.toLocaleString()}</b> {words}</a> : <span title={tip}><b className="tabular">{n.toLocaleString()}</b> {words}</span>
        );
        return (
          <ul className="plain-list people-list">
            <li>{pair(p.identities, 'people', users)} · {pair(p.active, 'active', users)} · {pair(p.inactive, 'inactive', users)}</li>
            {(p.fullAccess != null || p.unassigned != null) && (
              <li>
                {p.fullAccess != null && pair(p.fullAccess, 'with full access', '#/accessreview', 'People holding a permission that covers everything. Review them regularly.')}
                {p.fullAccess != null && p.unassigned != null && ' · '}
                {p.unassigned != null && pair(p.unassigned, 'in no group', '#/users?filter=unassigned')}
              </li>
            )}
            {p.mfa && (
              <li className="people-mfa">
                <a href="#/users?mfa=none" title="People with a second factor (passkey, authenticator app) out of everyone.">Second factor</a>
                <Meter value={p.mfa.enrolled} of={p.mfa.of} label="People with a second factor" />
              </li>
            )}
            {p.sessionsActive && <li>{pair(p.sessionsActive.count, 'active sessions', null)}</li>}
          </ul>
        );
      }}
    </ModuleFrame>
  );
}
