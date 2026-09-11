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
