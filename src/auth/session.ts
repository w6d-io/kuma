import { OidcClient, readOidcSettings, type Stage } from './oidc';
import {
  DirectoryUnavailableError,
  listOrganisations,
  readDirectorySettings,
  selectOrganisation,
  type DirectorySettings,
  type Organisation,
} from './directory';

/**
 * The one place that knows whether this deployment signs in against an authority.
 *
 * A module rather than a context, because the API client needs a token before any component has
 * rendered, and because there is exactly one of these per page.
 */
let client: OidcClient | null = null;
let directory: DirectorySettings | null = null;
let started = false;

/** Which step the token currently held belongs to, so the wrong one is never sent to the API. */
let held: Stage | null = null;

/** Set while somebody has to say which organisation this session acts in. */
let choices: readonly Organisation[] | null = null;

/** The redirect the authority sends the browser back to: this page, wherever it is mounted. */
function redirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/**
 * What a completed load leaves the console to do.
 *
 * `ready` covers every case where nothing is being asked of the reader — including a deployment
 * that does not sign in this way at all. `choose` is only ever returned when there is a real choice
 * to make, and no working token can be had until it is made.
 */
export type SessionStart =
  | { readonly kind: 'ready'; readonly returnTo: string | null }
  | { readonly kind: 'choose'; readonly organisations: readonly Organisation[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * Read the configuration and, if an authority is named, prepare to use it.
 *
 * A sign-in can take two passes. The first asks for a token that opens the directory and asserts no
 * membership; with it, the organisations are listed and one is recorded. Only then is a token for
 * this API worth asking for, because the authority puts the recorded organisation in it — and a
 * token asserting none is refused, which is why the order cannot be swapped.
 */
export async function startSession(): Promise<SessionStart> {
  if (started) return { kind: 'ready', returnTo: null };
  started = true;

  const settings = readOidcSettings();
  if (!settings) return { kind: 'ready', returnTo: null };

  directory = readDirectorySettings();
  client = new OidcClient(settings, redirectUri());

  if (!OidcClient.isCallback()) return { kind: 'ready', returnTo: null };

  try {
    const { returnTo, stage } = await client.completeCallback();
    held = stage;
    // The code is spent; leaving it in the address bar means a reload tries to spend it again.
    window.history.replaceState({}, '', redirectUri() + window.location.hash);

    if (stage === 'directory') return await afterDirectorySignIn();
    return { kind: 'ready', returnTo };
  } catch (failure) {
    // A refused or expired code must not loop: the console shows itself as signed out and the
    // person presses again, rather than the browser bouncing off the authority for ever.
    console.error('[oidc] sign-in did not complete:', failure);
    window.history.replaceState({}, '', redirectUri() + window.location.hash);
    return { kind: 'ready', returnTo: null };
  }
}

/**
 * Holding a token that opens the directory: find out what there is to choose from.
 *
 * One organisation is not a choice, so it is recorded without asking — a screen people learn to
 * click through without reading is how the next one gets clicked through too. None means the
 * directory holds nothing for this account, and asking for an API token would only produce a
 * refusal nobody could explain, so the console carries on and its screens say what is missing.
 */
async function afterDirectorySignIn(): Promise<SessionStart> {
  if (!client || !directory) return { kind: 'ready', returnTo: null };

  const token = await client.accessToken();
  if (!token) return { kind: 'unavailable', reason: 'the sign-in produced no token' };

  try {
    const organisations = await listOrganisations(directory, token);
    if (organisations.length === 0) return { kind: 'ready', returnTo: null };
    if (organisations.length === 1) {
      await chooseOrganisation(organisations[0].id);
      return { kind: 'ready', returnTo: null };
    }
    choices = organisations;
    return { kind: 'choose', organisations };
  } catch (failure) {
    if (failure instanceof DirectoryUnavailableError) {
      // Reported rather than shown as an empty list: the two look identical on screen and mean
      // opposite things, and only one of them is the reader's problem.
      return { kind: 'unavailable', reason: failure.message };
    }
    throw failure;
  }
}

/** What is still to be chosen, for a console that asks again after rendering. */
export function pendingOrganisations(): readonly Organisation[] | null {
  return choices;
}

/**
 * Record the organisation, then ask for the token that carries it.
 *
 * Does not return: the browser leaves for the authority and comes back holding a token for this
 * API. The identifier is one the directory itself answered, and it checks it again regardless.
 */
export async function chooseOrganisation(organisationId: string): Promise<void> {
  if (!client || !directory) return;

  const token = await client.accessToken();
  if (!token) throw new DirectoryUnavailableError('the token that opens the directory is gone');

  await selectOrganisation(directory, token, organisationId);
  choices = null;
  await client.signIn(redirectUri(), 'api');
}

/** Whether the console holds a token, rather than relying on a session cookie. */
export function signsInWithToken(): boolean {
  return client !== null;
}

/**
 * The token to put on a request, or null when there is none to put.
 *
 * A token minted to open the directory is not offered to this API: it asserts no membership and a
 * different audience accepts it, so sending it would earn a refusal that reads like a broken
 * session rather than a step not yet taken.
 */
export async function bearerToken(): Promise<string | null> {
  if (!client || (directory !== null && held === 'directory')) return null;
  return client.accessToken();
}

/** Send the browser to the authority, coming back to where it is now. */
export async function signIn(): Promise<boolean> {
  if (!client) return false;

  if (directory) {
    await client.signIn(window.location.href, 'directory', directory.audience);
    return true;
  }

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
