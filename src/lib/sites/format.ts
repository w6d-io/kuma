import type { Access, Check } from './types';

/** Small wordings shared by the Sites screens. */

export type CheckLevel = 'ok' | 'warn' | 'error' | 'pending' | 'info';

const OFF = 'but organizations are off on this site. Turn them on (Access → Organizations)';

/** What an organizations_off check is about, from where it points. */
function offText(path = ''): string {
  if (path.startsWith('routes.')) return `A route is scoped to an organization, ${OFF}, or remove its organization parameter (Routes).`;
  if (path.startsWith('groups.orgGrantable')) return `This site has org roles, ${OFF}, or remove them (Access → Groups).`;
  if (path.startsWith('everyOrg')) return `Site roles reach into every organization, ${OFF}, or clear “In every organization”.`;
  if (path.startsWith('signUp')) return `Sign-up puts people in an organization, ${OFF}, or choose no organization for sign-up (Login).`;
  if (path.startsWith('orgs')) return `This site serves organizations, ${OFF}, or remove them.`;
  return `This uses organizations, ${OFF}.`;
}

/**
 * The words for the checks whose server message names schema fields rather than screens. Anything
 * else is said as jinbe words it.
 */
export function checkText(c: Check): string {
  switch (c.code) {
    case 'organizations_off': return offText(c.path);
    case 'unknown_owner_role': return 'Owners hold an org role this site does not have. Add it (Access → Groups → Org roles), or pick another (Access → Organizations).';
    case 'no_owner_role': return 'Owners hold nothing here yet: the owner role is not one of this site’s org roles. Add it (Access → Groups), or pick another (Access → Organizations).';
    case 'tokens_need_policy': {
      const gate = /gate '([^']+)'/.exec(c.message)?.[1];
      return `Gate ${gate ? `“${gate}” ` : ''}lets API keys in without checking permissions: any organization’s key would get in. Set “Who may pass?” to check permissions (Gates).`;
    }
    case 'every_org_own_group': {
      const role = c.path?.startsWith('everyOrg.') ? c.path.slice('everyOrg.'.length) : null;
      return `${role ? `Role ${role}` : 'A role'} reaches into every organization, and one of this site’s own groups carries it: its members would act in every organization. Clear it under “In every organization”, or take it off that group.`;
    }
    case 'upstream_path_unsupported': return 'This environment cannot add a base path yet: the service would get the wrong path. Clear “Then add base path” (Gates).';
    case 'unknown_org': return 'An organization this site serves no longer exists. Remove it (Access → Organizations).';
  }
  return c.message;
}

export const checkLines = (checks: readonly Check[]): Array<{ level: CheckLevel; text: string }> =>
  checks.map((c) => ({ level: c.level === 'error' ? 'error' : 'warn', text: checkText(c) }));

export function accessWord(a: Access): string {
  switch (a.kind) {
    case 'public': return 'Public';
    case 'signed-in': return 'Signed-in';
    case 'deny': return 'Refused';
    case 'permission': return a.permission;
  }
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
