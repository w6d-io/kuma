import type {
  AccessDecisions, Activity, Attention, Changes, Health, HomeModules, HomeResponse, HomeWindow, Me, Module, People, QuickActions, SitesSummary,
} from '../../api/home';

/**
 * Typed `GET /api/home` responses taken from home-data §3.5, one per persona and per bad day. Used
 * by the tests, the style guide and the screenshot mocks, so all three draw the same data.
 * Times are relative to `now` so ages read the same whenever they are drawn.
 */

const ago = (now: number, ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

const ok = <T,>(data: T, now: number, stale = false): Module<T> => ({ status: 'ok', asOf: ago(now, stale ? 4 * MIN : 8_000), stale, sources: {}, data });
export const forbidden = <T,>(): Module<T> => ({ status: 'forbidden', asOf: null, stale: false, sources: {} });
export const unavailable = <T,>(reason: Module<T>['reason'], connect?: Module<T>['connect']): Module<T> => ({ status: 'unavailable', asOf: null, stale: false, sources: {}, reason, connect });

export function health(now: number): Health {
  return {
    environment: { name: 'dev-aws-1', production: false },
    components: [
      { id: 'gateway', state: 'ok', summary: 'rollout settled', since: ago(now, 3 * D) },
      { id: 'gateway_rules', state: 'ok', summary: 'served 2 s ago' },
      { id: 'opa', state: 'ok', summary: 'reachable (OPAL-managed)' },
      { id: 'opal_data', state: 'ok', summary: '4 min ago' },
      { id: 'kratos', state: 'ok', summary: 'ready' },
      { id: 'jinbe', state: 'ok', summary: 'ready' },
      { id: 'redis', state: 'ok', summary: 'ok' },
      { id: 'audit_store', state: 'ok', summary: 'reachable' },
      { id: 'audit_archive', state: 'degraded', summary: 'archive 3 min behind' },
      { id: 'certificates', state: 'ok', summary: 'soonest 77 d' },
    ],
  };
}

export function attention(now: number): Attention {
  return {
    items: [
      { id: 'site_request_pending:r1', kind: 'site_request_pending', severity: 'critical', title: 'Apply request for Payroll v8', detail: 'Sam Ortiz · high risk · needs a second approver', since: ago(now, 12 * MIN), actionable: true, target: { page: 'sites', params: { view: 'requests', id: 'r1' } } },
      { id: 'site_drift:expenses', kind: 'site_drift', severity: 'warning', title: 'Expenses drifted from what was applied', detail: 'group devs lost "editor" outside kuma', since: ago(now, 2 * H), actionable: true, target: { page: 'sites', params: { name: 'expenses', tab: 'drift' } } },
      { id: 'recert_overdue:q3', kind: 'recert_overdue', severity: 'warning', title: 'Q3 recertification is overdue', detail: '18 decisions left', since: ago(now, 2 * D), actionable: true, target: { page: 'recertification', params: { id: 'q3' } } },
      { id: 'privileged_no_mfa:all', kind: 'privileged_no_mfa', severity: 'info', title: '2 people with full access have no second factor', since: ago(now, 5 * D), actionable: true, target: { page: 'access-review', params: { filter: 'no-mfa' } } },
      { id: 'site_draft_stale:fleet', kind: 'site_draft_stale', severity: 'info', title: 'Fleet API has a draft 8 days old', since: ago(now, 8 * D), actionable: true, target: { page: 'sites', params: { name: 'fleet', tab: 'draft' } } },
      { id: 'unassigned_users:all', kind: 'unassigned_users', severity: 'info', title: '5 people are in no group', since: ago(now, 9 * D), actionable: true, target: { page: 'users', params: { filter: 'unassigned' } } },
    ],
    counts: { critical: 1, warning: 2, info: 3 },
    truncated: false,
  };
}

export function activity(now: number, window: HomeWindow = '24h'): Activity {
  const step = window === '7d' ? 7 * H : H;
  const shape = [2, 2, 3, 3, 5, 6, 8, 9, 8, 6, 6, 7, 9, 11, 9, 8, 6, 5, 4, 3, 2, 2, 2, 2];
  const series = shape.map((v, i) => ({
    t: new Date(now - (24 - i) * step).toISOString(),
    succeeded: v * (window === '7d' ? 21 : 3),
    failed: i === 13 ? 6 : i % 5 === 0 ? 1 : 0,
    changes: i % 3 === 0 ? 2 : 1,
  }));
  const succeeded = series.reduce((n, b) => n + b.succeeded, 0);
  const failed = series.reduce((n, b) => n + b.failed, 0);
  return {
    window,
    signIns: { succeeded, failed, prevSucceeded: Math.round(succeeded * 1.08), prevFailed: 7, distinctUsers: window === '7d' ? 204 : 118, failedFactor: window === '24h' ? 3 : null },
    series,
    byCategory: { config: 37, authz: 12 },
    denied: { total: 14, prev: 11 },
    topDeniedRoutes: [],
    source: 'redis-legacy',
    truncated: false,
  };
}

export function sites(now: number): SitesSummary {
  const site = (name: string, displayName: string, status: SitesSummary['list'][number]['status'], appliedVersion: number | null, appliedAgo: number | null, extra: Partial<SitesSummary['list'][number]> = {}) => ({
    name, displayName, host: `${name}.example.com`, status, ready: status === 'live' ? true : null, version: (appliedVersion ?? 0) + (status === 'draft' ? 1 : 0),
    appliedVersion, appliedAt: appliedAgo == null ? null : ago(now, appliedAgo), appliedBy: appliedAgo == null ? null : { id: 'u1', label: 'Sam Ortiz' },
    draftAt: status === 'draft' ? ago(now, 8 * D) : null, orgs: 2, ...extra,
  });
  return {
    counts: { live: 11, attention: 1, draft: 1, paused: 1, deleted: 0 },
    pendingRequests: 2,
    unhealthy: 0,
    list: [
      site('expenses', 'Expenses', 'attention', 4, 2 * H),
      site('fleet', 'Fleet API', 'draft', null, null),
      site('payroll', 'Payroll', 'live', 7, 2 * H),
      site('billing', 'Billing', 'live', 3, 5 * D, { ready: false }),
      site('docs', 'Docs', 'live', 12, 9 * D),
      site('old-api', 'Old API', 'paused', 2, 40 * D),
    ],
  };
}

export function changes(now: number): Changes {
  const item = (id: string, msAgo: number, event: string, actor: string, target: string) => ({
    eventId: id, ts: ago(now, msAgo), event, category: 'config', result: 'success',
    actor: actor === 'site-operator' ? { id: null, label: actor, type: 'system' as const } : { id: `u-${id}`, label: actor, type: 'user' as const },
    target: { type: 'site', id: target.toLowerCase(), label: target },
    link: { page: 'audit' as const, params: { eventId: id, ts: ago(now, msAgo) } },
  });
  return {
    items: [
      item('e1', 20 * MIN, 'site.applied', 'Sam Ortiz', 'Payroll v8'),
      item('e2', 42 * MIN, 'rbac.group.member_added', 'Maxime', 'payroll-viewers'),
      item('e3', 3 * H, 'site.drifted', 'site-operator', 'Expenses'),
      item('e4', 26 * H, 'org.members.invited', 'Olivia Park', 'Acme'),
      item('e5', 30 * H, 'site.saved', 'Sam Ortiz', 'Fleet API'),
    ],
    source: 'redis-legacy',
  };
}

export const people = (): People => ({
  identities: 412, active: 398, inactive: 14, fullAccess: 2, unassigned: 5,
  mfa: { enrolled: 292, of: 412, asOf: new Date().toISOString() },
});

export const actions = (ids: Array<[QuickActions['items'][number]['id'], boolean, QuickActions['items'][number]['reason']?]>): QuickActions => ({
  items: ids.map(([id, enabled, reason]) => ({ id, enabled, reason, count: id === 'review_requests' ? 2 : undefined })),
});

const me = (name: string, orgs: Me['orgs'] = [], recertPending = 0): Me => ({ subject: 'k-1', name, roles: [], orgs, recertPending, aal: 'aal2' });

const OBS: Module<unknown>['connect'] = { setting: 'opa-authz-proxy decision log (OBS-1.4)', docs: 'docs/research/obs-flow.md#36' };

function response(window: HomeWindow, now: number, scope: Omit<HomeResponse['scope'], 'org'> & { org?: string | null }, modules: HomeModules): HomeResponse {
  return { scope: { org: null, ...scope }, generatedAt: new Date(now - 8_000).toISOString(), window, modules };
}

export function platformHome(now = Date.now(), window: HomeWindow = '24h'): HomeResponse {
  return response(window, now, { platform: true, orgs: [], roles: ['super_admin'] }, {
    health: ok(health(now), now),
    attention: ok(attention(now), now),
    people: ok(people(), now),
    activity: ok(activity(now, window), now),
    access: unavailable('not_deployed', OBS),
    sites: ok(sites(now), now),
    changes: ok(changes(now), now),
    actions: ok(actions([['review_requests', true], ['new_site', true], ['invite_user', true], ['check_access', true], ['grant_access', true], ['find_user', true], ['open_audit', true], ['open_gateway', true, 'mfa_required']]), now),
    me: ok(me('Maxime'), now),
  });
}

export function supportHome(now = Date.now()): HomeResponse {
  return response('24h', now, { platform: false, orgs: [], roles: ['support'] }, {
    health: forbidden(), activity: forbidden(), access: forbidden(), sites: forbidden(), changes: forbidden(),
    attention: ok({ items: [{ id: 'recert_inbox:q3', kind: 'recert_inbox', severity: 'info', title: 'Q3 recertification · 6 decisions waiting on you', since: ago(now, D), actionable: true, target: { page: 'recertification', params: { view: 'inbox' } } }], counts: { critical: 0, warning: 0, info: 1 }, truncated: false }, now),
    people: ok({ identities: 412, active: 398, inactive: 14, sessionsActive: { count: 312, asOf: ago(now, 3 * MIN) } }, now),
    actions: ok(actions([['find_user', true], ['revoke_sessions', true], ['send_recovery', true], ['invite_user', true], ['new_site', false, 'no_permission']]), now),
    me: ok(me('Nina Rossi', [], 6), now),
  });
}

export function orgAdminHome(now = Date.now(), org: string | null = null): HomeResponse {
  const orgs = [{ orgId: 'acme', name: 'Acme', members: 23 }, { orgId: 'globex', name: 'Globex', members: 9 }].filter((o) => !org || o.orgId === org);
  return response('24h', now, { platform: false, orgs: org ? [org] : ['acme', 'globex'], roles: ['org_admin'], org }, {
    health: forbidden(),
    attention: ok({ items: [{ id: 'recert_overdue:acme', kind: 'recert_overdue', severity: 'warning', title: 'Q3 recertification for Acme is overdue', detail: '4 decisions left', since: ago(now, D), actionable: true, target: { page: 'recertification', params: { id: 'q3-acme' } } }], counts: { critical: 0, warning: 1, info: 0 }, truncated: false }, now),
    people: ok({ identities: 32, active: 31, inactive: 1, byOrg: orgs }, now),
    activity: unavailable('not_deployed', { setting: 'LOKI_URL', docs: 'docs/OBSERVABILITY.md' }),
    access: unavailable('not_deployed', OBS),
    sites: ok({ ...sites(now), counts: { live: 2, attention: 0, draft: 0, paused: 0, deleted: 0 }, pendingRequests: 0, list: sites(now).list.filter((s) => s.name === 'payroll' || s.name === 'docs') }, now),
    changes: ok({ ...changes(now), items: changes(now).items.filter((c) => c.eventId === 'e4') }, now),
    actions: ok(actions([['invite_user', true], ['grant_access', true], ['org_api_key', true], ['new_site', false, 'no_permission']]), now),
    me: ok(me('Olivia Park', [{ id: 'acme', name: 'Acme' }, { id: 'globex', name: 'Globex' }]), now),
  });
}

export function noRightsHome(now = Date.now()): HomeResponse {
  return response('24h', now, { platform: false, orgs: [], roles: [] }, {
    health: forbidden(), attention: ok({ items: [], counts: { critical: 0, warning: 0, info: 0 }, truncated: false }, now),
    people: forbidden(), activity: forbidden(), access: forbidden(), sites: forbidden(), changes: forbidden(),
    actions: ok(actions([['new_site', false, 'no_permission'], ['invite_user', false, 'no_permission']]), now),
    me: ok(me('Nina Rossi'), now),
  });
}

/** A platform reader on the worst day: every module unavailable for a different reason. */
export function allUnavailableHome(now = Date.now()): HomeResponse {
  const loki = { setting: 'LOKI_URL', docs: 'docs/OBSERVABILITY.md' };
  return response('24h', now, { platform: true, orgs: [], roles: ['super_admin'] }, {
    health: unavailable('timeout'),
    attention: unavailable('source_down'),
    people: unavailable('warming'),
    activity: unavailable('not_configured', loki),
    access: unavailable('not_deployed', OBS),
    sites: unavailable('not_deployed', { setting: 'SITES_KUBE=in-cluster', docs: 'docs/SERVICE_PLUG.md' }),
    changes: unavailable('not_configured', loki),
    actions: unavailable('timeout'),
    me: ok(me('Maxime'), now),
  });
}

/** A platform reader on a mixed day: a component down, stale and partial modules, an empty queue. */
export function mixedHome(now = Date.now()): HomeResponse {
  const h = health(now);
  h.components = h.components.map((c) => c.id === 'opal_data' ? { ...c, state: 'down', summary: '34 min ago', since: ago(now, 34 * MIN) }
    : c.id === 'gateway' || c.id === 'gateway_rules' ? { ...c, state: 'not_deployed', summary: 'not deployed' }
    : c.id === 'certificates' ? { ...c, state: 'unknown', summary: 'Prometheus not set' } : c);
  const base = platformHome(now);
  return {
    ...base,
    modules: {
      ...base.modules,
      health: ok(h, now),
      attention: { ...ok({ items: [], counts: { critical: 0, warning: 0, info: 0 }, truncated: false }, now), sources: { redis: { state: 'ok' }, certificates: { state: 'not_configured', connect: { setting: 'PROMETHEUS_URL', docs: 'jinbe/docs/observability.md' } } } },
      activity: ok(activity(now), now, true),
      access: ok<AccessDecisions>({ window: '24h', totals: { allow: 126_000, deny: 2440, notFound: 310 }, bySite: [], topDeniedRoutes: [], series: [], source: 'oathkeeper-log' }, now),
      sites: ok({ counts: { live: 0, attention: 0, draft: 0, paused: 0, deleted: 0 }, pendingRequests: 0, unhealthy: null, list: [] }, now),
      changes: unavailable('timeout'),
    },
  };
}

/** The response as the server sends it: forbidden modules omitted. */
export function onTheWire(res: HomeResponse): Omit<HomeResponse, 'modules'> & { modules: Partial<HomeModules> } {
  return { ...res, modules: Object.fromEntries(Object.entries(res.modules).filter(([, m]) => m.status !== 'forbidden')) };
}
