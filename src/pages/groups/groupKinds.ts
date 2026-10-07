import type { GroupSecondFactor } from '../../lib/twoFactor';

/**
 * What kind of group a group is, as people need to understand it — each kind is changed differently:
 *
 *   staff     built in (groupsMeta.system: the staff-* groups and super_admins): roles fixed in code,
 *             never edited or deleted here; people are added from Users, as a protected action.
 *   site      gives roles on sites only (no platform app): whoever manages sites creates it and adds
 *             people (sites.members:write); a site's own groups are also managed from its Users tab.
 *   platform  gives a role on the platform itself (jinbe, the console, every org): only someone who
 *             already holds those rights can hand them out.
 *   empty     gives no role at all.
 *
 * jinbe draws the same line (sites/members.ts isSiteOnlyDefinition: every bound app is a published
 * site, none of KEYLESS_APPS); the console only reads the group, so an app that is not a live site any
 * more still counts as a site here.
 */
export type GroupKind = 'staff' | 'site' | 'platform' | 'empty';

/** The platform's own apps (jinbe KEYLESS_APPS): a role there is a platform role. */
export const PLATFORM_APPS: readonly string[] = ['jinbe', 'kuma', 'global'];

export type GroupDefinition = Record<string, string[] | undefined>;

/** The apps a group gives at least one role in, sorted. */
export function appsOf(def: GroupDefinition | undefined): string[] {
  return Object.keys(def ?? {}).filter((app) => (def?.[app]?.length ?? 0) > 0).sort();
}

export function kindOf(def: GroupDefinition | undefined, meta: { system?: boolean } | undefined): GroupKind {
  if (meta?.system) return 'staff';
  const apps = appsOf(def);
  if (apps.length === 0) return 'empty';
  return apps.some((app) => PLATFORM_APPS.includes(app)) ? 'platform' : 'site';
}

/**
 * The 2FA rule of a group, as one state:
 *   locked    staff group that requires it — cannot be turned off
 *   required  members sign in with a second factor (on by default, or turned on)
 *   optional  not asked by the group (the site's own setting, or the person's other groups, decide)
 *   unknown   jinbe did not say
 */
export type TwoFactorState = 'locked' | 'required' | 'optional' | 'unknown';

export function twoFactorStateOf(kind: GroupKind, sf: GroupSecondFactor | undefined): TwoFactorState {
  if (!sf) return 'unknown';
  const required = sf.required || !!sf.enrolBeforeJoining;
  if (!required) return 'optional';
  return kind === 'staff' ? 'locked' : 'required';
}

/** Whether the rule is the group's default or a super admin's choice, when jinbe says. */
export function twoFactorSourceOf(sf: GroupSecondFactor | undefined): 'default' | 'set' | null {
  if (!sf?.source) return null;
  if (sf.source === 'default') return 'default';
  // A stored value equal to the default (the default pinned at boot) still reads as the default.
  if (sf.defaultRequired !== undefined && sf.defaultRequired === sf.required) return 'default';
  return 'set';
}

/** The sentence behind the 2FA mark: what it means for members, and why it is so. */
export function twoFactorSentence(kind: GroupKind, state: TwoFactorState, source: 'default' | 'set' | null): string {
  switch (state) {
    case 'locked':
      return 'Members always sign in with a second factor. A built-in staff group whose role can change things: this cannot be turned off.';
    case 'required':
      return `Members sign in with a second factor, and anyone added before setting one up joins once they do. ${
        source === 'set' ? 'Turned on by a super admin.' : 'On by default: this group can change things.'}`;
    case 'optional':
      return kind === 'site'
        ? `The group does not ask for a second factor: the site's own two-step setting decides. ${source === 'set' ? 'Turned off by a super admin.' : 'Off by default for site access.'}`
        : `The group does not ask for a second factor. ${source === 'set' ? 'Turned off by a super admin.' : 'Off by default: this group only reads.'}`;
    case 'unknown':
      return 'This server does not say whether the group asks for a second factor.';
  }
}

export interface GroupRow {
  name: string;
  kind: GroupKind;
  apps: string[];
  def: GroupDefinition;
  description?: string;
  members: number;
  twoFactor: TwoFactorState;
  twoFactorSource: 'default' | 'set' | null;
}

/** Whether a row matches the search: its name, an app, a role or its description. */
export function matches(row: Pick<GroupRow, 'name' | 'apps' | 'def' | 'description'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.name.toLowerCase().includes(q) || (row.description ?? '').toLowerCase().includes(q)) return true;
  return row.apps.some((app) => app.toLowerCase().includes(q) || (row.def[app] ?? []).some((r) => r.toLowerCase().includes(q)));
}

/** Site rows grouped under the site they give access to; a group spanning several sites under `null`. */
export function bySite(rows: readonly GroupRow[]): Array<{ site: string | null; rows: GroupRow[] }> {
  const map = new Map<string | null, GroupRow[]>();
  for (const row of rows) {
    const key = row.apps.length === 1 ? row.apps[0] : null;
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([site, list]) => ({ site, rows: list.sort((x, y) => x.name.localeCompare(y.name)) }));
}
