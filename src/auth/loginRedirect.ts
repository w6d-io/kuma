import { signIn } from './session';

/**
 * Full-page redirect to the auth-domain login. refresh=true forces Kratos to
 * re-authenticate and mint a NEW session — used when a cookie is present but
 * rejected (expired/revoked/corrupt), where a plain /login could see a
 * "still valid" session and bounce straight back, looping.
 */
export function redirectToLogin(opts?: { refresh?: boolean }) {
  // An authority, when the deployment named one: it answers with a token the API can verify on its
  // own, where the cookie below asks the API to look a session up. Tried first because a deployment
  // that configured an authority meant it; falls through when none is configured, which is what
  // every deployment did before this was a choice.
  void signIn().then((sent) => {
    if (sent) return;
    redirectToCookieLogin(opts);
  });
}

function redirectToCookieLogin(opts?: { refresh?: boolean }) {
  const authDomain = (window as any).__AUTH_DOMAIN__;
  if (!authDomain) {
    // No runtime config — surface the misconfig instead of silently redirecting
    // somewhere unexpected.
    console.error('Kuma: AUTH_DOMAIN is not configured. Set the AUTH_DOMAIN env on the container.');
    return;
  }
  const params = new URLSearchParams();
  if (opts?.refresh) params.set('refresh', 'true');
  params.set('return_to', window.location.href);
  window.location.href = `https://${authDomain}/login?${params.toString()}`;
}
