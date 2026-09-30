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

/**
 * An app signed in with a browser (OAuth consent): an MCP client — Claude Code, an editor — that
 * acts as its person until it is disconnected or its grant expires. Hydra keeps the consent; jinbe
 * lists it (GET /me/mcp/connections). `scope_mode: 'all'` follows whatever the person holds at each
 * call, `scopes` is then empty; `step_up_until`: until when it may do the protected actions (publish,
 * change an address, grant a group) on the second factor proven at sign-in, null when not allowed.
 */
export interface McpConnectionView {
  client_id: string;
  /** What the app called itself when it registered — not verified by anybody. */
  client_name: string | null;
  /** Where the sign-in sent its answer, e.g. `localhost:53682`. */
  redirect_host: string | null;
  granted_at: string | null;
  grant_expires_at?: string | null;
  scope_mode: 'all' | 'chosen';
  scopes: string[];
  step_up_actions?: boolean;
  step_up_until?: string | null;
  last_used_at?: string | null;
}

/** What POST /admin/users/:id/email answers: the change stands whether or not the link went out. */
export interface EmailChange {
  id: string;
  email: string;
  verified: boolean;
  verificationSent: boolean;
  /** `verification_link_unavailable` (Kratos verifies by code only) or `send_failed`. */
  verificationError?: string;
  oldAddressNotice?: { delivered: boolean; recorded: boolean; channel?: string };
}

export const accountsApi = {
  // Kratos merges `traits` over the stored ones (jinbe reads the identity first), so only the
  // changed fields are sent. Groups are pinned server-side and cannot change through this call, and
  // neither can the address (422 use_email_endpoint): that is changeEmail.
  updateProfile: (id: string, traits: { name?: string }) =>
    request<KratosIdentity>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ traits }),
    }),

  // The sign-in address: its own call (users:update_email, a second factor proven in the last 15
  // minutes). The new address starts unverified and is sent a link; the old one is owed a notice,
  // which jinbe records in the audit trail rather than mails.
  changeEmail: (id: string, email: string) =>
    request<EmailChange>(`/admin/users/${encodeURIComponent(id)}/email`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  // Kratos mails the verification link itself; nothing comes back but that it went.
  resendVerification: (id: string, address?: string) =>
    request<{ sent: boolean }>(`/admin/users/${encodeURIComponent(id)}/verification`, {
      method: 'POST',
      body: JSON.stringify(address ? { address } : {}),
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

  // Apps signed in with a browser. 404 on a jinbe without browser sign-in: the list is not shown.
  listMcpConnections: () => request<{ data: McpConnectionView[]; total?: number }>('/me/mcp/connections'),

  // Disconnecting ends the consent and every token issued under it; the app is refused from its next call.
  revokeMcpConnection: (clientId: string) =>
    request<void>(`/me/mcp/connections/${encodeURIComponent(clientId)}`, { method: 'DELETE' }),

  // Every app you signed in, at once (session only). A jinbe without that route (404) gets each one
  // disconnected on its own; that rejects when any failed, after trying them all, so a partial
  // failure is said rather than hidden.
  revokeAllMcpConnections: async (clientIds: string[]) => {
    try {
      await request<void>('/me/mcp/connections', { method: 'DELETE' });
      return;
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
    const out = await Promise.allSettled(clientIds.map((id) => request<void>(`/me/mcp/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })));
    const failed = out.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  },
};
