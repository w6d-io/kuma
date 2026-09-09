import { signOut, signsInWithToken } from './session';

/**
 * Signing out, whichever way this deployment signs in.
 *
 * One place, because a sign-out that misses one of the things it should destroy is
 * indistinguishable from one that worked: the console shows a sign-in screen either way, and the
 * next visit quietly gets back in. What has to go is the token held in this tab, the cached answers
 * it fetched, the credential the authority would still honour, and the session behind the sign-in.
 *
 * Where somebody lands afterwards is part of the contract and not a detail: the console they were
 * using, showing its own sign-in. Sending them to another application's login screen tells them
 * they signed out of something they were not using.
 */

/** Where the console lives, wherever it happens to be mounted. */
export function consoleUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/**
 * The public address of the identity service, for the deployments that sign in with its session
 * instead of a token.
 *
 * Read rather than derived, because it is not always the bare host: put behind a path, the
 * self-service endpoints move with it, and a console that assumed the root would ask the wrong
 * place and get an answer that is not JSON. Falls back to the host it already knows, which is where
 * it used to look.
 */
export function identityBaseUrl(source: Record<string, unknown> = window as never): string {
  const explicit = source['__KRATOS_PUBLIC_URL__'];
  const held = typeof explicit === 'string' ? explicit.trim().replace(/\/+$/, '') : '';
  if (held && !held.startsWith('${')) return held;

  const domain = source['__AUTH_DOMAIN__'];
  return typeof domain === 'string' && domain && !domain.startsWith('${') ? `https://${domain}` : '';
}

/**
 * The single-use address that ends a session, or null when there is none to end.
 *
 * Two steps, and the reason the first one exists: asking creates the flow and answers JSON carrying
 * the token that authorises the second. Navigating straight to the creating endpoint renders that
 * JSON in the window instead of signing anybody out.
 */
async function sessionEndUrl(base: string): Promise<string | null> {
  try {
    const answer = await fetch(`${base}/self-service/logout/browser`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!answer.ok) return null;
    const flow = (await answer.json()) as { logout_url?: string };
    return flow.logout_url ?? null;
  } catch {
    // Refused, offline, or answered something that is not JSON. The caller still sends the person
    // to a sign-in screen: staying on a console they asked to leave is the worse outcome.
    return null;
  }
}

/** Empty the caches this console keeps, so nothing it read stays readable after somebody leaves. */
function forgetLocalState(clearCaches: () => void): void {
  clearCaches();
  try {
    window.sessionStorage.clear();
  } catch {
    // A browser that refuses storage never held anything to clear.
  }
}

export async function leave(clearCaches: () => void): Promise<void> {
  forgetLocalState(clearCaches);

  // The authority owns the session, so it is the only one that can end it. This does not return.
  if (signsInWithToken() && (await signOut(consoleUrl()))) return;

  const base = identityBaseUrl();
  const back = consoleUrl();
  if (base) {
    const ending = await sessionEndUrl(base);
    if (ending) {
      window.location.href = `${ending}&return_to=${encodeURIComponent(back)}`;
      return;
    }
  }

  // Nothing left to end, or nothing that answered. Reloading the console is what shows its own
  // sign-in screen, and it is where somebody who signed out expects to be.
  window.location.href = back;
}
