/**
 * Settings · AI assistants (MCP): the administrator's switch, the server address people are shown,
 * how long a personal key may live, and which organizations may use it (jinbe /admin/settings/mcp).
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
  orgs: string[];
}

export function toMcpDraft(s: McpSettings): McpDraft {
  return {
    enabled: s.enabled,
    serverUrl: s.serverUrl ?? '',
    maxDays: s.personalKeys.maxDays,
    scope: s.allowedOrgs === 'all' ? 'all' : 'selected',
    orgs: s.allowedOrgs === 'all' ? [] : [...s.allowedOrgs],
  };
}

export function fromMcpDraft(d: McpDraft): McpSettings {
  const url = d.serverUrl.trim();
  return {
    enabled: d.enabled,
    serverUrl: url || null,
    personalKeys: { maxDays: d.maxDays },
    allowedOrgs: d.scope === 'all' ? 'all' : [...new Set(d.orgs)].sort(),
  };
}

export interface McpDraftProblems {
  serverUrl?: string;
  orgs?: string;
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
  if (d.scope === 'selected' && !d.orgs.length) out.orgs = 'Pick at least one organization, or choose all of them.';
  return out;
}

/** Same settings, whatever the order of the org list. */
export function sameMcp(a: McpSettings, b: McpSettings): boolean {
  const norm = (s: McpSettings) => JSON.stringify({ ...s, allowedOrgs: s.allowedOrgs === 'all' ? 'all' : [...s.allowedOrgs].sort() });
  return norm(a) === norm(b);
}

/** Expiry choices for a new personal key under the administrator's maximum: 1, 7, 30 days that fit, and the maximum itself. */
export function personalExpiryChoices(maxDays: number, base: readonly number[] = [1, 7, 30]): number[] {
  return [...new Set([...base.filter((d) => d <= maxDays), maxDays])].sort((a, b) => a - b);
}
