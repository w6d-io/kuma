import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

/**
 * Signing in against an OpenID Connect authority, when the deployment names one.
 *
 * Named an authority and a client, and nothing more: which login screen the authority shows, and
 * which directory decided what the token asserts, are its business. This console only ever knows
 * the standard vocabulary — which is what lets one build serve a deployment whose identity stack it
 * has never heard of.
 *
 * Without an authority configured, none of this runs and the console keeps the session-cookie
 * redirect it had before. Turning it on is a value, not a build.
 */
/**
 * Which step a held token belongs to. A token minted to ask a question must not be sent as if it
 * answered one: they differ in what they assert and in who accepts them.
 */
export type Stage = 'directory' | 'api';

export interface OidcSettings {
  readonly authority: string;
  readonly clientId: string;
  /** Optional: some authorities want the audience the token is for, others infer it. */
  readonly audience: string;
}

/** What the container was told at start-up, as the runtime injected it. */
export function readOidcSettings(source: Record<string, unknown> = window as never): OidcSettings | null {
  const authority = placeholder(source['__OIDC_AUTHORITY__']);
  const clientId = placeholder(source['__OIDC_CLIENT_ID__']);
  // Both are needed to sign in at all. One without the other is a half-configured deployment, and
  // guessing the other half would send people somewhere unexpected.
  if (!authority || !clientId) return null;
  return { authority, clientId, audience: placeholder(source['__OIDC_AUDIENCE__']) };
}

/**
 * An unsubstituted `${VAR}` reads as not configured.
 *
 * envsubst leaves the placeholder in place when the variable is unset, so the literal string is
 * what an empty setting actually looks like in the browser.
 */
function placeholder(value: unknown): string {
  const held = typeof value === 'string' ? value.trim() : '';
  return held.startsWith('${') ? '' : held;
}

export class OidcClient {
  private readonly manager: UserManager;

  constructor(settings: OidcSettings, redirectUri: string) {
    this.manager = new UserManager({
      authority: settings.authority,
      client_id: settings.clientId,
      redirect_uri: redirectUri,
      post_logout_redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid offline_access',
      // The token lives in memory for the tab that holds it rather than in localStorage: a console
      // that administers permissions is the last place to leave a bearer token at rest where any
      // script on the origin can read it. The cost is a silent renew on reload, which is what the
      // authority's session is for.
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      automaticSilentRenew: true,
      ...(settings.audience ? { extraQueryParams: { audience: settings.audience } } : {}),
    });
  }

  /**
   * Send the browser to the authority. It comes back to the redirect URI with a code.
   *
   * The audience can be overridden for one request: a deployment may need a token that opens a
   * directory before it can be told what a token for this API should assert. The default stays on
   * the manager, so a silent renew keeps asking for the same thing as the sign-in it renews.
   */
  signIn(returnTo: string, stage: Stage = 'api', audience?: string): Promise<void> {
    return this.manager.signinRedirect({
      state: { returnTo, stage },
      ...(audience ? { extraQueryParams: { audience } } : {}),
    });
  }

  /**
   * Whether this load is the authority answering, rather than an ordinary navigation.
   *
   * Read from the query string, because the fragment is what this console routes on and must not be
   * disturbed: `?code=` and `?error=` are the authority's, `#/services` is ours.
   */
  static isCallback(search: string = window.location.search): boolean {
    const params = new URLSearchParams(search);
    return params.has('code') || params.has('error');
  }

  /** Finish the exchange, and say which step it was and where it was meant to lead. */
  async completeCallback(): Promise<{ returnTo: string | null; stage: Stage }> {
    const user = await this.manager.signinRedirectCallback();
    rememberIdToken(user.id_token);
    const state = user.state as { returnTo?: string; stage?: Stage } | undefined;
    return { returnTo: state?.returnTo ?? null, stage: state?.stage === 'directory' ? 'directory' : 'api' };
  }

  /**
   * The token to send, or null.
   *
   * An expired token is null rather than sent: a request refused for an expired token is a round
   * trip and a 401 the console would have to interpret, where a silent renew is one call.
   */
  async accessToken(): Promise<string | null> {
    const user: User | null = await this.manager.getUser();
    if (!user || user.expired) return null;
    return user.access_token ?? null;
  }

  /** Drop what is held here. Ending the session itself is the authority's business. */
  async forget(): Promise<void> {
    await this.manager.removeUser();
  }

  /**
   * Sign out for real: revoke, drop, then end the authority's own session.
   *
   * Dropping the token in this tab is the easy third of it and the only part most consoles do. A
   * refresh token outlives the click by design — hours, typically — so one that is merely forgotten
   * here is still a live credential for anybody who has a copy. It is revoked first, while the
   * authority still has a session to revoke it against.
   *
   * Then the browser goes to the authority's end-session endpoint, which is what ends the session
   * behind the sign-in. Without that last step the next visit signs in again without asking, which
   * looks exactly like a sign-out that did nothing.
   *
   * Returns false when the authority cannot be asked to send the browser back here, so the caller
   * can get somebody off this console by the means it does have. Saying where to come back to
   * requires naming the session being ended, and an authority handed one without the other refuses
   * the whole request — which puts an error page in front of somebody who asked to leave.
   */
  async signOut(returnTo: string): Promise<boolean> {
    const user = await this.manager.getUser();
    const idToken = user?.id_token ?? rememberedIdToken();

    // Best effort, and deliberately not fatal: a revocation the authority refuses must not leave
    // somebody stuck on a console they asked to leave. The end-session call below still runs.
    try {
      await this.manager.revokeTokens(['access_token', 'refresh_token']);
    } catch (failure) {
      console.warn('[oidc] the authority refused to revoke:', failure);
    }

    await this.manager.removeUser();
    forgetIdToken();
    // Emptied only now, and only here: what had to be read out of it has been. Before the redirect
    // rather than after, because the request about to be built writes its own state there.
    wipeSession();

    if (!idToken) return false;

    await this.manager.signoutRedirect({
      id_token_hint: idToken,
      post_logout_redirect_uri: returnTo,
    });
    return true;
  }
}

/**
 * The identity token, kept aside for the one thing it is needed for: naming the session to end.
 *
 * It comes with the sign-in and is meant to stay for the life of it, but a silent renew replaces
 * the whole record — and a refresh grant is not obliged to answer one, so the copy in the store
 * quietly becomes undefined. That is invisible until somebody signs out, which is the moment it is
 * required. Kept here so a renew cannot take it away.
 *
 * Session-scoped and per-tab, like the token it describes.
 */
const ID_TOKEN_KEY = 'kuma.id-token';

function rememberIdToken(idToken: string | undefined): void {
  if (!idToken) return;
  try {
    window.sessionStorage.setItem(ID_TOKEN_KEY, idToken);
  } catch {
    // A browser that refuses storage falls back to whatever the store still holds.
  }
}

function rememberedIdToken(): string | undefined {
  try {
    return window.sessionStorage.getItem(ID_TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function forgetIdToken(): void {
  try {
    window.sessionStorage.removeItem(ID_TOKEN_KEY);
  } catch {
    // Nothing was stored, so nothing is left behind.
  }
}

/**
 * Everything else this origin kept for the session.
 *
 * Signing out has to leave nothing behind, and it also has to READ two things out of here first —
 * the stored session and the identity token that names it. Doing the emptying anywhere earlier
 * takes away what the sign-out needs and turns it into a request the authority rejects, which is
 * indistinguishable from a broken session.
 */
function wipeSession(): void {
  try {
    window.sessionStorage.clear();
  } catch {
    // A browser that refuses storage never held anything to clear.
  }
}
