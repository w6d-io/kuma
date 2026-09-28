import type { UseQueryResult } from '@tanstack/react-query';
import type { AccessDecisions, Activity, HomeWindow, Module } from '../../api/home';
import { Badge, BarSeries, I, Kpi, Meter, Segmented, Skeleton } from '../../components/ui';
import { Method } from '../../components/ui/Primitives';
import { deltaOf, type Persona } from '../../lib/home/briefing';
import { formatHash } from '../../lib/route';
import { ModuleFrame } from './ModuleFrame';
import { fromQuery } from './moduleKit';

/** Sign-ins and gateway traffic: the two things an auth platform exists to do (home-design §4.5, §4.6). */

const span = (w: HomeWindow) => (w === '7d' ? 'last 7 days' : 'last 24 h');
const auditHref = (q: Record<string, string>) => `#${formatHash('audit', null, q)}`;
/** The audit log zoomed on one bucket. */
const bucketHref = (w: HomeWindow) => (t: string) => {
  const from = new Date(t);
  const to = new Date(+from + (w === '7d' ? 7 : 1) * 3_600_000);
  return auditHref({ range: 'custom', from: from.toISOString(), to: to.toISOString() });
};

const KpiSkeleton = ({ chart }: { chart: boolean }) => (
  <div aria-hidden="true">
    <div className="kpi-row">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><Skeleton w="50%" h={10} /><Skeleton w="40%" h={24} /><Skeleton w="60%" h={10} /></div>)}</div>
    {chart && <Skeleton h={120} />}
  </div>
);

export function WindowSwitch({ value, onChange }: { value: HomeWindow; onChange: (w: HomeWindow) => void }) {
  return <Segmented label="Time range" value={value} onChange={onChange} options={[{ value: '24h', label: '24 h' }, { value: '7d', label: '7 d' }]} />;
}

export function SignIns({ q, window, onWindow, persona }: {
  q: UseQueryResult<Module<Activity>, Error>; window: HomeWindow; onWindow: (w: HomeWindow) => void; persona: Persona;
}) {
  const org = persona === 'org_admin';
  return (
    <ModuleFrame<Activity>
      id="home-activity"
      title="Sign-ins"
      className="home-activity"
      {...fromQuery(q)}
      thing="sign-ins"
      aside={<WindowSwitch value={window} onChange={onWindow} />}
      skeleton={<KpiSkeleton chart />}
      notConnected={org
        ? { title: "Sign-ins for your organization aren't available yet", what: 'They arrive with the new audit log.' }
        : { title: "Sign-ins aren't connected yet", what: 'Sign-in and change counts come from the audit log.' }}
    >
      {(a) => {
        const s = a.signIns;
        const changes = a.series.reduce((n, b) => n + b.changes, 0);
        const ds = deltaOf(s.succeeded, s.prevSucceeded, a.window);
        const df = deltaOf(s.failed, s.prevFailed, a.window);
        const spike = s.failedFactor != null && s.failedFactor >= 3;
        const range = a.window;
        return (
          <>
            <div className="kpi-row">
              <Kpi label="Signed in" value={s.succeeded.toLocaleString()} sub={ds?.text ?? span(a.window)} subLabel={ds?.aria} href={auditHref({ event: 'auth.login.succeeded', range })} />
              <Kpi
                label="Failed sign-ins"
                value={s.failed.toLocaleString()}
                sub={spike ? `${s.failedFactor}× usual` : df?.text ?? span(a.window)}
                subLabel={spike ? `${s.failedFactor} times the usual for this hour` : df?.aria}
                tone={spike ? 'warning' : undefined}
                icon={spike ? I.trendUp : undefined}
                title={s.failedSpike
                  ? `${s.failedSpike.current.toLocaleString()} failed sign-ins this hour — ${s.failedSpike.factor}× the usual ${s.failedSpike.baseline.toLocaleString()} for this hour (7-day median).`
                  : spike ? `${s.failedFactor}× the usual for this hour (7-day median).` : undefined}
                href={auditHref({ event: 'auth.login.failed', range })}
              />
              <Kpi label="People" value={s.distinctUsers.toLocaleString()} sub="signed in" />
              <Kpi label="Changes" value={changes.toLocaleString()} sub="config changes" href={auditHref({ category: 'config', range })} />
            </div>
            {s.succeeded + s.failed === 0
              ? <p className="home-note">No sign-ins in the {span(a.window)}.</p>
              : <BarSeries
                  buckets={a.series.map((b) => ({ t: b.t, a: b.succeeded, b: b.failed }))}
                  labels={{ a: 'signed in', b: 'failed' }}
                  summary={`Sign-ins, ${span(a.window)}: ${s.succeeded.toLocaleString()} signed in, ${s.failed.toLocaleString()} failed`}
                  hrefOf={bucketHref(a.window)}
                  spanDays={a.window === '7d'}
                />}
            {a.source === 'redis-legacy' && <p className="home-foot muted">From the legacy audit stream — per-org figures arrive with the new audit log.</p>}
          </>
        );
      }}
    </ModuleFrame>
  );
}

export function GatewayTraffic({ q }: { q: UseQueryResult<Module<AccessDecisions>, Error> }) {
  return (
    <ModuleFrame<AccessDecisions>
      id="home-access"
      title="Gateway traffic"
      className="home-access"
      {...fromQuery(q)}
      thing="gateway traffic"
      skeleton={<KpiSkeleton chart={false} />}
      notConnected={{ title: "Gateway traffic isn't connected yet", what: "Allow and deny by site come from the gateway's decision log." }}
    >
      {(d) => {
        const { allow, deny, notFound } = d.totals;
        const decided = allow + deny;
        const total = decided + notFound;
        const rate = decided > 0 ? (deny / decided) * 100 : 0;
        const topSites = d.bySite.slice(0, 5);
        return (
          <>
            <div className="kpi-row is-3">
              <Kpi label="Requests" value={total.toLocaleString()} sub={span(d.window)} />
              <Kpi label="Denied" value={`${rate.toFixed(1)}%`} sub={`${deny.toLocaleString()} requests`} title="Share of gateway decisions that were denied (not signed in, or missing a permission), in the selected range." />
              <Kpi label="Not found" value={notFound.toLocaleString()} sub="route matched no rule" />
            </div>
            {total === 0 && <p className="home-note">No requests in the {span(d.window)}. If sites are live, check the gateway.</p>}
            {d.source === 'oathkeeper-log' && <p className="home-foot muted">Platform totals from gateway logs · per-site figures need the decision log.</p>}
            {d.source === 'decision-log' && d.series.length > 0 && (
              <BarSeries
                buckets={d.series.map((b) => ({ t: b.t, a: b.allow, b: b.deny }))}
                labels={{ a: 'allowed', b: 'denied' }}
                summary={`Gateway requests, ${span(d.window)}: ${allow.toLocaleString()} allowed, ${deny.toLocaleString()} denied`}
                spanDays={d.window === '7d'}
              />
            )}
            {d.source === 'decision-log' && (d.topDeniedRoutes.length > 0 || topSites.length > 0) && (
              <div className="traffic-split">
                {d.topDeniedRoutes.length > 0 && (
                  <div>
                    <h3 className="home-sub">Top denied routes</h3>
                    <ul className="plain-list">
                      {d.topDeniedRoutes.slice(0, 5).map((r) => (
                        <li key={`${r.site}${r.method}${r.route}`}>
                          <a className="denied-row" href={`#${formatHash('accesscheck', null, { app: r.site, method: r.method, path: r.route })}`}>
                            <Badge>{r.site}</Badge>
                            <Method m={r.method} />
                            <span className="mono truncate" title={r.route}>{r.route}</span>
                            <span className="tabular ml-auto">{r.count.toLocaleString()}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {topSites.length > 0 && (
                  <div>
                    <h3 className="home-sub">Denies by site</h3>
                    <ul className="plain-list">
                      {topSites.map((s) => (
                        <li key={s.site} className="site-rate">
                          <span className="truncate">{s.site}</span>
                          <Meter value={s.deny} of={s.allow + s.deny} label={`${s.site}: share of requests denied`} />
                        </li>
                      ))}
                    </ul>
                    <p className="small muted">Same scale across sites.</p>
                  </div>
                )}
              </div>
            )}
          </>
        );
      }}
    </ModuleFrame>
  );
}
