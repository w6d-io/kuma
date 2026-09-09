export interface Service {
  name: string;
  upstreamUrl: string | null;
  description: string;
  createdAt: string;
  routes: number;
  roles: number;
  /** True when this service is bootstrap-protected (cannot be deleted). */
  system?: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  groups: string[];
  title: string;
  active: boolean;
  last: string;
  /** Primary organization — native Kratos `organization_id` (single). */
  organizationId?: string;
  /**
   * Org memberships as the service that owns them answers, falling back to what was written on the
   * identity. The user's effective membership is this list UNION the primary `organizationId`.
   * Populated by `kratosToUser`; `undefined` when a row came from a source that omits it (e.g. a
   * search hit) — the Users drawer refetches the full identity before editing, so a stale row can
   * never clobber the list.
   */
  organizations?: string[];
  /** True when the identity has at least one second factor (TOTP, WebAuthn, lookup_secret). */
  mfa?: boolean;
}

export interface RouteEntry {
  method: string;
  path: string;
  permission?: string;
}

export interface AccessRule {
  id: string;
  service: string;
  match: {
    url: string;
    methods: string[];
  };
  authenticators: string[];
  authorizer: string;
  mutators: string[];
  /** Error-handler names (flattened for the list/pipeline view; config on `raw`). */
  errors?: string[];
  upstream?: string;
  stripPath?: string;
  // The original jinbe rule, kept so an edit can overlay changed fields onto it
  // (the update endpoint REPLACES the whole rule — reconstructing from the UI
  // shape alone would drop authenticator/mutator/upstream config). Cast to
  // JinbeAccessRule at the edit site.
  raw?: unknown;
}

/**
 * Compact before→after diff envelope (Part A3). Emitted server-side from the
 * pre/post image of a write. `flags` are the AUTHORITATIVE risk markers ([P2-3])
 * — the client `riskOf` refines display only, it never gates `?risk=high`.
 * `summary` is a plain-language sentence describing the change.
 */
export interface AuditChanges {
  resource?: string;
  id?: string;
  /** Items added (e.g. new permissions / group members). */
  added?: string[];
  /** Items removed. */
  removed?: string[];
  /** Scalar field before→after pairs (metadata diffs are key-level, no values). */
  fields?: Record<string, { from?: unknown; to?: unknown }>;
  /** opened_to_public | auth_disabled | grants_super_admin | wildcard_permission | … */
  flags?: string[];
  summary?: string;
}

export interface AuditEvent {
  id: string;
  when: string;
  ts?: string;
  who: string;
  actorName?: string;
  /** access | change | auth | system — separates telemetry from the change record. */
  kind?: string;
  /** Kratos session id for Grafana/session correlation (contract D3). */
  sessionId?: string;
  category: string;
  verb: string;
  target: string;
  /** Structured target id (uuid) + email, so self-grant (actor==target) and the
   *  per-user "done-to" trail can match reliably (contract P1-4). */
  targetId?: string;
  targetEmail?: string;
  status?: string;
  service?: string;
  ip?: string;
  ua?: string;
  reason?: string;
  mfa?: boolean;
  method?: string;
  path?: string;
  statusCode?: number;
  responseTimeMs?: number;
  /** Server-authoritative severity ('critical' | 'warn' | 'info' | 'none' …). */
  severity?: string;
  /** Before→after diff envelope for change events. */
  changes?: AuditChanges;
}

// ─── Audit summary (Part C / A6 GET /audit/summary) ───
export interface AuditSeriesPoint { t: string; total: number; failed?: number }
export interface AuditTopItem { key: string; count: number }
export interface AuditSummary {
  /** Echo of the requested window (e.g. "24h", "7d") for honest labelling. */
  window?: string;
  total: number;
  prevTotal?: number;
  byKind?: Record<string, number>;
  prevByKind?: Record<string, number>;
  byCategory?: Record<string, { total: number; failed: number }>;
  byResult?: Record<string, number>;
  /** Fraction (0..1) OR percent — the UI normalizes defensively. */
  failureRate?: number;
  activeActors?: number;
  prevActiveActors?: number;
  series?: AuditSeriesPoint[];
  topDenied?: AuditTopItem[];
  topActors?: AuditTopItem[];
  computedAt?: string;
}

// ─── Access review (Part B GET /admin/access-review) ───
export interface AccessReviewGrantPath {
  group: string;
  service?: string;
  role?: string;
  /** Plain "group X → svc:role" provenance line. */
  summary?: string;
}
export interface AccessReviewIdentity {
  id: string;
  email: string;
  name?: string;
  /** 0 = global super-admin, 1 = service wildcard, 2 = org-admin, 3 = broad reach. */
  tier: number;
  tierLabel?: string;
  /** Distinct service count the identity can reach. */
  reach?: number;
  services?: string[];
  groups: string[];
  /** Catalog flags: global-super-admin, wildcard, sprawl, self-granted, dormant,
   *  no-mfa, org-admin-broad-reach, inactive-retaining-power, orphaned-group,
   *  unaccounted-power, granted-but-unused. */
  flags: string[];
  mfa?: boolean;
  active?: boolean;
  lastActive?: string | null;
  lastPrivilegedAction?: string | null;
  grantedBy?: string | null;
  grantedAt?: string | null;
  selfGranted?: boolean;
  powerScore?: number;
  paths?: AccessReviewGrantPath[];
}
export interface AccessReviewSummary {
  totalPrivileged: number;
  /** T0 + T1 — "can do anything". */
  canDoAnything: number;
  selfGranted: number;
  dormant: number;
  noMfa?: number;
  computedAt?: string;
}
export interface AccessReview {
  summary: AccessReviewSummary;
  identities: AccessReviewIdentity[];
  /** Bounded-retention disclosure (Redis-only store). */
  limits?: { bounded?: boolean; note?: string };
}

export type GroupMapping = Record<string, string[]>;
export type GroupsMap = Record<string, GroupMapping>;
/** Per-group metadata side-car (system flag, description). */
export type GroupsMetaMap = Record<string, { system?: boolean; description?: string }>;
export type RolesMap = Record<string, Record<string, string[]>>;
export type RouteMapsMap = Record<string, RouteEntry[]>;

export interface AppState {
  meta: {
    jinbeApi: string;
    opalServer: string;
    kratosAdmin: string;
    lastSync: string;
    authDomain?: string;
  };
  services: Service[];
  roles: RolesMap;
  groups: GroupsMap;
  /** Per-group metadata (system flag, description). Indexed by group name. */
  groupsMeta: GroupsMetaMap;
  users: User[];
  /** True while remaining user pages load in the background after first paint. */
  usersLoading?: boolean;
  routeMaps: RouteMapsMap;
  /** Services whose roles / routes failed to load (absent, not empty). A
   *  replace-write must be blocked for these — the current config is unknown,
   *  so a PUT built on a false-empty base would wipe it. */
  rolesErrored?: string[];
  routesErrored?: string[];
  accessRules: AccessRule[];
  audit: AuditEvent[];
}

// SINGLE source of truth for page ids: the type is DERIVED from this runtime
// array so hash-routing validation (AppContext pageFromHash) can never drift
// from the type again. (It did once: 'recertification' was added to the type
// but not to pageFromHash's hand-copied list — first click on the nav entry
// bounced back to the dashboard.)
export const PAGE_IDS = ['dashboard', 'simulator', 'users', 'groups', 'services', 'roles', 'routes', 'rules', 'audit', 'accessreview', 'recertification', 'settings', 'orgadmin', 'organizations', 'backup'] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface TweakDefaults {
  theme: string;
  persona: string;
  density: string;
  accent: string;
  monoFont: string;
  showPipeline: boolean;
  showCounts: boolean;
  showMotion: boolean;
  navCollapsed: boolean;
  matrixColor: boolean;
  levelStyle: string;
  wildcardWarn: boolean;
  simulateForbidden: boolean;
}
