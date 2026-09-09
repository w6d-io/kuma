import { OidcClient, readOidcSettings } from './oidc';

/**
 * The one place that knows whether this deployment signs in against an authority.
 *
 * A module rather than a context, because the API client needs a token before any component has
 * rendered, and because there is exactly one of these per page.
 */
let client: OidcClient | null = null;
let started = false;

/** The redirect the authority sends the browser back to: this page, wherever it is mounted. */
function redirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/**
 * Read the configuration and, if an authority is named, prepare to use it.
 *
 * Returns where a completed sign-in was meant to lead, so the caller can put the browser back where
 * the person was. Null means there is nothing to restore — either this was an ordinary load, or the
 * deployment does not sign in this way at all.
 */
export async function startSession(): Promise<string | null> {
  if (started) return null;
  started = true;

  const settings = readOidcSettings();
  if (!settings) return null;

  client = new OidcClient(settings, redirectUri());

  if (!OidcClient.isCallback()) return null;

  try {
    const returnTo = await client.completeCallback();
    // The code is spent; leaving it in the address bar means a reload tries to spend it again.
    window.history.replaceState({}, '', redirectUri() + window.location.hash);
    return returnTo;
  } catch (failure) {
    // A refused or expired code must not loop: the console shows itself as signed out and the
    // person presses again, rather than the browser bouncing off the authority for ever.
    console.error('[oidc] sign-in did not complete:', failure);
    window.history.replaceState({}, '', redirectUri() + window.location.hash);
    return null;
  }
}

/** Whether the console holds a token, rather than relying on a session cookie. */
export function signsInWithToken(): boolean {
  return client !== null;
}

/** The token to put on a request, or null when there is none to put. */
export async function bearerToken(): Promise<string | null> {
  return client ? client.accessToken() : null;
}

/** Send the browser to the authority, coming back to where it is now. */
export async function signIn(): Promise<boolean> {
  if (!client) return false;
  await client.signIn(window.location.href);
  return true;
}

/** Drop the token held here. Ending the authority's own session is a separate act. */
export async function forgetToken(): Promise<void> {
  await client?.forget();
}

/**
 * Leave, and leave nothing behind.
 *
 * Returns false when this deployment does not sign in against an authority, so the caller can fall
 * back to the session it does use. Otherwise the browser leaves for the authority and does not come
 * back here signed in — so anything that must be cleaned up locally is cleaned up before that.
 */
export async function signOut(returnTo: string = redirectUri()): Promise<boolean> {
  if (!client) return false;
  await client.signOut(returnTo);
  return true;
}
