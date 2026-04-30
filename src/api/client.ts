// API_BASE injected at container start via envsubst (see Dockerfile).
// Falls back to relative /api when Oathkeeper proxies /api on the same domain.
// Detect un-substituted envsubst placeholder (e.g. "${API_BASE}") and treat as empty.
const _rawBase: string = (window as any).__API_BASE__ ?? '';
const BASE = (_rawBase.startsWith('${') ? '' : _rawBase).replace(/\/$/, '') || '/api';

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status });
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Auth / Session ───
export const api = {
  session: () => request<WhoamiResponse>('/whoami'),

  // ─── Users (Kratos identities) ───
  getUsers: () => request<{ data: KratosIdentity[] }>('/admin/users').then(r => r.data),

  getUser: (id: string) => request<KratosIdentity>(`/admin/users/${id}`),

  getUserGroups: (email: string) =>
    request<{ email: string; groups: string[]; availableGroups: string[] }>(`/admin/users/${encodeURIComponent(email)}/groups`),

  setUserGroups: (email: string, groups: string[]) =>
    request<{ commitId: string }>(`/admin/users/${encodeURIComponent(email)}/groups`, {
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

  createService: (svc: { name: string; displayName?: string; upstreamUrl: string; matchUrl: string; matchMethods: string[]; stripPath?: string }) =>
    request<{ commitId: string }>(`/admin/rbac/services`, {
      method: 'POST',
      body: JSON.stringify(svc),
    }),

  updateService: (name: string, payload: { upstreamUrl?: string; matchUrl?: string; matchMethods?: string[]; stripPath?: string | null }) =>
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

  // ─── Matrix / Bindings ───
  getUsersMatrix: () =>
    request<{ users: JinbeUserMatrix[] }>(`/admin/rbac/users`).then(r => r.users),

  // ─── History (git commits) ───
  getHistory: () =>
    request<{ commits: JinbeCommit[] }>(`/admin/rbac/history`).then(r => r.commits),

  // ─── Audit stream ───
  getAuditEvents: (params?: { limit?: number; category?: string; since?: string }) => {
    const qs = new URLSearchParams()
    if (params?.limit)    qs.set('limit',    String(params.limit))
    if (params?.category) qs.set('category', params.category)
    if (params?.since)    qs.set('since',    params.since)
    const q = qs.toString()
    return request<{ events: AuditStreamEvent[]; total: number }>(`/admin/audit/events${q ? `?${q}` : ''}`)
  },

  // ─── Bundle export / import ───
  exportBundle: () =>
    fetch(`${BASE}/admin/rbac/bundle/export`, { credentials: 'include' }),

  importBundle: (bundle: unknown) =>
    request<{ success: boolean; imported: BundleImportResult }>('/admin/rbac/bundle/import', {
      method: 'POST',
      body: JSON.stringify(bundle),
    }),
};

// ─── Types matching jinbe API responses ───

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
    tenant_id?: string;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
}

export interface JinbeGroup {
  name: string;
  services: Record<string, string[]>;
}

export interface JinbeService {
  name: string;
  displayName?: string;
  rolesFilePath: string;
  routeMapFilePath: string;
  rolesCount: number;
  routesCount: number;
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

export interface JinbeAccessRule {
  id: string;
  upstream: { url: string; preserve_host?: boolean; strip_path?: string };
  match: { url: string; methods: string[] };
  authenticators: { handler: string; config?: unknown }[];
  authorizer: { handler: string; config?: unknown };
  mutators: { handler: string; config?: unknown }[];
}

export interface JinbeUserMatrix {
  email: string;
  name: string;
  groupMembership: Record<string, boolean>;
}

export interface JinbeCommit {
  id: string;
  message: string;
  authorEmail: string;
  timestamp: string;
  filesChanged: string[];
}

export interface BundleImportResult {
  rbac: { services: number; groups: number; roles: number; routeMaps: number; oathkeeperRules: number };
  identities: { created: number; updated: number; skipped: number };
}

export interface AuditStreamEvent {
  id:             string;
  ts:             string;
  when:           string;
  category:       string;
  verb:           string;
  target:         string;
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
}
