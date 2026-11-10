// Viewing the sites as somebody else, read-only and for a limited time (support). Kept beside
// client.ts rather than inside it — same `request`, same errors.
import { request } from './client';

export interface ImpersonationTarget {
  id: string;
  email: string;
  name: string;
}

/** The impersonation in force for the caller's session. `mode` is always read-only today. */
export interface ActiveImpersonation {
  target: ImpersonationTarget;
  reason: string;
  startedAt: string;
  expiresAt: string;
  mode: 'read';
}

export interface ImpersonationState {
  /** False: the feature is off in this environment, and nothing about it is shown. */
  enabled: boolean;
  /** Whether the caller holds users:impersonate. */
  allowed: boolean;
  active: ActiveImpersonation | null;
  /** The longest jinbe allows, in minutes (its IMPERSONATION_MAX_MINUTES); absent on a build that does not say. */
  maxMinutes?: number;
}

/** The durations offered, in minutes. */
export const IMPERSONATION_MINUTES = [15, 30] as const;

export const impersonationApi = {
  state: () => request<ImpersonationState>('/admin/impersonation'),

  // Starting while another is in force replaces it: jinbe ends the first one itself.
  start: (id: string, body: { reason: string; minutes?: number }) =>
    request<{ active: ActiveImpersonation }>(`/admin/users/${encodeURIComponent(id)}/impersonate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Always allowed, and ends whatever is in force — stopping must never be refused.
  stop: () => request<void>('/admin/impersonation', { method: 'DELETE' }),
};
