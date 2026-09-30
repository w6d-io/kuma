export interface Service {
  name: string;
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
}

// SINGLE source of truth for page ids: the type is DERIVED from this runtime
// array so hash-routing validation (AppContext pageFromHash) can never drift
// from the type again. (It did once: 'recertification' was added to the type
// but not to pageFromHash's hand-copied list — first click on the nav entry
// bounced back to the dashboard.)
export const PAGE_IDS = ['dashboard', 'users', 'groups', 'audit', 'accessreview', 'recertification', 'settings', 'orgadmin', 'organizations', 'apikeys', 'connections', 'backup', 'accesscheck', 'design', 'sites', 'roles', 'gateway'] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface TweakDefaults {
  persona: string;
  density: string;
  accent: string;
  monoFont: string;
  showPipeline: boolean;
  showCounts: boolean;
  showMotion: boolean;
  navCollapsed: boolean;
  levelStyle: string;
  wildcardWarn: boolean;
  simulateForbidden: boolean;
}
