// Account-level endpoints the console added after the directory screens: a person's profile and
// sessions, and an organisation's API keys. Kept beside client.ts rather than inside it — same
// `request`, same errors — so each file stays readable.
import { request, type KratosIdentity } from './client';
import type { KratosSession } from '../lib/sessions';
import { normalizeCatalog, normalizePlatformScopes, type PlatformScope, type ScopeEntry } from '../lib/apiKeys';

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

/**
 * A person's own key (MCP): not bound to any organization — it acts as them with their platform
 * permissions, all of them (`all_permissions`) or the ones chosen at creation, re-checked on every
 * call. 30 days at most. `organization_id` is null; a key made before this may still carry one, which
 * means nothing any more.
 */
export interface PersonalKeyView extends Omit<ApiKeyView, 'organization_id'> {
  kind: 'personal';
  organization_id?: string | null;
  /** True: the key follows whatever its holder holds; `scopes` is then empty. Absent on an older jinbe. */
  all_permissions?: boolean;
}

/** Answered once: the secret, and the key as an MCP client sends it (`stk_mcp_<client_id>.<secret>`). */
export interface PersonalKeySecretView extends PersonalKeyView {
  client_secret: string;
  key: string;
}

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

  revokeApiKey: (orgId: string, clientId: string) =>
    request<void>(`/organizations/${encodeURIComponent(orgId)}/api-keys/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
    }),

  // Personal keys answer 404 on a jinbe without DELEGATED_TOKENS_ENABLED: the feature is off there,
  // which the screens say calmly rather than as a failure.
  listMyApiKeys: () => request<{ data: PersonalKeyView[]; total: number }>('/me/api-keys'),

  // The permissions a personal key may be narrowed to: what the caller holds on the platform, each
  // with the resource it belongs to.
  myApiKeyScopes: (): Promise<PlatformScope[]> =>
    request<{ scopes: unknown }>('/me/api-keys/scopes').then(r => normalizePlatformScopes(r.scopes)),

  // No `scopes`: the key carries all of the holder's permissions, as they are at each call.
  createMyApiKey: (body: { label: string; scopes?: string[]; expires_in_days: number; allow_step_up_actions?: boolean }) =>
    request<PersonalKeySecretView>('/me/api-keys', { method: 'POST', body: JSON.stringify(body) }),

  revokeMyApiKey: (clientId: string) =>
    request<void>(`/me/api-keys/${encodeURIComponent(clientId)}`, { method: 'DELETE' }),
};
