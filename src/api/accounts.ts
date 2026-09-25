// Account-level endpoints the console added after the directory screens: a person's profile and
// sessions, and an organisation's API keys. Kept beside client.ts rather than inside it — same
// `request`, same errors — so each file stays readable.
import { request, type KratosIdentity } from './client';
import type { KratosSession } from '../lib/sessions';

export interface ApiKeyView {
  client_id: string;
  organization_id: string;
  label: string;
  scopes: string[];
  created_by: string | null;
  created_at: string | null;
}

/** Answered once, on create. The secret cannot be read again. */
export interface ApiKeySecretView extends ApiKeyView {
  client_secret: string;
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

  createApiKey: (orgId: string, body: { label: string; scopes: string[] }) =>
    request<ApiKeySecretView>(`/organizations/${encodeURIComponent(orgId)}/api-keys`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  revokeApiKey: (orgId: string, clientId: string) =>
    request<void>(`/organizations/${encodeURIComponent(orgId)}/api-keys/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
    }),
};
