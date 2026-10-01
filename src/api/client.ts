// API_BASE injected at container start via envsubst (see Dockerfile).
// Falls back to relative /api when Oathkeeper proxies /api on the same domain.
// Detect un-substituted envsubst placeholder (e.g. "${API_BASE}") and treat as empty.
import type { AccessReview } from './types';
import { bearerToken } from '../auth/session';
import { bounceToTwoStep } from '../lib/stepUp';
import { problemsSentence, validationProblems } from '../lib/apiError';
import type { GroupSecondFactor } from '../lib/twoFactor';

const _rawBase: string = (window as any).__API_BASE__ ?? '';
const BASE = (_rawBase.startsWith('${') ? '' : _rawBase).replace(/\/$/, '') || '/api';

/** Resolved API base — exported for EventSource (SSE), which can't use `request`. */
export const API_BASE = BASE;

/**
 * The error a failed call throws. The API's human-readable message ('Group X grants admin
 * privileges; the target user must enroll a second factor…') rather than just the error code, so a
 * toast explains what went wrong — and the code and whole body beside it, so describeApiError can
 * tell one outage from another (a 503 is OPA, Kubernetes, gatekit or Loki by its `error`).
 */
export async function errorFrom(res: Response, message?: string): Promise<Error> {
  // Read as text first: an empty body is itself an answer (see edgeBlocked below).
  const text = typeof res.text === 'function' ? await res.text().catch(() => '') : undefined;
  const body: ErrorBody = text === undefined ? await res.json().catch(() => ({})) : parseBody(text);
  // The edge WAF (Coraza on Envoy) refuses with a bare 403 and no body at all, while jinbe and
  // Oathkeeper always explain theirs in JSON and the ingress error page sends HTML. Told apart
  // here, so the screen does not send somebody off to ask for a role they already hold.
  const edgeBlocked = res.status === 403 && text !== undefined && text.trim() === '';
  // A validation refusal with no sentence of its own ("Validation failed") says which values, so a
  // screen that shows only the message still names them; the list itself stays on `details`.
  const fields = body.message ? '' : problemsSentence(validationProblems({ status: res.status, details: body }));
  const msg = message ?? (body.message || (typeof body.error === 'string' ? body.error : body.error?.message) || (edgeBlocked ? 'Blocked by the web firewall' : `HTTP ${res.status}`)) + (fields ? `: ${fields}` : '');
  return Object.assign(new Error(msg), {
    status: res.status,
    code: body.error,
    edgeBlocked,
    // Carried onto the error so a refusal can say it changed nothing. The service sets it on every
    // gate refusal, and without it here the console can only show the previous state and leave the
    // reader to guess whether part of the change went through.
    applied: body.applied,
    // Seconds, from a 429's Retry-After: how long a limited action stays refused.
    retryAfter: Number(res.headers?.get?.('retry-after')) || undefined,
    details: body,
  });
}

/** What jinbe (and Oathkeeper, whose `error` is an object) put in a refusal. */
type ErrorBody = { message?: string; error?: string | { message?: string }; applied?: boolean; [k: string]: unknown };

function parseBody(text: string): ErrorBody {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  // A token when the deployment signs in against an authority, the session cookie otherwise. Sent
  // together rather than exclusively: which one the API accepts is its decision, and a console that
  // guessed would break the moment the API changed its mind.
  const token = await bearerToken();
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    // Only claim a JSON body when there IS one — Fastify 400s a body-less
    // POST carrying Content-Type: application/json (bit the rollback and
    // backup-now endpoints).
    headers: {
      ...(opts?.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
    ...opts,
  });
  if (!res.ok) {
    const err = await errorFrom(res);
    // A firewall block says nothing about two-step sign-in, and every extra call counts toward a ban.
    if (!(err as { edgeBlocked?: boolean }).edgeBlocked) noticeSecondFactor(res.status, (err as { code?: unknown }).code);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** What GET /public/second-factor answers about the signed-in person. */
export interface SecondFactorStatus {
  secondFactorRequired: boolean;
  hasSecondFactor: boolean;
  methods: string[];
  aal: string;
}

let secondFactorProbe: Promise<void> | null = null;

/**
 * An account that must use two-step sign-in, below aal2, is refused by every administrative call.
 * jinbe says so (`second_factor_required`, 422 so the ingress keeps the body) and the console goes
 * to the sign-in site's two-step gate. The gateway can refuse first, with a 403 whose reason the
 * ingress error page swallows: then the console asks jinbe once per page, on a route that answers
 * at aal1, and goes only if that is the reason — a plain "no permission" stays a 403 on screen.
 */
export function noticeSecondFactor(status: number, code: unknown): void {
  if (code === 'second_factor_required') {
    bounceToTwoStep();
    return;
  }
  if (status !== 403 || typeof code === 'string' || secondFactorProbe) return;
  secondFactorProbe = fetch(`${BASE}/public/second-factor`, { credentials: 'include' })
    .then(r => (r.ok ? (r.json() as Promise<SecondFactorStatus>) : null))
    .then(s => { if (s?.secondFactorRequired && s.aal !== 'aal2') bounceToTwoStep(); })
    .catch(() => {});
}

/** Test seam. */
export function resetSecondFactorProbe(): void {
  secondFactorProbe = null;
}

// ─── Auth / Session ───
export const api = {
  session: () => request<WhoamiResponse>('/whoami'),

  // ─── Directory stats (cached server-side counts; no directory walk) ───
  getStats: () => request<DirectoryStats>('/admin/stats'),

  // ─── User substring search (cached in-memory server-side; no directory walk) ───
  searchUsers: (q: string, limit = 50) => {
    const qs = new URLSearchParams({ q });
    if (limit) qs.set('limit', String(limit));
    return request<{ data: SearchedUser[] }>(`/admin/users/search?${qs.toString()}`).then(r => r.data);
  },

  // ─── Quick find: a pasted Kratos id, a whole email, or the start of one (one bounded Kratos query) ───
  lookupUsers: (q: string, limit = 8) => {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    return request<LookupAnswer>(`/admin/users/lookup?${qs.toString()}`);
  },

  // ─── Users (Kratos identities) ───
  // Kratos paginates with keyset tokens (no total count) and defaults to a
  // single 250-row page. page_size=1000 (Kratos/jinbe max) keeps directories
  // up to 1000 users to one round trip.
  // `search` maps to Kratos `credentials_identifier` — an EXACT identifier
  // (email) match, not a substring/name search (jinbe/Kratos limitation, J9).
  // Callers that need name search filter client-side over loaded pages.
  getUsersPage: (pageToken?: string, pageSize = 1000, search?: string) => {
    const qs = new URLSearchParams({ page_size: String(pageSize) });
    if (pageToken) qs.set('page_token', pageToken);
    if (search) qs.set('credentials_identifier', search);
    return request<{ data: KratosIdentity[]; next_page_token?: string }>(
      `/admin/users?${qs.toString()}`,
    ).then(r => ({ data: r.data, nextPageToken: r.next_page_token }));
  },

  getUser: (id: string) => request<KratosIdentity>(`/admin/users/${id}`),

  setUserGroups: (email: string, groups: string[]) =>
    request<SetUserGroupsResponse>(`/admin/users/${encodeURIComponent(email)}/groups`, {
      method: 'PUT',
      body: JSON.stringify({ groups }),
    }),

  createUser: (payload: { email: string; name: string; groups?: string[]; grants?: import('../lib/grants').GrantDraft[]; sendInvite?: boolean }) =>
    request<{ identity: KratosIdentity; recoveryLink?: string }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteUser: (id: string) =>
    request<void>(`/admin/users/${id}`, { method: 'DELETE' }),

  sendRecoveryEmail: (id: string) =>
    request<void>(`/admin/users/${id}/recovery-email`, { method: 'POST' }),

  setUserState: (id: string, state: 'active' | 'inactive') =>
    request<{ identity: KratosIdentity }>(`/admin/users/${id}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ state }),
    }),

  setUserMetadata: (id: string, metadata: Record<string, unknown>) =>
    request<{ identity: KratosIdentity }>(`/admin/users/${id}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata_admin: metadata }),
    }),

  setUserOrganization: (id: string, organizationId: string | undefined) =>
    request<{ identity: KratosIdentity }>(`/admin/users/${id}/organization`, {
      method: 'PATCH',
      body: JSON.stringify({ organization_id: organizationId || null }),
    }),

  // ─── Groups ───
  getGroups: () =>
    request<{ groups: JinbeGroup[] }>(`/admin/rbac/groups`).then(r => r.groups),

  createGroup: (group: { name: string; services: Record<string, string[]> }) =>
    request<{ commitId: string }>(`/admin/rbac/groups`, {
      method: 'POST',
      body: JSON.stringify(group),
    }),

  updateGroup: (name: string, services: Record<string, string[]>) =>
    request<{ commitId: string }>(`/admin/rbac/groups/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ services }),
    }),

  deleteGroup: (name: string) =>
    request<void>(`/admin/rbac/groups/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // ─── Services ───
  getServices: () =>
    request<{ services: JinbeService[] }>(`/admin/rbac/services`).then(r => r.services),

  getServicePermissions: (name: string) =>
    request<{ permissions: string[] }>(`/admin/rbac/services/${name}/permissions`),

  // ─── Roles (per service) ───
  getRoles: (serviceName: string) =>
    request<{ service: string; roles: JinbeRole[]; meta: { fileSha: string } }>(`/admin/rbac/services/${serviceName}/roles`),

  /** Replace every role of a site. The whole map goes up: a role left out is deleted. */
  setServiceRoles: (serviceName: string, roles: Record<string, string[]>) =>
    request<{ success: boolean; message: string }>(`/admin/rbac/services/${encodeURIComponent(serviceName)}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ roles }),
    }),

  /** Every person with the site groups they hold — the member lists of Groups and Roles. */
  getRbacUsers: () =>
    request<{ users: import('../lib/rbacEdit').RbacUser[] }>(`/admin/rbac/users`).then(r => r.users),

  // ─── Routes / Route map (per service) ───
  getServiceRoutes: (serviceName: string) =>
    request<{ service: string; rules: JinbeRouteRule[] }>(`/admin/rbac/services/${serviceName}/routes`),

  /**
   * Every organisation, for the screen that administers them.
   *
   * Not `/me/organizations`: that one answers with MINE, whoever asks. It used to widen to every
   * organisation for an administrator, so the same URL meant two things and a `scope` field existed
   * to say which — a screen asking for everything could not tell a short answer from a complete one.
   */
  allOrganizations: () =>
    request<{
      organizations: {
        id: string;
        name: string;
        tenant: string;
        /** The organisation registry's deployments — not what it is entitled to (that is `sites`). */
        applications?: string[];
        /** Identity ids holding jinbe:owner there. Absent on an older jinbe. */
        owners?: string[];
        /** The sites whose intents list it (org_sites): whose org roles it may hold. Absent on an older jinbe. */
        sites?: string[];
      }[];
    }>('/admin/organizations'),

  /** A new organisation from a name; the tenant is derived from it when not given. */
  createOrganization: (body: { name: string; tenant?: string }) =>
    request<OrganizationRecord>('/admin/organizations', { method: 'POST', body: JSON.stringify(body) }),

  /** Rename or re-tenant. Only what is sent changes. */
  updateOrganization: (id: string, body: { name?: string; tenant?: string }) =>
    request<OrganizationRecord>(`/admin/organizations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /** Only an organisation nobody belongs to: jinbe answers 409 organisation_in_use otherwise. */
  deleteOrganization: (id: string) =>
    request<void>(`/admin/organizations/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ─── Access review (Part B — "who can do anything") ───
  getAccessReview: () => request<AccessReview>('/admin/access-review'),

  // ─── Access recertification campaigns (phase 1: explicit reviewers, one-shot) ───
  listRecertCampaigns: () =>
    request<{ campaigns: RecertCampaignSummary[] }>('/admin/recert/campaigns').then(r => r.campaigns),

  createRecertCampaign: (payload: {
    name: string;
    scope?: { groups?: string[] };
    reviewers: string[];
    deadline: string;
    onExpiry: RecertOnExpiry;
  }) =>
    request<RecertCampaign>('/admin/recert/campaigns', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getRecertCampaign: (id: string) =>
    request<{ campaign: RecertCampaign; items: RecertItem[] }>(`/admin/recert/campaigns/${encodeURIComponent(id)}`),

  activateRecertCampaign: (id: string) =>
    request<{ campaign: RecertCampaign; itemCount: number }>(`/admin/recert/campaigns/${encodeURIComponent(id)}/activate`, { method: 'POST' }),

  closeRecertCampaign: (id: string) =>
    request<{ campaign: RecertCampaign }>(`/admin/recert/campaigns/${encodeURIComponent(id)}/close`, { method: 'POST' }),

  deleteRecertCampaign: (id: string) =>
    request<void>(`/admin/recert/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  decideRecertItem: (campaignId: string, itemId: string, decision: 'approved' | 'revoked', comment?: string) =>
    request<{ item: RecertItem }>(`/admin/recert/items/${encodeURIComponent(campaignId)}/${encodeURIComponent(itemId)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, ...(comment ? { comment } : {}) }),
    }),

  // Frozen completion report — downloaded as a JSON file (audit evidence).
  downloadRecertReport: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/admin/recert/campaigns/${encodeURIComponent(id)}/report`, { credentials: 'include' });
    if (!res.ok) throw await errorFrom(res);
    const report = await res.json();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recert-report-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ─── Bundle export / import / S3 backups ───
  exportBundle: async (sections?: string[]): Promise<void> => {
    const q = sections && sections.length ? `?sections=${sections.join(',')}` : '';
    const res = await fetch(`${BASE}/admin/rbac/bundle/export${q}`, { credentials: 'include' });
    if (!res.ok) throw await errorFrom(res);
    const bundle = await res.json();
    const filename = `auth-bundle-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  // `sections` (optional) applies only the chosen parts of the uploaded (full)
  // snapshot — override/add, no prune. Omitted → full 1:1 restore.
  importBundle: (bundle: unknown, sections?: string[]) => {
    const q = sections && sections.length ? `?sections=${sections.join(',')}` : '';
    return request<{ success: boolean; imported: BundleImportResult }>(`/admin/rbac/bundle/import${q}`, {
      method: 'POST',
      body: JSON.stringify(bundle),
    });
  },

  // Import history — automatic pre-import/restore/rollback snapshots kept in
  // Redis (cap 10). Rollback re-applies a snapshot as a full restore.
  getImportHistory: () =>
    request<{ history: ImportHistoryEntry[] }>('/admin/rbac/bundle/history').then(r => r.history),
  rollbackImport: (id: string) =>
    request<{ success: boolean }>(`/admin/rbac/bundle/history/${encodeURIComponent(id)}/rollback`, { method: 'POST' }),

  // S3 backup snapshots (only meaningful when the chart enabled backup).
  listBackups: () =>
    request<BackupList>('/admin/rbac/bundle/backups'),
  restoreBackup: (key: string) =>
    request<{ success: boolean; restoredFrom: string; imported: BundleImportResult }>(
      '/admin/rbac/bundle/backups/restore',
      { method: 'POST', body: JSON.stringify({ key }) },
    ),
  backupNow: () =>
    request<{ success: boolean; key: string }>('/admin/rbac/bundle/backups/now', { method: 'POST' }),

  // ─── Kratos auth-method toggles (hot-reload; kratos.yml via jinbe) ───
  // GET: state per method. PUT: partial patch — only the methods present in
  // the body are touched. webauthn/passkey/oidc can only be enabled once
  // their config block exists in kratos.yml (jinbe rejects otherwise).
  getAuthMethods: () =>
    request<AuthConfigState>('/admin/auth/methods'),

  // ─── The signed-in person's own two-step status (answers at aal1; 401 without a session) ───
  secondFactorStatus: () =>
    request<SecondFactorStatus>('/public/second-factor'),

  // ─── Groups whose members must use two-step sign-in (default: super_admins) ───
  getSecondFactorGroups: () =>
    request<SecondFactorGroups>('/admin/settings/second-factor'),

  setSecondFactorGroups: (groups: string[]) =>
    request<SecondFactorGroups>('/admin/settings/second-factor', {
      method: 'PUT',
      body: JSON.stringify({ groups }),
    }),

  // ─── Sign-in protection: bot check per Kratos flow + who may sign up (enforced by a Kratos hook) ───
  getSignInProtection: () =>
    request<SignInProtectionView>('/admin/settings/sign-in-protection'),

  setSignInProtection: (settings: SignInProtection) =>
    request<SignInProtectionView>('/admin/settings/sign-in-protection', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  // ─── AI assistants (MCP): the administrator's switch under the deployment's DELEGATED_TOKENS_ENABLED ───
  getMcpSettings: () =>
    request<McpSettingsView>('/admin/settings/mcp'),

  setMcpSettings: (settings: McpSettings) =>
    request<McpSettingsView>('/admin/settings/mcp', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  /** Any signed-in person: is MCP on, where its server answers (Connections & keys). */
  getMcpStatus: () =>
    request<McpStatus>('/mcp/status'),

  setAuthMethods: (patch: AuthConfigPatch) =>
    request<AuthConfigState>('/admin/auth/methods', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  // ─── Impact preview — who gains/loses access if this change is applied ───


  // ─── One organization from the inside (scoped to the caller's orgs) ───
  // The organizations the caller belongs to; what they may do in each is /me/permissions orgPermissions.
  // The scope is kept, not dropped: it says WHICH authority answered. `claim` means the deployment
  // reads organisations from the verified token, so nobody administers them here and a screen that
  // advised asking an administrator would be advising the impossible.
  // `names` is what to call each one on screen, keyed by identifier — served by the API because
  // that is where they are known. Absent, a screen shows the identifier: worse to read, still
  // correct, and never a guess.
  myOrganizations: () =>
    request<{
      organizations: string[]
      names?: Record<string, string>
      scope?: 'delegated' | 'claim' | 'all'
    }>('/me/organizations'),

  // Users in an org (scoped). credentials_identifier is an exact-match filter.
  getOrgUsers: (orgId: string, opts?: { search?: string; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.search) qs.set('credentials_identifier', opts.search);
    if (opts?.pageSize) qs.set('page_size', String(opts.pageSize));
    const q = qs.toString();
    return request<{ data: KratosIdentity[]; total: number }>(
      `/organizations/${orgId}/users${q ? `?${q}` : ''}`,
    );
  },

  createOrgUser: (
    orgId: string,
    payload: { email: string; name?: string; sendInvite?: boolean; roles?: string[]; grants?: import('../lib/grants').GrantDraft[] },
  ) =>
    request<KratosIdentity>(`/organizations/${orgId}/users`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// ─── Types matching jinbe API responses ───

// Impact preview: every access decision the proposed change flips, evaluated
// by the live OPA policy over sampled real traffic + the declared routes.
export interface ImpactFlip { email: string; action: string; object: string; before: boolean; after: boolean }
export interface ImpactPreviewResult {
  losses: ImpactFlip[];
  gains: ImpactFlip[];
  unchanged: number;
  sample: { audit: number; synthetic: number; total: number };
  /** false = OPA unreachable — preview unavailable, NOT "no impact". */
  evaluated: boolean;
}

// Automatic snapshot taken before every bundle import/restore/rollback.
export interface ImportHistoryEntry {
  id: string;
  takenAt: string;
  actor: string | null;
  reason: 'pre-import' | 'pre-restore' | 'pre-rollback';
  counts: { services: number; groups: number; roles: number; routeMaps: number; oathkeeperRules: number; orgSites?: number; orgAssignments?: number };
}

// Gateway sign-in methods per service — ordered fallback cookie → bearer →
// introspection; [] = public. Maps to the service rule's Oathkeeper
// authenticator chain in jinbe.
export type SignInMethod = 'cookie' | 'bearer' | 'introspection';

/** GET/PUT /admin/settings/second-factor. */
export interface SecondFactorGroups {
  groups: string[];
  /** What an unset setting means (super_admins), to offer a reset. */
  defaultGroups: string[];
}

/** GET/PUT /admin/settings/sign-in-protection — jinbe src/sign-in-protection/settings.ts. */
export type BotCheckFlow = 'registration' | 'login' | 'recovery' | 'verification';
export type RegistrationMode = 'open' | 'allowlist' | 'closed';
export interface SignInProtection {
  captcha: { flows: Record<BotCheckFlow, boolean>; failMode: 'closed' | 'open' };
  registration: {
    mode: RegistrationMode;
    allowEmails: string[];
    allowDomains: string[];
    denyDomains: string[];
    blockDisposable: boolean;
  };
}
export interface SignInProtectionView {
  settings: SignInProtection;
  defaults: SignInProtection;
  /** Who checks the answers. Never the secret: only whether it is set. */
  provider: {
    provider: 'turnstile' | 'hcaptcha' | 'recaptcha';
    configured: boolean;
    siteKey: string | null;
    secretSet: boolean;
    testKeys: boolean;
    problem: string | null;
  };
  /** Size of the built-in disposable-inbox list. */
  disposableDomains: number;
}

/** GET/PUT /admin/settings/mcp — jinbe src/mcp/settings.ts. */
export interface McpSettings {
  enabled: boolean;
  /** Shown on Connections & keys; null = the console's own MCP_SERVER_URL. */
  serverUrl: string | null;
  personalKeys: { maxDays: number };
  /** 'all', or the names of the groups whose members may use it. */
  allowedGroups: 'all' | string[];
  /**
   * Sign-in with a browser (OAuth): an assistant opens the sign-in page instead of taking a key. On by
   * default once AI assistants are. Absent on a jinbe without it; other fields jinbe adds are kept.
   */
  oauth?: {
    enabled: boolean;
    /** How long one sign-in lives, 1–30 days. */
    maxDays?: number;
    /** 'window': protected actions allowed for `protectedActionsHours` after the second factor proven at sign-in. */
    protectedActions?: 'off' | 'window';
    protectedActionsHours?: number;
    [k: string]: unknown;
  };
}
export interface McpSettingsView {
  settings: McpSettings;
  defaults: McpSettings;
  /** DELEGATED_TOKENS_ENABLED: false and MCP stays off whatever is saved. */
  ceiling: { enabled: boolean; note: string | null };
  /** ceiling AND switch. */
  effective: boolean;
}
/** GET /mcp/status. `off`: why not — the deployment (env ceiling) or an administrator (the switch). */
export interface McpStatus {
  enabled: boolean;
  serverUrl: string | null;
  off: 'deployment' | 'administrator' | null;
  personalKeys: { maxDays: number } | null;
  /** Whether the caller's groups may use it; null when it is off (absent on an older jinbe). */
  allowed?: boolean | null;
  /** Sign-in with a browser: false when MCP is off or no issuer is configured; absent on an older jinbe. */
  oauth?: { enabled: boolean };
}

// Kratos self-service auth methods managed via /admin/auth/methods.
export type AuthMethodName =
  | 'password' | 'code' | 'totp' | 'lookup_secret' | 'link' | 'profile'
  | 'webauthn' | 'passkey' | 'oidc';

export interface AuthMethodState {
  enabled: boolean;
  /** Method has a config block in kratos.yml — required before enabling webauthn/passkey/oidc. */
  configured: boolean;
  /** Only on `code`: allow one-time-code as a first-factor (passwordless) login. */
  passwordlessEnabled?: boolean;
}

export type AuthMethodsMap = Record<AuthMethodName, AuthMethodState>;

// Full auth-config state: per-method toggles + the self-registration switch.
// registration.enabled=false → accounts are created only by admins (Users →
// create + invite); the public registration flow answers "disabled".
export interface AuthConfigState {
  methods: AuthMethodsMap;
  registration: { enabled: boolean };
}
export type AuthConfigPatch = Partial<Record<AuthMethodName, { enabled?: boolean; passwordlessEnabled?: boolean }>> & {
  registration?: { enabled: boolean };
};

export interface DirectoryStats {
  total: number;
  active: number;
  fullAccess: number;
  unassigned: number;
  perGroup: Record<string, number>;
  perOrg: Record<string, number>;
  perService: Record<string, number>;
  computedAt: string;
}

export interface SearchedUser {
  id: string;
  email: string;
  name: string | null;
  groups: string[];
  organizationId: string | null;
  active: boolean;
  mfa?: boolean; // real second-factor status (jinbe enriches search hits via hasMFA)
}

/** An organisation as the admin routes answer it. */
export interface OrganizationRecord {
  id: string;
  name: string;
  tenant: string;
  applications: string[];
}

/** One person found by GET /admin/users/lookup. `null` = that part could not be read, not "none". */
export interface LookupHit {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  groups: string[] | null;
  organizations: string[] | null;
  mfa: boolean | null;
}

export interface LookupAnswer {
  match: 'id' | 'email' | 'prefix' | 'contains' | 'none';
  data: LookupHit[];
}

export interface WhoamiResponse {
  authenticated: boolean;
  email: string | null;
  name: string | null;
  picture: string | null;
  identity_id: string | null;
  session_id: string | null;
  error: string | null;
  groups: string[];
  roles: string[];
  permissions: string[];
  /**
   * The catalogue permissions held (policy/catalog.ts): what every gate reads, exactly.
   * Absent on an older jinbe: see policy/model.ts holds.
   */
  effective_permissions?: string[];
  /**
   * Where the rules are enforced from — `service` (this console is the source) or `gitops` (Rule
   * resources and labelled ConfigMaps, synced from a repository). Absent on an older service, which
   * reads as `service`: see policy/source.ts.
   */
  rules_source?: 'service' | 'gitops';

}

export interface SetUserGroupsResponse {
  id: string;
  organizationId: string | null;
  email: string;
  groups: string[];
  updatedAt: string;
}

export interface KratosIdentity {
  id: string;
  schema_id: string;
  state: 'active' | 'inactive';
  state_changed_at: string;
  traits: {
    email: string;
    name?: string;
    picture?: string;
  };
  metadata_admin?: {
    groups?: string[];
    /**
     * Multi-org membership (org UUIDs / slugs). Authoritative multi-tenant
     * list; jinbe unions it with the native `organization_id` into OPA's
     * `user_organizations`. There is no dedicated writer — it is merged in via
     * `PATCH /admin/users/:id/metadata` (which refuses group changes). Absent
     * on legacy identities → treat as an empty array.
     */
    organizations?: string[];
    [key: string]: unknown;
  };
  organization_id?: string;
  /**
   * The organisations this identity belongs to, as the service that OWNS membership answers them —
   * the primary one included. This is the truth now: `metadata_admin.organizations` is what somebody
   * once wrote on the identity, kept as the fallback for a backend that does not own membership yet.
   *
   * Absent and empty are different answers. `[]` means "belongs to nothing"; absent means nobody
   * could say, and the fallback applies.
   */
  organizations?: string[];
  /** Kratos' own record of each address and whether its owner confirmed it. Absent on an older jinbe. */
  verifiable_addresses?: { value: string; verified: boolean; via?: string; status?: string }[];
  created_at: string;
  updated_at: string;
}

export interface JinbeGroup {
  name: string;
  services: Record<string, string[]>;
  /** True when this group is defined in code (staff groups, super_admins) or by a site intent: read-only here (409 defined_in_code). */
  system?: boolean;
  description?: string;
  /** Whether members must use two-step sign-in (lib/twoFactor.ts). Absent on an older jinbe. */
  secondFactor?: GroupSecondFactor;
}

export interface JinbeService {
  name: string;
  displayName?: string;
  rolesFilePath: string;
  routeMapFilePath: string;
  rolesCount: number;
  routesCount: number;
  /** True when its roles and routes are defined in code (jinbe) or by a site intent: read-only here (409 defined_in_code). */
  system?: boolean;
  description?: string;
}

export interface JinbeRole {
  name: string;
  description?: string;
  permissions: string[];
  inherits?: string[];
}

export interface JinbeRouteRule {
  method: string;
  path: string;
  permission?: string;
}

// ─── Access recertification (jinbe /admin/recert) ───
export type RecertOnExpiry = 'revoke' | 'flag';
export type RecertStatus = 'draft' | 'active' | 'closing' | 'completed' | 'archived';
export type RecertDecision = 'pending' | 'approved' | 'revoked';
export type RecertOutcome = 'kept' | 'auto-revoked' | 'flagged' | 'revoke-applied';

export interface RecertCampaign {
  id: string;
  name: string;
  scope: { groups?: string[] };
  reviewerPolicy: 'explicit';
  reviewers: string[];
  schedule: { kind: 'one-shot' };
  deadline: string;
  onExpiry: RecertOnExpiry;
  status: RecertStatus;
  createdBy: string | null;
  createdAt: string;
  closedAt?: string;
}

export interface RecertCampaignSummary extends RecertCampaign {
  itemCount: number;
  decidedCount: number;
}

export interface RecertItem {
  id: string;
  campaignId: string;
  subject: string;
  entitlement: { kind: 'group-membership'; group: string };
  reviewer: string;
  decision: RecertDecision;
  decidedBy?: string;
  decidedAt?: string;
  comment?: string;
  outcome?: RecertOutcome;
  context: { tier: number | null; flags: string[]; lastActive: string | null };
}

export interface BundleImportResult {
  rbac: { services: number; groups: number; roles: number; routeMaps: number; oathkeeperRules: number };
}

export interface BackupSnapshot { key: string; lastModified: string | null; size: number }
export interface BackupList {
  enabled: boolean;
  bucket: string | null;
  prefix: string;
  region: string;
  backups: BackupSnapshot[];
}
