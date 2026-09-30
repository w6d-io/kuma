/**
 * Settings · AI assistants (MCP): the administrator's switch, the server address people are shown,
 * how long a personal key may live, and which groups may use it (jinbe /admin/settings/mcp).
 * jinbe validates again on save; this is so the form can say what is wrong before anyone presses Save.
 */
import type { McpSettings } from '../api/client';

/** The owner's ceiling for a personal key (jinbe refuses more, whatever is set). */
export const MCP_MAX_DAYS = 30;

export interface McpDraft {
  enabled: boolean;
  serverUrl: string;
  maxDays: number;
  scope: 'all' | 'selected';
  groups: string[];
  /** Allow sign-in with a browser; null when this jinbe has no such setting. */
  browserSignIn: boolean | null;
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
    ...(d.browserSignIn !== null ? { oauth: { ...d.oauth, enabled: d.browserSignIn } } : {}),
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
