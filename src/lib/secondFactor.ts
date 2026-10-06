/**
 * Settings · Two-step sign-in: which groups must use a second factor (jinbe
 * /admin/settings/second-factor, published to OPA as data.second_factor).
 */

/** The authentication-method switches the warning reads (Settings → Authentication methods). */
export interface SecondFactorMethodsState {
  totp?: { enabled: boolean };
  webauthn?: { enabled: boolean };
}

export type SecondFactorWarning = 'nobody' | 'no-method';

/**
 * What an operator must know before saving:
 *   nobody    — an empty list: privileged accounts are protected by a password alone;
 *   no-method — groups are required but no second factor can be set up (TOTP and security keys off),
 *               so their members cannot finish signing in.
 * Unknown method state (auth methods not managed here) warns about nothing it cannot see.
 */
export function secondFactorWarnings(groups: string[], methods?: SecondFactorMethodsState | null): SecondFactorWarning[] {
  if (groups.length === 0) return ['nobody'];
  if (methods && methods.totp?.enabled === false && methods.webauthn?.enabled !== true) return ['no-method'];
  return [];
}

/** Same set, whatever the order. */
export function sameGroups(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((g, i) => g === [...b].sort()[i]);
}

/** What the console shows the signed-in person about their own second factor. */
export type SecondFactorPrompt =
  /** Their role requires one and they have none: a persistent banner, a mark on the user menu, a Needs-you item. */
  | 'enrol'
  /** They have one but signed in without it: nothing persistent — a soft prompt when an action needs it. */
  | 'confirm'
  | null;

export interface OwnSecondFactor {
  secondFactorRequired: boolean;
  hasSecondFactor: boolean;
  aal: string;
}

export function secondFactorPrompt(s: OwnSecondFactor | null | undefined): SecondFactorPrompt {
  if (!s?.secondFactorRequired) return null;
  if (!s.hasSecondFactor) return 'enrol';
  return s.aal === 'aal2' ? null : 'confirm';
}

export const ENROL_TITLE = 'Two-step sign-in is required for your role — set it up now';
export const ENROL_DETAIL = 'It takes about two minutes, on the sign-in page; you come straight back here.';

/** Groups jinbe keeps for somebody until they enrol (second-factor/awaiting.ts in jinbe). */
export interface AwaitingSecondFactor {
  groups: string[];
  expiresAt: string;
}

/**
 * The toast after adding somebody who has no second factor yet to a group that requires one: nothing
 * is refused, the groups wait for them, and they are asked to set it up when they next arrive.
 */
export function awaitingNotice(email: string, awaiting: AwaitingSecondFactor): [string, { sub: string; ttl: number }] {
  const groups = awaiting.groups.join(', ');
  const until = new Date(awaiting.expiresAt).toLocaleDateString();
  return [
    `${email} joins ${groups} once they set up two-step sign-in`,
    { sub: `They are asked to set it up the next time they sign in or open the console. Waiting until ${until}.`, ttl: 12000 },
  ];
}
