// Getting somebody back in: a one-click sign-in link, and removing the two-step sign-in they lost.
// Kept beside client.ts rather than inside it — same `request`, same errors.
import { request } from './client';

/** The second factors jinbe lists. A passkey is a first factor and never one of them. */
export type SecondFactorMethod = 'totp' | 'webauthn' | 'lookup_secret';

export interface SecondFactors {
  methods: SecondFactorMethod[];
  /** Whether their role requires two-step sign-in; null when the policy could not say. */
  required: boolean | null;
}

export interface SecondFactorReset {
  removed: SecondFactorMethod[];
  sessionsRevoked: boolean;
}

export const recoveryApi = {
  // Kratos mails the link itself; jinbe never sees it, so nothing comes back but when it expires.
  sendLoginLink: (id: string, returnTo?: string) =>
    request<{ sent: boolean; expiresAt: string | null }>(`/admin/users/${encodeURIComponent(id)}/login-link`, {
      method: 'POST',
      body: JSON.stringify(returnTo ? { return_to: returnTo } : {}),
    }),

  secondFactors: (id: string) =>
    request<SecondFactors>(`/admin/users/${encodeURIComponent(id)}/second-factors`),

  resetSecondFactors: (id: string, body: { reason: string; revokeSessions: boolean }) =>
    request<SecondFactorReset>(`/admin/users/${encodeURIComponent(id)}/second-factors/reset`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
