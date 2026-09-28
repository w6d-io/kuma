import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { edgeBlocked } from '../../lib/apiError';
import { HOME_WINDOWS, type HomeWindow, type QuickActionId } from '../../api/home';
import { useMyOrganizationNames, useSecondFactorStatus } from '../../api/hooks';
import { ENROL_DETAIL, ENROL_TITLE, secondFactorPrompt } from '../../lib/secondFactor';
import { twoStepHere } from '../../lib/stepUp';
import { ApiErrorState } from '../../components/ApiErrorState';
import { Badge, Button, I, RelativeTime, Select, SkeletonPanel, cx } from '../../components/ui';
import { parseHash } from '../../lib/route';
import { personaOf, summaryClauses, visibleActions } from '../../lib/home/briefing';
import { homeSelfHref } from '../../lib/home/href';
import { useHomeAggregate, useHomeModule, useHomeRefresh } from './useHome';
import { HealthStrip } from './HealthStrip';
import { NeedsYou } from './NeedsYou';
import { QuickActions } from './QuickActions';
import { TILES, useRunAction } from './moduleKit';
import { GatewayTraffic, SignIns } from './Traffic';
import { PeopleModule, RecentChanges, SitesModule } from './Directory';
import { FindPerson, NoRights } from './Personal';

/**
 * Home — the briefing (home-design.md): is it OK, does anything need me, what happened, and one
 * click to the screen that handles it. Composed from the modules the server lets this caller see;
 * each one loads, fails and empties on its own, so one bad source never blanks the page.
 *
 * Its own state is in the hash: `#/dashboard?window=7d&org=acme`.
 */

/** Drawn unless the server said this caller may not see it. */
const shown = (q: { data?: { status: string } }) => q.data?.status !== 'forbidden';

function readHash(): { window: HomeWindow; org: string | null } {
  const q = parseHash(window.location.hash).query ?? {};
  return {
    window: (HOME_WINDOWS as readonly string[]).includes(q.window) ? (q.window as HomeWindow) : '24h',
    org: q.org && /^[A-Za-z0-9_-]{1,64}$/.test(q.org) ? q.org : null,
  };
}

/** A key typed into a field, or with a modifier, or behind a dialog, is not a Home shortcut. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return true;
  return !!document.querySelector('[role=dialog], .cmdk-wrap');
}

export function HomePage() {
  const [{ window: win, org }, setView] = useState(readHash);
  const params = useMemo(() => ({ window: win, org }), [win, org]);
  const agg = useHomeAggregate(params);
  const refresh = useHomeRefresh();

  const change = (next: { window?: HomeWindow; org?: string | null }) => {
    const v = { window: next.window ?? win, org: next.org !== undefined ? next.org : org };
    setView(v);
    history.replaceState(null, '', homeSelfHref(v.window, v.org));
  };

  // Every module is asked for unconditionally (hooks), and only drawn if the server allows it.
  const a = { data: agg.data, dataUpdatedAt: agg.dataUpdatedAt };
  const health = useHomeModule('health', params, a);
  const attention = useHomeModule('attention', params, a);
  // The viewer's own account first: a role that requires two-step sign-in and no second factor yet.
  const { data: ownSecondFactor } = useSecondFactorStatus();
  const twoStepHref = secondFactorPrompt(ownSecondFactor) === 'enrol' ? twoStepHere() : null;
  const personal = twoStepHref ? { title: ENROL_TITLE, detail: ENROL_DETAIL, href: twoStepHref } : null;
  const people = useHomeModule('people', params, a);
  const activity = useHomeModule('activity', params, a);
  const access = useHomeModule('access', params, a);
  const sites = useHomeModule('sites', params, a);
  const changes = useHomeModule('changes', params, a);
  const actions = useHomeModule('actions', params, a);
  const me = useHomeModule('me', params, a);
  const all = [health, attention, people, activity, access, sites, changes, actions, me];
  const fetching = all.some((q) => q.isFetching) || agg.isFetching;
  const lastUpdated = Math.max(agg.dataUpdatedAt, ...all.map((q) => q.dataUpdatedAt));

  const persona = agg.data ? personaOf(agg.data) : 'none';
  const run = useRunAction(persona);
  const orgNames = useMyOrganizationNames().data ?? {};
  const orgIds = agg.data?.scope.orgs ?? [];
  const orgName = org ? orgNames[org] ?? org : persona === 'org_admin' && orgIds.length === 1 ? orgNames[orgIds[0]] ?? null : null;
  const tiles = useMemo(() => visibleActions(actions.data?.data?.items ?? []), [actions.data]);

  // An org that is not the caller's (a stale link): back to all of theirs rather than a dead page.
  const refusedOrg = !!org && agg.error?.status === 403 && !edgeBlocked(agg.error);
  useEffect(() => { if (refusedOrg) change({ org: null }); });

  // Home-scoped single keys: `r` refreshes; each tile's key opens its flow.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.key === 'r') { e.preventDefault(); void refresh(); return; }
      const tile = tiles.find((t) => TILES[t.id].key === e.key);
      if (tile) { e.preventDefault(); run(tile.id as QuickActionId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tiles, run, refresh]);

  if (agg.isPending && !refusedOrg) {
    return (
      <div className="home" aria-busy="true">
        <div className="home-head"><h1>Home</h1></div>
        <div className="home-loading"><SkeletonPanel lines={2} /><SkeletonPanel lines={5} /><SkeletonPanel lines={4} /></div>
      </div>
    );
  }
  if (agg.isError || !agg.data) {
    return (
      <div className="home">
        <div className="home-head"><h1>Home</h1></div>
        {/* Worded by describeApiError from the 503's code: jinbe's "could not verify authorization"
            reads as the access engine being down — an outage, never a narrowed page. */}
        <ApiErrorState error={agg.error} what="the Home" onRetry={() => void agg.refetch()} />
      </div>
    );
  }

  // The summary reads the freshest copy of each module, not the page-load one.
  const m = agg.data.modules;
  const res = {
    ...agg.data, window: win,
    modules: { ...m, health: health.data ?? m.health, attention: attention.data ?? m.attention, activity: activity.data ?? m.activity, people: people.data ?? m.people, me: me.data ?? m.me },
  };
  const clauses = summaryClauses(res, persona, orgName);
  const env = health.data?.data?.environment;
  const canPlug = tiles.some((t) => t.id === 'new_site');
  const focus = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.focus({ preventScroll: true });
  };

  return (
    <div className={cx('home', `persona-${persona}`)}>
      <header className="home-head">
        <div className="home-head-title">
          <h1>Home</h1>
          {persona === 'org_admin' && orgIds.length > 1 && (
            <Select size="sm" aria-label="Organization" value={org ?? ''} onChange={(e) => change({ org: e.target.value || null })} className="home-org">
              <option value="">All my orgs</option>
              {orgIds.map((id) => <option key={id} value={id}>{orgNames[id] ?? id}</option>)}
            </Select>
          )}
        </div>
        <div className="home-head-meta">
          {env && <span className="home-env">{env.name}</span>}
          {env?.production && <Badge tone="plain" mono={false}>production</Badge>}
          <span className="home-updated">updated <RelativeTime at={new Date(lastUpdated).toISOString()} /></span>
          <Button variant="ghost" size="sm" iconOnly icon={<span className={cx('home-refresh-ico', fetching && 'is-spinning')}>{I.sync}</span>} aria-label="Refresh" aria-keyshortcuts="r" title="Refresh (r)" onClick={() => void refresh()} />
        </div>
      </header>
      {clauses.length > 0 && (
        <p className={cx('home-summary', clauses[0].tone === 'danger' && 'is-danger')} aria-live="polite">
          {clauses[0].tone === 'danger' && <span className="home-summary-ico" aria-hidden="true">{I.alert}</span>}
          {clauses.map((c, i) => (
            <span key={c.anchor + i}>{i > 0 && <span aria-hidden="true"> · </span>}<a href={`#${c.anchor}`} onClick={focus(c.anchor)}>{c.text}</a></span>
          ))}
        </p>
      )}

      {persona === 'none' ? (
        <div className="home-grid">
          {((attention.data?.data?.items.length ?? 0) > 0 || personal) && <div className="area-attention"><NeedsYou q={attention} personal={personal} /></div>}
          <div className="area-main"><NoRights me={me.data?.data} /></div>
        </div>
      ) : (
        <div className="home-grid">
          {/* A forbidden module gets no cell at all: an empty grid item would still take a track. */}
          {shown(health) && <div className="area-health"><HealthStrip q={health} /></div>}
          {persona === 'support' && <div className="area-find"><FindPerson /></div>}
          {shown(attention) && <div className="area-attention"><NeedsYou q={attention} personal={personal} /></div>}
          {shown(actions) && <div className="area-actions"><QuickActions q={actions} persona={persona} /></div>}
          {shown(activity) && <div className="area-activity"><SignIns q={activity} window={win} onWindow={(w) => change({ window: w })} persona={persona} /></div>}
          {shown(access) && <div className="area-access"><GatewayTraffic q={access} /></div>}
          {shown(sites) && <div className="area-sites"><SitesModule q={sites} persona={persona} canPlug={canPlug} /></div>}
          {shown(changes) && <div className="area-changes"><RecentChanges q={changes} /></div>}
          {shown(people) && <div className="area-people"><PeopleModule q={people} persona={persona} /></div>}
        </div>
      )}
    </div>
  );
}
