/**
 * The Site intent and the shapes jinbe answers with (site-ux.md §14; jinbe src/sites/schemas.ts).
 *
 * The intent mirrors jinbe's zod schema field for field — kuma never sends a field the server does
 * not know, because the schema is strict and a stray key is a 400. The response shapes are the ones
 * jinbe serves today plus the §14.2 ones still being built (status, drift, requests, migration);
 * those are optional everywhere so an older server reads as "not there yet", not as a crash.
 */

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
  login?: SiteLogin;
  state?: 'active' | 'paused';
}

// ── responses ─────────────────────────────────────────────────

export type SiteStatus = 'live' | 'applying' | 'attention' | 'draft' | 'paused' | 'platform' | 'legacy';

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
}

export interface SiteDraft {
  site: Partial<Site> & Record<string, unknown>;
  baseVersion: number;
  updatedBy: string;
  updatedAt?: string;
}

export interface Check { level: 'error' | 'warn'; code: string; message: string; path?: string }

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
}

export interface FieldChange { path: string; before: unknown; after: unknown }
export interface ArtefactDiff { kind: string; id: string; before: unknown; after: unknown; fields: FieldChange[] }
export interface SiteDiff { artefacts: ArtefactDiff[]; risk: Risk; words: string[] }

export interface Zone {
  name?: string;
  suffix: string;
  wildcard: string;
  cookieDomain: string | null;
  sso: boolean;
  tls: 'wildcard' | 'per-site';
  ingressClass?: string;
  source?: 'zone' | 'config';
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
  orgGrantableGroups: string[];
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

export interface SiteEvent { at: string; type: 'Normal' | 'Warning'; reason: string; object?: string; message?: string; summary?: string }

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

export interface LoginReadiness { withAccess: number; with2fa: number; without2fa: Array<{ email: string }> }

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
