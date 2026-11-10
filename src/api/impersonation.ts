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

/** A live site the person can open in a browser: through a role they hold, or as any signed-in person. */
export interface ReachableSite {
  name: string;
  title: string;
  url: string;
  access: 'role' | 'signed-in';
}

/**
 * What jinbe answered, kept to what can be shown and followed: a name and an http(s) address. An
 * address of any other scheme is dropped rather than rendered as a link.
 */
function reachable(raw: { sites?: unknown } | null | undefined): ReachableSite[] {
  const list = Array.isArray(raw?.sites) ? raw.sites : [];
  return list.flatMap((s: Partial<Record<keyof ReachableSite, unknown>> | null): ReachableSite[] => {
    if (!s || typeof s.name !== 'string' || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) return [];
    return [{
      name: s.name,
      title: typeof s.title === 'string' && s.title.trim() ? s.title : s.name,
      url: s.url,
      access: s.access === 'role' ? 'role' : 'signed-in',
    }];
  });
}

/** The durations offered, in minutes. */
export const IMPERSONATION_MINUTES = [15, 30] as const;

export const impersonationApi = {
  state: () => request<ImpersonationState>('/admin/impersonation'),

  /**
   * The live sites this person can open in a browser, the ones they hold a role on first. jinbe works
   * it out (roles, and the sites open to any signed-in person); a refusal or a failure means it is
   * not known — never that there is none.
   */
  reachableSites: (id: string) =>
    request<{ sites?: unknown }>(`/admin/users/${encodeURIComponent(id)}/reachable-sites`).then(reachable),

  // Starting while another is in force replaces it: jinbe ends the first one itself.
  start: (id: string, body: { reason: string; minutes?: number }) =>
    request<{ active: ActiveImpersonation }>(`/admin/users/${encodeURIComponent(id)}/impersonate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Always allowed, and ends whatever is in force — stopping must never be refused.
  stop: () => request<void>('/admin/impersonation', { method: 'DELETE' }),
};
