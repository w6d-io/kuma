// Account-level endpoints the console added after the directory screens: a person's profile and
// sessions, and an organisation's API keys. Kept beside client.ts rather than inside it — same
// `request`, same errors — so each file stays readable.
import { request, type KratosIdentity } from './client';
import type { KratosSession } from '../lib/sessions';
import { normalizeCatalog, type ScopeEntry } from '../lib/apiKeys';

export interface ApiKeyView {
  client_id: string;
  organization_id: string;
  label: string;
  scopes: string[];
  created_by: string | null;
  created_at: string | null;
  /** RFC 3339, or null for a key that never expires. Absent on a jinbe that predates expiry. */
  expires_at?: string | null;
  /** When a program last used the key. Not served by jinbe yet; shown once it is. */
  last_used_at?: string | null;
}

/** Answered once, on create. The secret cannot be read again. */
export interface ApiKeySecretView extends ApiKeyView {
  client_secret: string;
}

/** A person's own key (MCP): acts as them in one organization, 30 days at most. */
export interface PersonalKeyView extends ApiKeyView {
  kind: 'personal';
}

/** Answered once: the secret, and the key as an MCP client sends it (`stk_mcp_<client_id>.<secret>`). */
export interface PersonalKeySecretView extends PersonalKeyView {
  client_secret: string;
  key: string;
}

/** Whether members may create personal keys acting in an organization. */
export interface ApiKeyPolicy {
  personal_keys: 'allowed' | 'forbidden';
}

const org = (id: string) => `/organizations/${encodeURIComponent(id)}`;

export const accountsApi = {
  // Kratos merges `traits` over the stored ones (jinbe reads the identity first), so only the
  // changed fields are sent. Groups are pinned server-side and cannot change through this call.
  updateProfile: (id: string, traits: { name?: string; email?: string }) =>
    request<KratosIdentity>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ traits }),
    }),

  listSessions: (id: string) =>
    request<KratosSession[]>(`/admin/users/${encodeURIComponent(id)}/sessions`),

  revokeSession: (sessionId: string) =>
    request<void>(`/admin/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),

  revokeAllSessions: (id: string) =>
    request<void>(`/admin/users/${encodeURIComponent(id)}/sessions`, { method: 'DELETE' }),

  listApiKeys: (orgId: string) =>
    request<{ data: ApiKeyView[]; total: number }>(`/organizations/${encodeURIComponent(orgId)}/api-keys`),

  createApiKey: (orgId: string, body: { label: string; scopes: string[]; expires_in_days?: number }) =>
    request<ApiKeySecretView>(`/organizations/${encodeURIComponent(orgId)}/api-keys`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // The scopes a key may be given: the permissions of this org's sites that the caller holds there,
  // each with the sites that ask for it. An older jinbe answers bare strings (normalized, no sites);
  // one older still answers 404.
  apiKeyScopes: (orgId: string): Promise<ScopeEntry[]> =>
    request<{ scopes: unknown }>(`/organizations/${encodeURIComponent(orgId)}/api-keys/scopes`).then(r => normalizeCatalog(r.scopes)),

  // What a personal key may carry: the caller's own permissions in that org, site routes and jinbe's
  // platform permissions ("platform" group). Distinct from the org machine-key catalog above.
  myApiKeyScopes: (orgId: string): Promise<ScopeEntry[]> =>
    request<{ scopes: unknown }>(`/me/api-keys/scopes?organization_id=${encodeURIComponent(orgId)}`).then(r => normalizeCatalog(r.scopes)),

  revokeApiKey: (orgId: string, clientId: string) =>
    request<void>(`/organizations/${encodeURIComponent(orgId)}/api-keys/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
    }),

  // Personal keys and the org policy answer 404 on a jinbe without DELEGATED_TOKENS_ENABLED: the
  // feature is off there, which the screens say calmly rather than as a failure.
  apiKeyPolicy: (orgId: string) => request<ApiKeyPolicy>(`${org(orgId)}/api-key-policy`),

  setApiKeyPolicy: (orgId: string, body: ApiKeyPolicy) =>
    request<ApiKeyPolicy>(`${org(orgId)}/api-key-policy`, { method: 'PUT', body: JSON.stringify(body) }),

  listMyApiKeys: () => request<{ data: PersonalKeyView[]; total: number }>('/me/api-keys'),

  createMyApiKey: (body: { label: string; organization_id: string; scopes: string[]; expires_in_days: number }) =>
    request<PersonalKeySecretView>('/me/api-keys', { method: 'POST', body: JSON.stringify(body) }),

  revokeMyApiKey: (clientId: string) =>
    request<void>(`/me/api-keys/${encodeURIComponent(clientId)}`, { method: 'DELETE' }),
};
