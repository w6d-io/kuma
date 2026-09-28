/**
 * Sending somebody to prove their second factor again, after a privileged change was refused.
 *
 * The address is a contract with the login screen, which starts the Kratos flow: `aal=aal2` asks
 * for the level, `refresh` is what makes Kratos ask again rather than answer that the level is
 * already held. Three screens bounce this way and all three go through here, so the shape cannot
 * drift away from the screen that reads it.
 */

const BOUNCE_DELAY_MS = 1500;

/** Where to come back to. The current address, so the operator retries where they were. */
export function stepUpUrl(authDomain: string, returnTo: string): string {
  return `https://${authDomain}/login?aal=aal2&refresh=true&return_to=${encodeURIComponent(returnTo)}`;
}

/**
 * Leaves the toast on screen long enough to be read before the page goes: a redirect with no
 * warning is indistinguishable from being signed out, which is exactly how this was reported.
 * Returns false when no auth domain is configured, so the caller can say so rather than
 * silently do nothing.
 */
export function bounceToStepUp(): boolean {
  const authDomain = (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__;
  if (!authDomain) return false;
  const returnTo = window.location.href;
  setTimeout(() => { window.location.href = stepUpUrl(authDomain, returnTo); }, BOUNCE_DELAY_MS);
  return true;
}

/**
 * The sign-in site's two-step gate: sets up a second factor when the account has none, steps up
 * when it has one, then comes back. Where the console sends somebody the API refused with
 * `second_factor_required` — an account in a group that must use two-step sign-in, below aal2.
 * Unlike stepUpUrl it works for an account with no factor yet: an aal2 login flow has nothing to ask
 * such an account, and the screen would send it straight back here.
 */
export function twoStepUrl(authDomain: string, returnTo: string): string {
  return `https://${authDomain}/two-step?return_to=${encodeURIComponent(returnTo)}`;
}

/** Fired on window just before the console leaves for the two-step gate, so the page can say why. */
export const TWO_STEP_EVENT = 'kuma:two-step';

const TWO_STEP_KEY = 'kuma:two-step-bounces';
const TWO_STEP_WINDOW_MS = 60_000;
const TWO_STEP_MAX = 2;
let bouncing = false;

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

/** sessionStorage, or null when the browser blocks it (the getter itself can throw). */
function sessionStore(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/**
 * At most two bounces a minute: a third means the sign-in site let the person through without the
 * level the API wants (it could not ask jinbe, say) — going round again would loop, so the caller
 * shows the refusal instead.
 */
export function mayBounceToTwoStep(storage: KeyValueStore | null, now: () => number = Date.now): boolean {
  try {
    if (!storage) return true;
    const t = now();
    const recent = (JSON.parse(storage.getItem(TWO_STEP_KEY) || '[]') as number[]).filter(x => t - x < TWO_STEP_WINDOW_MS);
    if (recent.length >= TWO_STEP_MAX) return false;
    storage.setItem(TWO_STEP_KEY, JSON.stringify([...recent, t]));
  } catch {
    /* storage blocked: allow */
  }
  return true;
}

/** The gate for the current page, or null without an auth domain. For links the person clicks. */
export function twoStepHere(): string | null {
  const authDomain = (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__;
  return authDomain ? twoStepUrl(authDomain, window.location.href) : null;
}

/**
 * Sends the person to the two-step gate, once per page, after the same short pause as a step-up so
 * the toast can be read. Every query of a console fails the same way at once; only the first one
 * navigates. False when there is no auth domain or the loop guard says stop.
 */
export function bounceToTwoStep(): boolean {
  if (bouncing) return true;
  const authDomain = (window as unknown as { __AUTH_DOMAIN__?: string }).__AUTH_DOMAIN__;
  if (!authDomain) return false;
  if (!mayBounceToTwoStep(sessionStore())) return false;
  bouncing = true;
  const returnTo = window.location.href;
  window.dispatchEvent(new CustomEvent(TWO_STEP_EVENT, { detail: { to: twoStepUrl(authDomain, returnTo) } }));
  setTimeout(() => { window.location.href = twoStepUrl(authDomain, returnTo); }, BOUNCE_DELAY_MS);
  return true;
}
