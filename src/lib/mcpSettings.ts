/**
 * Settings · AI assistants (MCP): the administrator's switch, the server address people are shown,
 * how long a personal key may live, and which groups may use it (jinbe /admin/settings/mcp).
 * jinbe validates again on save; this is so the form can say what is wrong before anyone presses Save.
 */
import type { McpSettings } from '../api/client';

/** The owner's ceiling for a personal key (jinbe refuses more, whatever is set). */
export const MCP_MAX_DAYS = 30;

/** jinbe's defaults for browser sign-in (mcp/settings.ts): 30 days, protected actions for 12 hours. */
export const OAUTH_DEFAULTS = { maxDays: 30, protectedActionsHours: 12 } as const;
/** Choices for how long protected actions stay allowed after signing in; 0 = never. jinbe accepts 1–720 hours. */
export const PROTECTED_HOUR_CHOICES = [0, 1, 4, 12, 24, 72, 168, 720];

export interface McpDraft {
  enabled: boolean;
  serverUrl: string;
  maxDays: number;
  scope: 'all' | 'selected';
  groups: string[];
  /** Allow sign-in with a browser; null when this jinbe has no such setting. */
  browserSignIn: boolean | null;
  /** How long one browser sign-in lives, in days. */
  oauthMaxDays: number;
  /** Hours protected actions stay allowed after signing in; 0 = never. */
  protectedHours: number;
  /** The stored `oauth` block, so fields the form does not edit go back unchanged. */
  oauth?: McpSettings['oauth'];
}

export function toMcpDraft(s: McpSettings): McpDraft {
  return {
    enabled: s.enabled,
    serverUrl: s.serverUrl ?? '',
    maxDays: s.personalKeys.maxDays,
    scope: s.allowedGroups === 'all' ? 'all' : 'selected',
    groups: s.allowedGroups === 'all' ? [] : [...s.allowedGroups],
    browserSignIn: s.oauth ? s.oauth.enabled ?? s.enabled : null,
    oauthMaxDays: s.oauth?.maxDays ?? OAUTH_DEFAULTS.maxDays,
    protectedHours: s.oauth?.protectedActions === 'off' ? 0 : s.oauth?.protectedActionsHours ?? OAUTH_DEFAULTS.protectedActionsHours,
    ...(s.oauth ? { oauth: s.oauth } : {}),
  };
}

export function fromMcpDraft(d: McpDraft): McpSettings {
  const url = d.serverUrl.trim();
  return {
    enabled: d.enabled,
    serverUrl: url || null,
    personalKeys: { maxDays: d.maxDays },
    allowedGroups: d.scope === 'all' ? 'all' : [...new Set(d.groups)].sort(),
    // Never sent to a jinbe that has no such setting: its schema is strict.
    ...(d.browserSignIn !== null ? {
      oauth: {
        ...d.oauth,
        enabled: d.browserSignIn,
        maxDays: d.oauthMaxDays,
        protectedActions: d.protectedHours > 0 ? 'window' as const : 'off' as const,
        // Off keeps the stored hours, so turning it back on finds them.
        protectedActionsHours: d.protectedHours > 0 ? d.protectedHours : d.oauth?.protectedActionsHours ?? OAUTH_DEFAULTS.protectedActionsHours,
      },
    } : {}),
  };
}

export interface McpDraftProblems {
  serverUrl?: string;
  groups?: string;
}

/** What stops Save, per field. */
export function mcpDraftProblems(d: McpDraft): McpDraftProblems {
  const out: McpDraftProblems = {};
  const url = d.serverUrl.trim();
  if (url) {
    let ok = false;
    try {
      const u = new URL(url);
      ok = u.protocol === 'https:' && !u.username && !u.password && !u.hash;
    } catch { /* not a URL */ }
    if (!ok) out.serverUrl = 'An https:// address, without a user name or password in it.';
  }
  if (d.scope === 'selected' && !d.groups.length) out.groups = 'Pick at least one group, or choose all of them.';
  return out;
}

/** Same settings, whatever the order of the group list. */
export function sameMcp(a: McpSettings, b: McpSettings): boolean {
  const norm = (s: McpSettings) => JSON.stringify({ ...s, allowedGroups: s.allowedGroups === 'all' ? 'all' : [...s.allowedGroups].sort() });
  return norm(a) === norm(b);
}

/** Expiry choices for a new personal key under the administrator's maximum: 1, 7, 30 days that fit, and the maximum itself. */
export function personalExpiryChoices(maxDays: number, base: readonly number[] = [1, 7, 30]): number[] {
  return [...new Set([...base.filter((d) => d <= maxDays), maxDays])].sort((a, b) => a - b);
}
