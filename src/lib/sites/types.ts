/**
 * The Site intent and the shapes jinbe answers with (site-ux.md §14; jinbe src/sites/schemas.ts).
 *
 * The intent mirrors jinbe's zod schema field for field — kuma never sends a field the server does
 * not know, because the schema is strict and a stray key is a 400. The response shapes are the ones
 * jinbe serves today plus the §14.2 ones still being built (status, drift, requests, migration);
 * those are optional everywhere so an older server reads as "not there yet", not as a crash.
 */
import type { SiteSecondFactor } from '../twoFactor';

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface Handler { handler: string; config?: Record<string, unknown> }

export type Access =
  | { kind: 'public' }
  | { kind: 'signed-in' }
  | { kind: 'permission'; permission: string }
  | { kind: 'deny' };

export type ErrorsPreset = 'platform' | 'website' | 'api';

export interface Gate {
  id: string;
  label: string;
  authenticators: Handler[];
  authorizer: 'policy' | Handler;
  mutators: Handler[];
  errors: ErrorsPreset | Handler[];
  methods?: HttpMethod[];
  preflight?: boolean;
  expert?: { matchUrl?: string };
}

export interface Route {
  id: string;
  methods: HttpMethod[];
  path: string;
  gate: string;
  access: Access;
  orgParam?: string;
  source?: 'manual' | 'openapi' | 'template';
  pinned?: boolean;
}

export type RolesPreset = 'standard' | 'readonly' | 'operator';

export interface SiteLogin {
  twoFactor: { scope: 'none' | 'writes' | 'all' | 'routes'; routes?: string[]; clients: 'exempt' | 'refused' };
  reach: 'granted' | 'any-account';
  branding?: { name?: string; logo?: string; accent?: string; welcome?: string; helpUrl?: string };
  postLogoutUrl?: string;
  /** Where a visitor lands after signing in to this site; on the site's own host. */
  defaultReturnUrl?: string;
}

export interface Site {
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  address: { host: string; pathPrefix?: string };
  upstream: {
    service: string;
    namespace: string;
    port: number;
    scheme?: 'http' | 'https';
    preserveHost?: boolean;
    stripPath?: string;
  };
  exposure?: { mode: 'zone' | 'vanity' };
  gates: Gate[];
  routes: { items: Route[]; catchAll: { gate: string; access: Access } };
  roles: RolesPreset | Record<string, string[]>;
  groups: { platform: Record<string, string[]>; orgGrantable: Record<string, { label: string; roles: string[] }> };
  orgs: string[];
  /** What a site role carries into every organization entitled to the site, never more than it holds. */
  everyOrg?: Record<string, string[]>;
  login?: SiteLogin;
  state?: 'active' | 'paused';
}

// ── responses ─────────────────────────────────────────────────

export type SiteStatus = 'live' | 'applying' | 'attention' | 'draft' | 'paused' | 'platform' | 'legacy';

/**
 * Is a zone — and every site under it — behind the WAF (jinbe `protection`)? `waf` needs a Gateway whose
 * Coraza policy is in force and no nginx Ingress left; `none` says why (reason) and names the policies.
 */
export interface ProtectionStatus {
  state: 'waf' | 'none';
  reason: 'gateway' | 'no_gateway' | 'ingress_bypass' | 'gateway_not_protected' | 'gateway_unknown' | 'no_zone';
  gateway: string | null;
  waf: string | null;
  ipReputation: string | null;
  message: string;
}

export interface SiteSummary {
  name: string;
  displayName: string;
  host: string;
  status: SiteStatus;
  kind?: string;
  version: number;
  appliedVersion?: number | null;
  appliedAt?: string | null;
  appliedBy?: string | null;
  people?: number | null;
  orgs?: number;
  draft?: { by: string; at?: string; changes?: number };
  attention?: string[];
  system?: boolean;
  /** Behind the WAF or not; null when the cluster could not say, absent on older servers. */
  protection?: ProtectionStatus | null;
  /** Paused automatically when its TTL passes; null for a permanent site, absent on older servers. */
  ephemeral?: EphemeralView | null;
  /** Its own two-step sign-in bar (the saved version), absent on older servers. */
  secondFactor?: SiteSecondFactor;
}

/** An ephemeral site's expiry (jinbe sites/lifecycle-store.ts ephemeralView). Expired: paused, not deleted. */
export interface EphemeralView {
  ttlSec: number;
  expiresAt: string;
  remainingSec: number;
  expired: boolean;
  expiredAt?: string;
  setBy: string;
}

/** The TTLs jinbe accepts (GET /sites/platform `ephemeral`), in seconds. */
export interface EphemeralLimits { minSec: number; maxSec: number; defaultSec: number }

/**
 * A request to delete a site (jinbe sites/deletion-requests.ts). Anyone who may save a site may ask;
 * a person holding sites:delete other than the requester decides — never through a key.
 */
export interface DeletionRequest {
  id: string;
  site: string;
  reason?: string;
  requestedBy: string;
  requesterId?: string | null;
  /** The client (an MCP key) the requester asked through, when not a browser. */
  requestedVia?: string;
  requestedAt: string;
  state: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decidedBy?: string;
  decidedAt?: string;
  decisionReason?: string;
  /** On the inbox only: the caller asked for it, so may not decide it (four-eyes). */
  requestedByYou?: boolean;
}

export interface SiteDetail {
  site: Site;
  version: number;
  etag: string;
  status: SiteStatus;
  savedAt?: string;
  savedBy?: string;
  applied: { version: number; at: string; by: string; rules: string[] } | null;
  system?: boolean;
  ephemeral?: EphemeralView | null;
  secondFactor?: SiteSecondFactor;
}

export interface SiteDraft {
  site: Partial<Site> & Record<string, unknown>;
  baseVersion: number;
  updatedBy: string;
  updatedAt?: string;
  /** What the next autosave names as If-Match: a draft saved by someone else since is refused (412). */
  etag?: string;
}

/** A 412 stale_draft's `current`: the draft somebody else saved since this editor loaded it. */
export interface DraftConflict { etag: string; updatedBy: string; updatedAt: string | null; baseVersion?: number }

/** One side of an address change, as jinbe describes it on `address_changed`. */
export interface AddressView { host: string; pathPrefix: string | null; zone: string | null; url: string }

export interface Check {
  level: 'error' | 'warn';
  code: string;
  message: string;
  path?: string;
  /** address_changed: the address visitors reach now and the one they will. */
  address?: { from: AddressView; to: AddressView };
  /** A value jinbe offers to write at `path` to clear the check (a landing page left on the old host). */
  fix?: { path: string; value: string };
}

export type RiskLevel = 'low' | 'medium' | 'high';
export interface Risk { level: RiskLevel; flags: Array<{ code: string; level: RiskLevel; message: string }> }

export interface OathkeeperRule {
  id: string;
  match: { url: string; methods: string[] };
  upstream?: { url: string; preserve_host?: boolean; strip_path?: string };
  authenticators: Handler[];
  authorizer: Handler;
  mutators: Handler[];
  errors?: Handler[];
}

export interface RouteRule { method: string; path: string; permission?: string; org_param?: string }

export interface Preview {
  artefacts: {
    routeMap: RouteRule[];
    roles: Record<string, string[]>;
    groups: { platform: Record<string, Record<string, string[]>>; orgGrantable: Record<string, Record<string, string[]>> };
    orgServiceMap: Record<string, string[]>;
    rules: OathkeeperRule[];
    siteCr?: unknown;
  };
  checks: Check[];
  risk: Risk;
  words: string[];
  /** Security findings (jinbe wave18); absent on a server without them. */
  findings?: Finding[];
  /** What publishing this needs: no error finding, and every confirm code acknowledged. */
  publish?: { blocked: boolean; acknowledge: string[] };
}

/**
 * A security finding on what would be published. `error` must be fixed; `confirm` needs a person to
 * acknowledge its code (one acknowledgement covers every finding with that code); `warn` is said.
 */
/** `info`: worth knowing, never blocks nor asks to be acknowledged (e.g. the service gets its internal name as Host). */
export interface Finding { code: string; level: 'error' | 'warn' | 'confirm' | 'info'; message: string; fix: string; path?: string }

export interface FieldChange { path: string; before: unknown; after: unknown }
export interface ArtefactDiff { kind: string; id: string; before: unknown; after: unknown; fields: FieldChange[] }
export interface SiteDiff { artefacts: ArtefactDiff[]; risk: Risk; words: string[] }

export type ZoneIngress = 'wildcard' | 'per-site' | 'none';

export interface Zone {
  name?: string;
  suffix: string;
  wildcard: string;
  cookieDomain: string | null;
  sso: boolean;
  tls: 'wildcard' | 'per-site';
  ingressClass?: string;
  /** Zone CRs: the nginx Ingress mode (`none`: the Gateway alone serves the zone). */
  ingress?: ZoneIngress;
  /** Zone CRs: the Gateway API Gateway (namespace/name) the zone's hosts are attached to. */
  gateway?: string;
  /** Zone CRs: where the certificate comes from. Not `default`: the zone brings its own Gateway listener. Absent on an older jinbe. */
  tlsMode?: 'default' | 'issuer' | 'secret';
  /** The operator's Ready for the current spec; absent = unknown. */
  ready?: boolean;
  /** Zone CRs: behind the WAF or not, as jinbe reads it from the cluster. */
  protection?: ProtectionStatus;
  source?: 'zone' | 'config';
}

export interface ZoneGatewayRef { namespace: string; name: string; sectionName?: string }

/** What the Gateway-level policies enforce on every route (jinbe GET /sites/gateways). */
export interface GatewayProtection {
  waf: { policy: string | null; modules: string[]; accepted: boolean };
  ipReputation: { policy: string | null; backend: string | null; failOpen: boolean | null; accepted: boolean };
  denylist: { policy: string | null };
  protected: boolean;
  summary: string;
}

export interface GatewayListener {
  name: string;
  hostname: string | null;
  port: number | null;
  protocol: string | null;
  tls: boolean;
  routesFromAll: boolean;
  programmed: boolean | null;
  attachedRoutes: number | null;
}

export interface GatewayInfo {
  key: string;
  namespace: string;
  name: string;
  exists: boolean;
  className: string | null;
  addresses: string[];
  programmed: boolean;
  message: string;
  listeners: GatewayListener[];
  protection: GatewayProtection;
}

export interface ZoneCondition { status: string; reason: string; message: string; since?: string }

/** GET/POST/PATCH /sites/zones/:name. */
export interface ZoneDetail {
  name: string;
  domain: string;
  wildcard: string;
  ingress: ZoneIngress;
  ingressClass: string | null;
  gateway: ZoneGatewayRef | null;
  exposure: { entry: 'ingress' | 'gateway' | 'both'; wafBypass: boolean };
  protection: ProtectionStatus;
  tls: { mode: 'default' | 'issuer' | 'secret'; issuer?: string; secretName?: string };
  cookieDomain: string | null;
  sso: boolean;
  status: {
    observed: boolean;
    ready: boolean;
    ingress: ZoneCondition | null;
    gateway: ZoneCondition | null;
    certificate: ZoneCondition | null;
    validated: ZoneCondition | null;
    domainTaken: boolean;
    message: string;
  };
  sites: Array<{ name: string; host: string; applied: boolean }>;
  checks?: Array<Check & { host?: string; addresses?: string[] }>;
}

export interface HostCheck {
  available: boolean;
  owner?: string;
  sharedWith: string[];
  zone: string | null;
  sso: boolean;
  cookieDomain: string | null;
  modes: Array<'zone' | 'vanity'>;
  tls: 'wildcard' | 'per-site' | 'none';
  reserved: boolean;
  checks: Check[];
}

export interface MatchResult {
  gateway: { rules: string[]; verdict: 'one' | 'none' | 'multiple' | 'error'; errors?: Array<{ id: string; error: string }> };
  site: string | null;
  route?: RouteRule;
  needs: string;
  org?: string;
}

export interface RenderResult { value: string; bytes: number; wire?: string; error?: string; warnings?: string[] }

export interface SiteVersion { v: number; at: string; by: string; note?: string; kind: 'save' | 'rollback' | 'apply' | 'drift'; etag?: string; verified?: boolean }

export interface ApplyResult { applyId: string; version: number; rules: string[]; site: string }

export interface BlastRadius {
  groups: string[];
  /** The site's org roles (`<site>:<role>`) the deletion removes. */
  orgRoles?: string[];
  /** An older jinbe's name for the same thing. */
  orgGrantableGroups?: string[];
  orgs: Array<{ id: string; grants: number }>;
  rules: number;
  routes: number;
  people: number | null;
  apiKeys: number | null;
  requests24h: number | null;
}

// §14.2 NEW, being built in parallel (S-3/S-4/S-5).

export interface Condition { type: string; status: 'True' | 'False' | 'Unknown'; reason?: string; message?: string; lastTransitionTime?: string }

export interface SiteK8sStatus {
  exists?: boolean;
  protection?: ProtectionStatus | null;
  version?: number;
  generation: number;
  observedGeneration: number;
  conditions: Condition[];
  children: Array<{
    kind: 'Rule' | 'Ingress' | 'Certificate' | 'HTTPRoute';
    name: string;
    specHash?: string;
    expectedHash?: string | null;
    conditions: Condition[];
    loadedOn?: Array<{ pod: string; loaded: boolean }> | null;
  }>;
}

export type StageState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export interface ApplyStage { id: string; label?: string; state: StageState; startedAt?: string; endedAt?: string; detail?: string }
/** GET /:name/applies/:id (jinbe S-3). `code` on failure: site_invalid | rules_not_loaded | rollback_failed | not_ready. */
export interface ApplyProgress {
  id?: string; site?: string; version?: number; by?: string; startedAt?: string; endedAt?: string;
  state?: 'running' | 'succeeded' | 'failed' | 'rolled-back';
  code?: string; message?: string;
  stages: ApplyStage[];
  checks?: Array<{ id: string; label: string; expected?: string; got?: string; ok: boolean }>;
}

export interface DriftItem { artefact: string; field: string; expected: unknown; actual: unknown; changedBy?: string; at?: string }

export interface ApplyRequest {
  id: string; site: string; version: number; etag?: string; state: 'pending' | 'applied' | 'rejected';
  risk?: Risk; needsSecondApprover?: boolean; requestedBy: string; requestedAt: string;
  decidedBy?: string; decidedAt?: string; reason?: string; applyId?: string; note?: string;
}

export type MigrationState = 'not-started' | 'previewed' | 'dual-run' | 'cutting-over' | 'cut-over' | 'done' | 'rolled-back';

export type MigrationDiff = { method: string; url: string; before: { rule?: string; verdict: string }; after: { rule?: string; verdict: string }; fix?: boolean; cause?: string };

export interface MigrationGroup {
  proposedSite: string;
  kind: 'site' | 'system' | 'unassigned';
  legacyRuleIds: string[];
  renderedRules?: unknown[];
  siteCr?: unknown;
  changes?: FieldChange[];
  warnings?: Array<string | { level: 'block' | 'warn'; code: string; message: string; ruleId?: string }>;
  fixes?: string[];
}

export interface ParityReport {
  at?: string;
  total: number;
  identical: number;
  differs: MigrationDiff[];
  /** Differences not explained by an opted-in fix; any blocks the cut-over. Older shape: `differs` entries without `fix`. */
  regressions?: MigrationDiff[];
  overlapsBefore: number;
  overlapsAfter: number;
}

export interface DualRun {
  startedAt?: string;
  compared: number;
  same: number;
  differs: MigrationDiff[];
  regressions: MigrationDiff[];
  minDurationSec: number;
  eligible: boolean;
}

export interface MigrationStatus {
  state: MigrationState;
  legacyRules: number;
  groups: MigrationGroup[];
  parity?: ParityReport;
  cutoverAt?: string;
  rollbackUntil?: string;
}
