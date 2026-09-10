// API_BASE injected at container start via envsubst (see Dockerfile).
// Falls back to relative /api when Oathkeeper proxies /api on the same domain.
// Detect un-substituted envsubst placeholder (e.g. "${API_BASE}") and treat as empty.
import type { AuditSummary, AccessReview } from './types';
import { bearerToken } from '../auth/session';

const _rawBase: string = (window as any).__API_BASE__ ?? '';
const BASE = (_rawBase.startsWith('${') ? '' : _rawBase).replace(/\/$/, '') || '/api';

/** Resolved API base — exported for EventSource (SSE), which can't use `request`. */
export const API_BASE = BASE;

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
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
    const body = await res.json().catch(() => ({}));
    // Surface the API's human-readable message ('Group X grants admin
    // privileges; the target user must enroll a second factor…') instead
    // of just the error code, so the toast in kuma actually explains
    // what went wrong.
    const msg = body.message || body.error || `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), {
      status: res.status,
      code: body.error,
      details: body,
    });
  }
  if (res.status === 204) return undefined as T;
  return res.json();
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

  getUserGroups: (email: string) =>
    request<{ email: string; groups: string[]; availableGroups: string[] }>(`/admin/users/${encodeURIComponent(email)}/groups`),

  setUserGroups: (email: string, groups: string[]) =>
    request<SetUserGroupsResponse>(`/admin/users/${encodeURIComponent(email)}/groups`, {
      method: 'PUT',
      body: JSON.stringify({ groups }),
    }),

  createUser: (payload: { email: string; name: string; groups?: string[]; sendInvite?: boolean }) =>
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
    request<{ commitId: string }>(`/admin/rbac/groups/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ services }),
    }),

  deleteGroup: (name: string) =>
    request<void>(`/admin/rbac/groups/${name}`, { method: 'DELETE' }),

  // ─── Services ───
  getServices: () =>
    request<{ services: JinbeService[] }>(`/admin/rbac/services`).then(r => r.services),

  createService: (svc: { name: string; displayName?: string; upstreamUrl: string; matchUrl: string; matchMethods: string[]; stripPath?: string; signIn?: SignInMethod[] }) =>
    request<{ commitId: string }>(`/admin/rbac/services`, {
      method: 'POST',
      body: JSON.stringify(svc),
    }),

  updateService: (name: string, payload: { upstreamUrl?: string; matchUrl?: string; matchMethods?: string[]; stripPath?: string | null; signIn?: SignInMethod[] }) =>
    request<{ commitId: string }>(`/admin/rbac/services/${name}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteService: (name: string) =>
    request<void>(`/admin/rbac/services/${name}`, { method: 'DELETE' }),

  getServicePermissions: (name: string) =>
    request<{ permissions: string[] }>(`/admin/rbac/services/${name}/permissions`),

  // ─── Roles (per service) ───
  getRoles: (serviceName: string) =>
    request<{ service: string; roles: JinbeRole[]; meta: { fileSha: string } }>(`/admin/rbac/services/${serviceName}/roles`),

  updateServiceRoles: (serviceName: string, roles: Record<string, string[]>) =>
    request<{ success: boolean; message: string }>(`/admin/rbac/services/${serviceName}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ roles }),
    }),

  // ─── Routes / Route map (per service) ───
  getServiceRoutes: (serviceName: string) =>
    request<{ service: string; rules: JinbeRouteRule[] }>(`/admin/rbac/services/${serviceName}/routes`),

  updateServiceRoutes: (serviceName: string, rules: JinbeRouteRule[]) =>
    request<{ commitId: string }>(`/admin/rbac/services/${serviceName}/routes`, {
      method: 'PUT',
      body: JSON.stringify({ rules }),
    }),

  // Dry-run: parse an OpenAPI/Swagger spec and preview the routes + diff.
  importPreviewRoutes: (serviceName: string, source: ImportSource, options?: ImportOptions) =>
    request<ImportPreview>(`/admin/rbac/services/${serviceName}/routes/import/preview`, {
      method: 'POST',
      body: JSON.stringify({ source, options }),
    }),

  /**
   * The groups the caller may hand out, and whether they may at all — from the model the engine
   * decides against, not from the previous one.
   */
  /**
   * Every organisation, for the screen that administers them.
   *
   * Not `/me/organizations`: that one answers with MINE, whoever asks. It used to widen to every
   * organisation for an administrator, so the same URL meant two things and a `scope` field existed
   * to say which — a screen asking for everything could not tell a short answer from a complete one.
   */
  allOrganizations: () =>
    request<{ organizations: { id: string; name: string; tenant: string }[] }>('/admin/organizations'),

  assignableGroups: () =>
    request<{ groups: string[]; mayAssign: boolean }>('/admin/assignable-groups'),

  /**
   * The model the engine decides against: what each group grants, per organisation, and what each
   * role carries. Read-only — it lives in Git and changes at a release.
   */
  authorizationModel: () =>
    request<AuthorizationModel>('/admin/authorization-model'),

  // ─── Enforced configuration (read-only) ───
  // What actually decides, read from the cluster objects the engines load. There is no writer and
  // there must not be one: the source of truth is a repository synced by Argo, so a write here
  // would be reverted by the next sync without telling anybody.
  getEnforcedConfig: () =>
    request<{ documents: EnforcedDocument[] }>(`/admin/enforced-config`).then(r => r.documents),

  // ─── Access Rules (Oathkeeper) ───
  getAccessRules: () =>
    request<{ rules: JinbeAccessRule[] }>(`/admin/rbac/access-rules`).then(r => r.rules),

  createAccessRule: (rule: Partial<JinbeAccessRule>) =>
    request<{ commitId: string }>(`/admin/rbac/access-rules`, {
      method: 'POST',
      body: JSON.stringify(rule),
    }),

  updateAccessRule: (id: string, rule: Partial<JinbeAccessRule>) =>
    request<{ commitId: string }>(`/admin/rbac/access-rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(rule),
    }),

  deleteAccessRule: (id: string) =>
    request<void>(`/admin/rbac/access-rules/${id}`, { method: 'DELETE' }),

  // ─── Oathkeeper handler catalog (enabled handlers + field descriptors) ───
  // Returns ONLY the handlers actually registered/enabled in the Oathkeeper
  // config (single source of truth), each with a static field descriptor that
  // drives the guided config form in the Gateway tab. Fail-closed: the UI must
  // only ever offer handlers this endpoint returns.
  getOathkeeperHandlers: () =>
    request<OathkeeperHandlerCatalog>(`/admin/rbac/oathkeeper/handlers`),

  // ─── History (git commits) ───
  getHistory: () =>
    request<{ commits: JinbeCommit[] }>(`/admin/rbac/history`).then(r => r.commits),

  // ─── Audit stream ───
  // Additive, backward-compatible filters (contract A6). `risk: 'high'` is a
  // SERVER-authoritative gate over emit-time severity ([P2-3]) — it spans the
  // whole retained history, not the 200-row window the client sees.
  getAuditEvents: (params?: AuditEventFilters) => {
    const qs = new URLSearchParams()
    if (params?.limit)    qs.set('limit',    String(params.limit))
    if (params?.category) qs.set('category', params.category)
    if (params?.since)    qs.set('since',    params.since)
    if (params?.actor)    qs.set('actor',    params.actor)
    if (params?.service)  qs.set('service',  params.service)
    if (params?.target)   qs.set('target',   params.target)
    if (params?.result)   qs.set('result',   params.result)
    if (params?.verb)     qs.set('verb',     params.verb)
    if (params?.kind)     qs.set('kind',     params.kind)
    if (params?.from)     qs.set('from',     params.from)
    if (params?.to)       qs.set('to',       params.to)
    if (params?.q)        qs.set('q',        params.q)
    if (params?.cursor)   qs.set('cursor',   params.cursor)
    if (params?.risk)     qs.set('risk',     params.risk)
    const q = qs.toString()
    return request<{ events: AuditStreamEvent[]; total: number; nextCursor?: string }>(`/admin/audit/events${q ? `?${q}` : ''}`)
  },

  // Windowed, server-derived stats (contract A6, scanned from the shared stream,
  // NOT per-replica Prometheus). `window` e.g. "24h" | "7d".
  getAuditSummary: (window?: string) => {
    const qs = window ? `?window=${encodeURIComponent(window)}` : ''
    return request<AuditSummary>(`/admin/audit/summary${qs}`)
  },

  // Server-side streamed export of a filtered range (also self-audits the export).
  // Falls back-compatibly to the client-side CSV in Audit.tsx if this 404s.
  exportAudit: async (params?: AuditEventFilters & { format?: 'csv' | 'ndjson' }): Promise<void> => {
    const qs = new URLSearchParams()
    const p = params || {}
    for (const k of ['category','since','actor','service','target','result','verb','kind','from','to','q','risk','format'] as const) {
      const v = (p as Record<string, unknown>)[k]
      if (v) qs.set(k, String(v))
    }
    const q = qs.toString()
    const res = await fetch(`${BASE}/admin/audit/export${q ? `?${q}` : ''}`, { credentials: 'include' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw Object.assign(new Error(body.message || `HTTP ${res.status}`), { status: res.status })
    }
    const blob = await res.blob()
    const ext = (p.format || 'csv')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  },

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

  getRecertInbox: () =>
    request<{ items: RecertInboxItem[] }>('/admin/recert/inbox').then(r => r.items),

  // Frozen completion report — downloaded as a JSON file (audit evidence).
  downloadRecertReport: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/admin/recert/campaigns/${encodeURIComponent(id)}/report`, { credentials: 'include' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.message || `HTTP ${res.status}`), { status: res.status });
    }
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
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.message || `HTTP ${res.status}`), { status: res.status });
    }
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

  // ─── Org → Service bundle map (J14 org-service entitlement) ───
  // Array-valued: each org bundles a SET of services. GET returns the whole
  // map; PUT replaces one org's entire bundle (jinbe enforces >=1 service);
  // DELETE clears an org's bundle entirely.
  getOrgServiceMap: () =>
    request<{ mappings: Record<string, string[]> }>('/admin/rbac/org-service-map').then(r => r.mappings),

  setOrgServiceBundle: (organizationId: string, services: string[]) =>
    request<{ success: boolean; message: string }>('/admin/rbac/org-service-map', {
      method: 'PUT',
      body: JSON.stringify({ organizationId, services }),
    }),

  deleteOrgServiceMapping: (organizationId: string) =>
    request<{ success: boolean; message: string }>(`/admin/rbac/org-service-map/${encodeURIComponent(organizationId)}`, {
      method: 'DELETE',
    }),

  // ─── Org → Admin roster (per-org admin list) ───
  // Symmetric with the org→service map: each org has an admin roster (emails).
  // GET returns the whole map; PUT replaces one org's entire roster (empty list
  // clears it). super_admin + a recent second factor (15-min step-up) required.
  getOrgAdminMap: () =>
    request<{ mappings: Record<string, string[]> }>('/admin/rbac/org-admin-map').then(r => r.mappings),

  setOrgAdmins: (organizationId: string, admins: string[]) =>
    request<{ success: boolean; message: string }>('/admin/rbac/org-admin-map', {
      method: 'PUT',
      body: JSON.stringify({ organizationId, admins }),
    }),

  // ─── Kratos auth-method toggles (hot-reload; kratos.yml via jinbe) ───
  // GET: state per method. PUT: partial patch — only the methods present in
  // the body are touched. webauthn/passkey/oidc can only be enabled once
  // their config block exists in kratos.yml (jinbe rejects otherwise).
  getAuthMethods: () =>
    request<AuthConfigState>('/admin/auth/methods'),

  setAuthMethods: (patch: AuthConfigPatch) =>
    request<AuthConfigState>('/admin/auth/methods', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  // ─── Impact preview — who gains/loses access if this change is applied ───


  // ─── Delegated org-admin (self-service; scoped to the caller's orgs) ───
  // The organizations the caller may administer (delegation manageable_orgs).
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

  // Groups the caller may assign within an org — already narrowed by jinbe to the
  // org's service + containment (never the full catalog).
  getAssignableGroups: (orgId: string) =>
    request<{ groups: string[] }>(`/organizations/${orgId}/assignable-groups`).then(r => r.groups),

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
    payload: { email: string; name?: string; sendInvite?: boolean; groups?: string[] },
  ) =>
    request<KratosIdentity>(`/organizations/${orgId}/users`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  setOrgUserGroups: (orgId: string, userId: string, groups: string[]) =>
    request<OrgUserGroupsResponse>(`/organizations/${orgId}/users/${userId}/groups`, {
      method: 'PUT',
      body: JSON.stringify({ groups }),
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
  counts: { services: number; groups: number; roles: number; routeMaps: number; oathkeeperRules: number; orgServiceMap: number };
}

// Gateway sign-in methods per service — ordered fallback cookie → bearer →
// introspection; [] = public. Maps to the service rule's Oathkeeper
// authenticator chain in jinbe.
export type SignInMethod = 'cookie' | 'bearer' | 'introspection';

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
  permissions: string[];  /**
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

export interface OrgUserGroupsResponse {
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
  created_at: string;
  updated_at: string;
}

export interface JinbeGroup {
  name: string;
  services: Record<string, string[]>;
  /** True when this group is bootstrap-protected (cannot be deleted, may need super_admin to mutate). */
  system?: boolean;
  description?: string;
}

export interface JinbeService {
  name: string;
  displayName?: string;
  rolesFilePath: string;
  routeMapFilePath: string;
  rolesCount: number;
  routesCount: number;
  /** True when this service is bootstrap-protected. */
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

// ─── OpenAPI import (preview) ───
export interface ImportSource { url?: string; content?: string; format?: 'json' | 'yaml' | 'auto'; }
export interface ImportOptions {
  resourceFrom?: 'tag' | 'path' | 'operationId';
  verbMap?: Record<string, string>;
  listAsRead?: boolean;
  honorExtension?: boolean;
  basePath?: 'prepend' | 'strip' | 'none';
}
export interface DerivedRoute {
  method: string; path: string; permission?: string; public: boolean;
  source: 'public-extension' | 'extension' | 'scope' | 'tag' | 'path' | 'operationId' | 'unmapped';
  operationId?: string; summary?: string;
}
export interface ChangedRoute { method: string; path: string; from: (string | null)[]; to: DerivedRoute; }
export interface StaleRoute { method: string; path: string; permission?: string; isCatchall: boolean; }
export interface ImportPreview {
  service: string; detectedBasePath: string; basePathMode: string; operationCount: number;
  derived: DerivedRoute[];
  diff: { add: DerivedRoute[]; changed: ChangedRoute[]; unchanged: DerivedRoute[]; stale: StaleRoute[]; };
  warnings: { kind: string; message: string; detail?: string }[];
}

/** One object that decides something, as the service that reads the cluster answers it. */
export interface EnforcedDocument {
  /** The Kubernetes kind — `Rule` for the edge, `ConfigMap` for the policy data. */
  kind: string;
  name: string;
  namespace: string;
  /** What it decides, in the reader's terms rather than the cluster's. */
  decides: string;
  /** The object as YAML, pruned of what the API server adds. */
  yaml: string;
  /** The route table as rows, when this document holds one. Parsed by the service, not here. */
  routes?: EnforcedRoute[];
  /** What each role carries, when this document holds that instead. */
  roles?: EnforcedRole[];
  /** Who holds which role, and in which organisation. */
  grants?: EnforcedGrant[];
}

export interface EnforcedRoute {
  method: string;
  path: string;
  /** `public` | `authenticated` | `authorized` — what the edge requires before forwarding. */
  class: string;
  /** Only for `authorized`: the permission the caller must hold. */
  permission?: string;
}

export interface EnforcedRole {
  role: string;
  permissions: string[];
}

/** Who holds which role, and where — the last link of the chain a reader follows. */
export interface EnforcedGrant {
  /** The immutable identity the grant is keyed on. */
  subject: string;
  /** The address that identity carries today. Absent when the directory could not name it. */
  email?: string;
  held: {
    organisation: string;
    organisationName?: string;
    roles: string[];
    /**
     * The group the roles came through — the hop that explains the rest.
     *
     * Optional because a deployment answering the previous shape omits it, and a screen must degrade
     * to "who holds what" rather than break on the missing "why".
     */
    viaGroups?: string[];
  }[];
}

export interface JinbeAccessRule {
  id: string;
  upstream: { url: string; preserve_host?: boolean; strip_path?: string };
  match: { url: string; methods: string[] };
  authenticators: { handler: string; config?: unknown }[];
  authorizer: { handler: string; config?: unknown };
  mutators: { handler: string; config?: unknown }[];
  /**
   * Error handlers (what a request sees when authn/authz fails — e.g. redirect
   * to login vs a JSON 401). Optional for back-compat: rules created before the
   * feature have no `errors` and stay valid.
   */
  errors?: { handler: string; config?: unknown }[];
}

// ─── Oathkeeper handler catalog ───
// A single field descriptor drives one guided input in the per-stage editor.
// `type` selects the control; the values are otherwise data-driven (the client
// renders whatever fields the endpoint returns — no hardcoded field lists).
export interface FieldDescriptor {
  key: string;
  label: string;
  type: 'string' | 'url' | 'bool' | 'textarea' | 'kv' | 'list' | 'json';
  required?: boolean;
  placeholder?: string;
  help?: string;
}

// One enabled Oathkeeper handler + its config shape. `hasFreeformConfig` means
// the handler accepts arbitrary extra config beyond `fields` (surfaced via the
// raw-JSON escape hatch).
export interface HandlerDescriptor {
  handler: string;
  label: string;
  description: string;
  hasFreeformConfig: boolean;
  fields: FieldDescriptor[];
}

// The enabled handlers, grouped by Oathkeeper stage. Each list contains ONLY
// handlers registered in the gateway config (fail-closed source of truth).
export interface OathkeeperHandlerCatalog {
  authenticators: HandlerDescriptor[];
  authorizers: HandlerDescriptor[];
  mutators: HandlerDescriptor[];
  errorHandlers: HandlerDescriptor[];
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

export interface RecertInboxItem extends RecertItem {
  campaignName: string;
  deadline: string;
}

export interface JinbeCommit {
  id: string;
  message: string;
  authorEmail: string;
  timestamp: string;
  filesChanged: string[];
}

export interface SimulateMatchedRule {
  method: string;
  path: string;
  permission?: string;
}

export interface SimulateResponse {
  allowed: boolean;
  superAdmin?: boolean;
  matchedRule?: SimulateMatchedRule;
  requiredPermission?: string;
  userInfo: {
    email: string;
    groups: string[];
    roles: string[];
    permissions: string[];
  };
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

// Filters accepted by GET /admin/audit/events (all additive/optional).
export interface AuditEventFilters {
  limit?: number;
  category?: string;
  since?: string;
  actor?: string;
  service?: string;
  target?: string;
  result?: string;
  verb?: string;
  kind?: string;
  from?: string;
  to?: string;
  q?: string;
  cursor?: string;
  /** 'high' → only emit-time high-severity events (server-authoritative). */
  risk?: string;
}

export interface AuditStreamEvent {
  id:             string;
  ts:             string;
  when:           string;
  kind?:          string;
  sessionId?:     string;
  category:       string;
  verb:           string;
  target:         string;
  targetId?:      string;
  targetEmail?:   string;
  result:         string;
  who:            string;
  actorName?:     string;
  ip?:            string;
  ua?:            string;
  service?:       string;
  reason?:        string;
  method?:        string;
  path?:          string;
  statusCode?:    number;
  responseTimeMs?: number;
  mfa?:           boolean;
  severity?:      string;
  changes?:       import('./types').AuditChanges;
}


/** A group grants roles per organisation; `*` means every organisation the caller is in. */
export type AuthorizationModel = {
  groups: Record<string, Record<string, string[]>>;
  roles: Record<string, string[]>;
};
