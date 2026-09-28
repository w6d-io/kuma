import { request } from './client';

/**
 * `GET /api/home` — the Home briefing, one envelope per module (home-data §3.4, §11).
 *
 * Every module comes back for every caller: `forbidden` for the ones this caller may not see (the
 * Home does not draw them), `unavailable` with a reason when the source is missing or slow. The
 * HTTP status is 200 whenever the caller's scope resolved, even with every module unavailable; a 503
 * means the policy engine could not say who is asking, which is a page-level error, never a
 * narrowed page.
 */

export type HomeWindow = '24h' | '7d';
export const HOME_WINDOWS: readonly HomeWindow[] = ['24h', '7d'];

export type ModuleStatus = 'ok' | 'unavailable' | 'forbidden';
export type ModuleReason = 'warming' | 'timeout' | 'source_down' | 'not_configured' | 'not_deployed';
export type SourceState = 'ok' | 'down' | 'timeout' | 'warming' | 'not_configured' | 'not_deployed';
export interface Connect { setting: string; docs: string }
/** Per-source detail: a missing source carries its own `connect`. */
export interface SourceDetail { state: SourceState; connect?: Connect }

export interface Module<T> {
  status: ModuleStatus;
  /** When the data was computed (ISO); null when never. */
  asOf: string | null;
  /** Served past its fresh window: the source is slow or down, this is the last good value. */
  stale: boolean;
  reason?: ModuleReason;
  sources: Record<string, SourceDetail>;
  /** Sent when `reason` is not_configured / not_deployed: the setting that connects it. */
  connect?: Connect;
  data?: T;
}

// ── health ──────────────────────────────────────────────────────────────────

export type HealthId = 'waf' | 'jinbe' | 'redis' | 'kratos' | 'opa' | 'opal_data' | 'gateway' | 'gateway_rules' | 'audit_store' | 'audit_archive' | 'certificates';
export type HealthState = 'ok' | 'degraded' | 'down' | 'unknown' | 'not_deployed';

export interface HealthComponent {
  id: HealthId;
  state: HealthState;
  /** Short, no PII: "2/2 engines in sync", "rollout settled", "soonest 77 d". */
  summary: string;
  since?: string;
  link?: { page: string; params?: Record<string, string>; anchor?: string } | { grafana: string };
}

export interface Health {
  environment: { name: string; production: boolean };
  components: HealthComponent[];
}

// ── attention ───────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'warning' | 'info';

export interface HomeTarget { page: string; params?: Record<string, string>; anchor?: string }

export interface AttentionItem {
  id: string;
  /** Open list: an unknown kind is drawn from title / detail / target. */
  kind: string;
  severity: Severity;
  title: string;
  detail?: string;
  subject?: { type: string; id: string; label: string };
  since: string;
  actionable: boolean;
  target: HomeTarget;
  /** Count-type and spike items: `{count}`, `{factor, current, baseline}`. */
  metrics?: Record<string, number>;
}

export interface Attention {
  items: AttentionItem[];
  counts: { critical: number; warning: number; info: number };
  truncated: boolean;
}

// ── people ──────────────────────────────────────────────────────────────────

export interface People {
  identities: number;
  active: number;
  inactive: number;
  fullAccess?: number;
  unassigned?: number;
  mfa?: { enrolled: number; of: number; asOf: string };
  sessionsActive?: { count: number; asOf: string };
  byGroup?: Array<{ group: string; members: number }>;
  byOrg?: Array<{ orgId: string; name: string; members: number }>;
  orgsTotal?: number;
}

// ── activity ────────────────────────────────────────────────────────────────

export interface ActivityBucket { t: string; succeeded: number; failed: number; changes: number }

export interface Activity {
  window: HomeWindow;
  signIns: {
    succeeded: number; failed: number; prevSucceeded: number; prevFailed: number; distinctUsers: number;
    /** Failed sign-ins over the usual for this hour, when the spike rule fired; null below its floor. */
    failedFactor: number | null;
    /** The same spike with its figures, for the tooltip; null below the floor. */
    failedSpike?: { factor: number; current: number; baseline: number } | null;
  };
  series: ActivityBucket[];
  byCategory: Record<string, number>;
  denied: { total: number; prev: number };
  topDeniedRoutes: Array<{ route: string; count: number }>;
  topActors?: Array<{ actorId: string; label: string; count: number }>;
  source: 'loki' | 'redis-legacy';
  truncated: boolean;
}

// ── access (gateway decisions) ──────────────────────────────────────────────

export interface AccessDecisions {
  window: HomeWindow;
  totals: { allow: number; deny: number; notFound: number };
  bySite: Array<{ site: string; allow: number; deny: number; denyRate: number }>;
  topDeniedRoutes: Array<{ site: string; route: string; method: string; count: number }>;
  series: Array<{ t: string; allow: number; deny: number }>;
  source: 'decision-log' | 'oathkeeper-log';
}

// ── sites ───────────────────────────────────────────────────────────────────

export type HomeSiteStatus = 'live' | 'attention' | 'draft' | 'paused';

export interface HomeSite {
  name: string;
  displayName: string;
  host: string | null;
  status: HomeSiteStatus;
  ready: boolean | null;
  version: number;
  appliedVersion: number | null;
  appliedAt: string | null;
  appliedBy: { id: string | null; label: string } | null;
  draftAt: string | null;
  orgs: number;
}

export interface SitesSummary {
  counts: { live: number; attention: number; draft: number; paused: number; deleted: number };
  pendingRequests: number;
  unhealthy: number | null;
  list: HomeSite[];
  migration?: { phase: string; regressions: number; rollbackUntil: string | null };
}

// ── changes ─────────────────────────────────────────────────────────────────

export interface ChangeItem {
  eventId: string;
  ts: string;
  event: string;
  category: string;
  result: string;
  actor: { id: string | null; label: string; type: 'user' | 'service' | 'system' | 'anonymous' };
  target?: { type: string; id: string | null; label: string };
  site?: string;
  orgId?: string;
  link: { page: 'audit'; params: { eventId: string; ts: string } };
}

export interface Changes { items: ChangeItem[]; source: 'loki' | 'redis-legacy' }

// ── actions ─────────────────────────────────────────────────────────────────

export type QuickActionId =
  | 'find_user' | 'invite_user' | 'revoke_sessions' | 'send_recovery'
  | 'new_site' | 'review_requests' | 'open_gateway'
  | 'grant_access' | 'org_api_key' | 'start_recert' | 'open_audit' | 'check_access';

export interface QuickAction {
  id: QuickActionId;
  enabled: boolean;
  reason?: 'no_permission' | 'mfa_required' | 'not_deployed' | 'nothing_to_do';
  /** Pending apply requests, for "Review requests (n)". */
  count?: number;
}

export interface QuickActions { items: QuickAction[] }

// ── me ──────────────────────────────────────────────────────────────────────

export interface Me {
  subject: string;
  name: string | null;
  roles: string[];
  orgs: Array<{ id: string; name: string }>;
  recertPending: number;
  aal: 'aal1' | 'aal2';
}

// ── the response ────────────────────────────────────────────────────────────

export interface HomeModules {
  health: Module<Health>;
  attention: Module<Attention>;
  people: Module<People>;
  activity: Module<Activity>;
  access: Module<AccessDecisions>;
  sites: Module<SitesSummary>;
  changes: Module<Changes>;
  actions: Module<QuickActions>;
  me: Module<Me>;
}

export type HomeModuleKey = keyof HomeModules;
export const HOME_MODULES: readonly HomeModuleKey[] = ['health', 'attention', 'people', 'activity', 'access', 'sites', 'changes', 'actions', 'me'];

export interface HomeResponse {
  /** `org`: the org this answer is narrowed to, else null. */
  scope: { platform: boolean; orgs: string[]; roles: string[]; org: string | null };
  generatedAt: string;
  window: HomeWindow;
  modules: HomeModules;
}

export interface HomeParams { window: HomeWindow; org?: string | null }

function qs({ window, org }: HomeParams): string {
  const p = new URLSearchParams({ window });
  if (org) p.set('org', org);
  return p.toString();
}

const FORBIDDEN = { status: 'forbidden', asOf: null, stale: false, sources: {} } as const;

/**
 * The server omits the modules a caller may not see; the Home works on a full set where those read
 * `forbidden`, so "not drawn" is one rule in one place.
 */
export function withForbidden(res: Omit<HomeResponse, 'modules'> & { modules: Partial<HomeModules> }): HomeResponse {
  const modules = Object.fromEntries(HOME_MODULES.map((k) => [k, res.modules[k] ?? FORBIDDEN])) as unknown as HomeModules;
  return { ...res, modules };
}

export const homeApi = {
  get: (params: HomeParams) =>
    request<Omit<HomeResponse, 'modules'> & { modules: Partial<HomeModules> }>(`/home?${qs(params)}`).then(withForbidden),
  /** One module. A module the caller may not see answers 403 with a forbidden envelope. */
  module: <K extends HomeModuleKey>(key: K, params: HomeParams) =>
    request<HomeModules[K]>(`/home/${key}?${qs(params)}`).catch((e: Error & { status?: number; details?: { status?: string } }) => {
      if (e.status === 403 && e.details?.status === 'forbidden') return FORBIDDEN as unknown as HomeModules[K];
      throw e;
    }),
};
