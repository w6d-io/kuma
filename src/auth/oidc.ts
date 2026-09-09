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

  /** Send the browser to the authority. It comes back to the redirect URI with a code. */
  signIn(returnTo: string): Promise<void> {
    return this.manager.signinRedirect({ state: { returnTo } });
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

  /** Finish the exchange, and say where the sign-in was meant to lead. */
  async completeCallback(): Promise<string | null> {
    const user = await this.manager.signinRedirectCallback();
    const state = user.state as { returnTo?: string } | undefined;
    return state?.returnTo ?? null;
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
}
