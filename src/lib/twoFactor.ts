/**
 * Every rule that asks for a second factor, as jinbe describes it (second-factor/requirements.ts), and
 * how the console says it: a badge on a group whose members must use it, on a permission that needs a
 * recent one, on a site with its own bar, on the person who has not enrolled, and in a refusal. jinbe
 * enforces; this only says so.
 */

/** A group's rule (groups[].secondFactor). */
export interface GroupSecondFactor {
  /** Members must sign in with a second factor on every permission-carrying route, and enrol before being added. */
  required: boolean;
  /**
   * `group_setting`: stored (a super admin's choice, or the default pinned at boot); `default`: not
   * stored yet, computed from the group's roles. (`setting` is what an earlier jinbe said.)
   */
  source?: 'group_setting' | 'default' | 'setting' | null;
  /** Nobody joins before enrolling a second factor. Equals `required` on a jinbe with the per-group switch. */
  enrolBeforeJoining?: boolean;
  /** What the default would be: on for a group that can change anything or holds `*`. */
  defaultRequired?: boolean;
}

/** The catalogue permission that changes a group's switch; only a super admin holds it in practice. */
export const GROUP_2FA_PERMISSION = 'groups.mfa:write';

/**
 * Whether the session may flip "Members must use 2FA": `groups.mfa:write` as jinbe expanded it on
 * /whoami, or `*`. Deliberately not the coarse admin:write fallback — no staff role holds it.
 */
export function mayChangeGroup2fa(session: { permissions?: readonly string[]; effective_permissions?: readonly string[] } | undefined): boolean {
  return !!session?.effective_permissions?.includes(GROUP_2FA_PERMISSION) || !!session?.permissions?.includes('*');
}

/** A catalogue permission's step-up (catalog permissions[].stepUpRule). */
export interface StepUpRule {
  required: boolean;
  maxAgeMin: number | null;
  viaPersonalKey?: { maxAgeDays: number } | null;
  fourEyes?: 'prod' | false;
}

/** A site's own bar (login.twoFactor, as sites list/detail `secondFactor`). */
export interface SiteSecondFactor {
  scope: 'none' | 'writes' | 'all' | 'routes';
  routes: string[];
  clients?: 'exempt' | 'refused' | null;
  minAal?: 'aal1' | 'aal2';
  summary?: string;
  /**
   * False when a gate serving its signed-in routes never asks the policy (Who may pass: Everyone),
   * so the bar is set but not enforced; null when jinbe could not tell; absent on older servers.
   */
  enforced?: boolean | null;
  /** The gate ids that skip the policy. */
  notEnforcedOn?: string[];
}

/** One person's picture (/me/permissions and a user's access `secondFactor`). */
export interface UserSecondFactor {
  required: boolean;
  requiredBecause: string[];
  enrolled: boolean | null;
  methods?: string[] | null;
  /** The caller's own session only; null when describing somebody else. */
  currentAal: string | null;
  factorAgeMin: number | null;
  stepUpFresh: boolean | null;
  stepUpPermissions: string[] | null;
}

/** What a 2FA refusal carries beside its `error` (secondFactorRefusal). */
export interface SecondFactorRefusal {
  rule: 'group_sign_in' | 'step_up' | 'enrol_before_joining' | 'site_login' | 'personal_key' | 'oauth_grant';
  requiredAal?: string;
  maxAgeMin?: number;
  requiredBecause?: string[];
  groups?: string[];
  keyReason?: string;
}

export const STEP_UP_MINUTES = 15;

export const GROUP_REQUIRED_TITLE = 'Members must use two-step sign-in: they enrol a second factor before being added, and sign in with it on every app.';
export const NEEDS_ENROL_TITLE = 'This person has not enrolled a second factor, so they cannot be added to a group that requires one.';

export function stepUpTitle(rule?: Pick<StepUpRule, 'maxAgeMin' | 'viaPersonalKey' | 'fourEyes'> | null): string {
  const min = rule?.maxAgeMin ?? STEP_UP_MINUTES;
  const key = rule?.viaPersonalKey ? ` A personal key created after a second factor stands in for ${rule.viaPersonalKey.maxAgeDays} days.` : '';
  const eyes = rule?.fourEyes === 'prod' ? ' In production a second person approves.' : '';
  return `Needs a second factor proven in the last ${min} minutes.${key}${eyes}`;
}

/** The site's bar in two or three words for a badge; null when it asks for nothing. */
export function siteScopeLabel(sf: SiteSecondFactor | null | undefined): string | null {
  if (!sf) return null;
  const n = sf.routes?.length ?? 0;
  switch (sf.scope) {
    case 'all': return '2FA on every request';
    case 'writes': return n ? `2FA for changes + ${n} route${n === 1 ? '' : 's'}` : '2FA for changes';
    case 'routes': return n ? `2FA on ${n} route${n === 1 ? '' : 's'}` : null;
    default: return null;
  }
}

/** "2FA set but NOT enforced (gate web never checks 2FA or permissions)", from jinbe's answer; null when enforced. */
export function siteNotEnforced(sf: SiteSecondFactor | null | undefined): string | null {
  if (!sf || sf.enforced !== false) return null;
  const ids = sf.notEnforcedOn ?? [];
  if (!ids.length) return '2FA set but NOT enforced (a gate never checks 2FA or permissions)';
  const more = ids.length > 1 ? ` and ${ids.length - 1} more gate${ids.length === 2 ? '' : 's'}` : '';
  return `2FA set but NOT enforced (gate ${ids[0]} never checks 2FA or permissions${more})`;
}

/** The site's bar in a sentence: jinbe's own when it sent one. */
export function siteScopeSentence(sf: SiteSecondFactor): string {
  if (sf.summary) return sf.summary;
  const label = siteScopeLabel(sf);
  return label ? `${label}.` : 'This site asks for no two-step sign-in.';
}

/** Whether adding `target` to a group is blocked by its second-factor rule (the target never enrolled). */
export function blockedForEnrolment(group: GroupSecondFactor | undefined, targetEnrolled: boolean | null | undefined): boolean {
  if (targetEnrolled !== false || !group) return false;
  return group.required || !!group.enrolBeforeJoining;
}

export type OwnTone = 'ok' | 'info' | 'warning' | 'danger';

/**
 * The signed-in person's own picture in lines: whether two-step sign-in is required for them and
 * because of which groups, whether they enrolled, their session's level, and whether a recent factor
 * is needed now for the permissions that ask for one.
 */
export function ownStatus(u: UserSecondFactor): { tone: OwnTone; title: string; lines: string[] } {
  const lines: string[] = [];
  if (u.required) lines.push(`Required for you as a member of ${u.requiredBecause.join(', ')}.`);
  else lines.push('None of your groups requires two-step sign-in.');
  if (u.enrolled === true) lines.push(`Enrolled${u.methods?.length ? `: ${u.methods.join(', ')}` : ''}.`);
  else if (u.enrolled === false) lines.push('You have not enrolled a second factor.');
  if (u.currentAal) {
    lines.push(u.currentAal === 'aal2'
      ? `This session used it${u.factorAgeMin != null ? ` ${u.factorAgeMin} min ago` : ''}.`
      : 'This session was opened without it.');
  }
  const n = u.stepUpPermissions?.length ?? 0;
  if (n > 0) {
    lines.push(u.stepUpFresh
      ? `Your ${n} protected permission${n === 1 ? '' : 's'} work now; after ${STEP_UP_MINUTES} minutes you confirm it again.`
      : `${n} of your permissions need it proven in the last ${STEP_UP_MINUTES} minutes: you are asked to confirm it when you use them.`);
  }
  if (u.required && u.enrolled === false) return { tone: 'danger', title: 'Two-step sign-in required — not set up', lines };
  if (u.required && u.currentAal && u.currentAal !== 'aal2') return { tone: 'warning', title: 'Two-step sign-in required — confirm it', lines };
  if (u.required) return { tone: 'ok', title: 'Two-step sign-in required — in place', lines };
  return { tone: u.enrolled ? 'ok' : 'info', title: u.enrolled ? 'Two-step sign-in set up' : 'Two-step sign-in optional for you', lines };
}

/** The second-factor rule a refusal names, when it names one. */
export function secondFactorRefusalOf(err: unknown): SecondFactorRefusal | null {
  const sf = (err as { details?: { secondFactor?: unknown } } | null)?.details?.secondFactor;
  if (!sf || typeof sf !== 'object' || typeof (sf as { rule?: unknown }).rule !== 'string') return null;
  return sf as SecondFactorRefusal;
}

/** A refusal's rule in a sentence, naming the groups or the permission; null when it names none. */
export function secondFactorRefusalSentence(err: unknown): string | null {
  const r = secondFactorRefusalOf(err);
  if (!r) return null;
  const permission = (err as { details?: { permission?: unknown } }).details?.permission;
  const what = typeof permission === 'string' && permission ? permission : 'This action';
  const groups = r.requiredBecause?.length ? r.requiredBecause : r.groups ?? [];
  switch (r.rule) {
    case 'group_sign_in':
      return `Your account must use two-step sign-in${groups.length ? ` as a member of ${groups.join(', ')}` : ''}. Sign in with your second factor, then retry.`;
    case 'site_login':
      return 'This site asks for two-step sign-in here. Sign in with your second factor, then retry.';
    case 'step_up':
      return `${what} needs a second factor proven in the last ${r.maxAgeMin ?? STEP_UP_MINUTES} minutes. Confirm it, then retry.`;
    case 'enrol_before_joining':
      return `The person must enrol a second factor before being added${groups.length ? ` to ${groups.join(', ')}` : ''}.`;
    case 'personal_key':
    case 'oauth_grant':
      return `${what} needs a recent second factor, which this key cannot stand in for. Do it in the console in a browser.`;
  }
  return null;
}
