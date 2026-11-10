import { IMPERSONATION_MINUTES, type ActiveImpersonation, type ImpersonationState, type ImpersonationTarget, type ReachableSite } from '../api/impersonation';
import { EDGE_BLOCKED, edgeBlocked, refusalDetail } from './apiError';

/**
 * What impersonation ("Viewing as") can answer, in the words the console shows. Kept apart from the
 * dialog, the banner and the drawer so every outcome is decided (and tested) in one place.
 */

/** jinbe's bounds on the reason (it is written to the audit trail). */
export const REASON_MIN = 5;
export const REASON_MAX = 500;

/**
 * The durations the form offers: 15 and 30 minutes, cut to what jinbe allows (`maxMinutes`). A
 * limit under 15 leaves that limit as the only choice. The last one is the default.
 */
export function durationChoices(maxMinutes?: number): number[] {
  const max = typeof maxMinutes === 'number' && maxMinutes > 0 ? Math.floor(maxMinutes) : Infinity;
  const fit = IMPERSONATION_MINUTES.filter((m) => m <= max);
  return fit.length ? [...fit] : [max];
}

/** The group whose members can never be impersonated; jinbe refuses them whatever the console shows. */
const SUPER_ADMINS = 'super_admins';

/** Who is being viewed as, the way a sentence names them: their name, their address without one. */
export function targetLabel(target: Pick<ImpersonationTarget, 'name' | 'email'>): string {
  return target.name?.trim() || target.email;
}

/** Whole seconds until `expiresAt`; 0 once it has passed or cannot be read. */
export function secondsLeft(expiresAt: string, now: number = Date.now()): number {
  const end = Date.parse(expiresAt);
  return Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 1000)) : 0;
}

/** "29:05" — minutes and seconds left, the minutes never rolled into hours. */
export function formatLeft(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The impersonation still in force at `now`: an expired one reads as none, before jinbe says so. */
export function inForce(state: ImpersonationState | undefined, now: number = Date.now()): ActiveImpersonation | null {
  const active = state?.enabled ? state.active : null;
  return active && secondsLeft(active.expiresAt, now) > 0 ? active : null;
}

/**
 * Why the Impersonate action is greyed for this person, or null when it can be tried. What the
 * drawer already knows; jinbe decides either way.
 */
export function impersonateBlocked(
  state: Pick<ImpersonationState, 'allowed'>,
  me: { identity_id?: string | null } | null | undefined,
  user: { id: string; groups?: string[]; active?: boolean },
): string | null {
  if (!state.allowed) return 'You cannot impersonate (users:impersonate).';
  if (me?.identity_id && me.identity_id === user.id) return 'You cannot impersonate yourself.';
  if (user.groups?.includes(SUPER_ADMINS)) return 'A super admin cannot be impersonated.';
  if (user.active === false) return 'This account is inactive, so it cannot be impersonated.';
  return null;
}

type ApiError = { status?: number; code?: unknown; message?: string; details?: { code?: unknown } };

/**
 * Why starting was refused, when jinbe says something the generic error text would blur. Its
 * impersonation refusals carry the code in the body's `code` (beside error: "Forbidden"); the step-up
 * refusal carries it in `error`, as everywhere.
 */
export function impersonationFailure(err: unknown, who: string): { title: string; detail: string; stepUp?: boolean } {
  const e = (err ?? {}) as ApiError;
  const code = [e.code, e.details?.code].find((c): c is string => typeof c === 'string' && /^(impersonation_|reauth_required$|step_up_unavailable$)/.test(c));
  switch (code) {
    case 'reauth_required':
      return {
        title: 'Confirm your own second factor first',
        detail: 'Impersonating somebody needs your second factor proven recently. You will be sent to confirm it, then back here. Nothing was started.',
        stepUp: true,
      };
    case 'step_up_unavailable':
    case 'impersonation_session_required':
      return { title: 'Not possible with this sign-in', detail: 'You are signed in with a token, not a browser session. Sign in to the console in a browser and try again there.' };
    case 'impersonation_disabled':
      return { title: 'Not available here', detail: 'Impersonation is switched off in this environment.' };
    case 'impersonation_target_admin':
      return { title: 'A super admin cannot be impersonated', detail: `${who} is a super admin. Nothing was started.` };
    case 'impersonation_self':
      return { title: 'Not yourself', detail: 'You cannot impersonate your own account.' };
    case 'impersonation_target_unavailable':
      return { title: 'This account cannot be impersonated', detail: `${who} is inactive or a machine account. Nothing was started.` };
  }
  if (edgeBlocked(err)) return { title: EDGE_BLOCKED.title, detail: EDGE_BLOCKED.detail };
  if (e.status === 403) return { title: 'Access denied', detail: refusalDetail(err) ?? 'This needs users:impersonate.' };
  return { title: 'Could not start', detail: e.message || 'The request failed.' };
}

/** The sites they can open, in the two groups the console shows: through a role, then as anybody signed in. */
export function groupSites(sites: readonly ReachableSite[]): { role: ReachableSite[]; signedIn: ReachableSite[] } {
  return { role: sites.filter((s) => s.access === 'role'), signedIn: sites.filter((s) => s.access !== 'role') };
}

/**
 * What to warn about before (and while) viewing as somebody, from the sites they can open. Never a
 * reason not to start: seeing the refusal they get is a support check in itself.
 */
export function reachNotice(sites: readonly ReachableSite[]): { title: string; detail: string } | null {
  if (sites.length === 0) {
    return { title: 'Nothing this person can open', detail: 'No live site is open to them, through a role or as a signed-in person. Every site will show them "no access" — that is what they see too.' };
  }
  if (!sites.some((s) => s.access === 'role')) {
    return { title: 'No role on any site', detail: 'They hold no role on any site, so sites that need one will show "no access" — that is what they see too.' };
  }
  return null;
}
