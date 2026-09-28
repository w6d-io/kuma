/**
 * Settings · Sign-in protection: the bot check per sign-in flow and who may create an account
 * (jinbe /admin/settings/sign-in-protection). jinbe validates again on save; this is so the form can
 * say what is wrong before anyone presses Save.
 */
import type { BotCheckFlow, SignInProtection } from '../api/client';

export const BOT_CHECK_FLOWS: { id: BotCheckFlow; label: string; hint: string }[] = [
  {
    id: 'registration',
    label: 'Sign-up',
    hint: 'Checked by the identity service before an account is stored, so a script that calls the sign-up API directly is refused too.',
  },
  {
    id: 'login',
    label: 'Sign-in',
    hint: 'Checked before a session is issued, for passwords and email codes (not for the second factor). Kratos checks the password first, so a script can still learn whether a password is right — the gateway rate limit is what slows guessing.',
  },
  {
    id: 'recovery',
    label: 'Password reset',
    hint: 'Shown before a reset email is sent. Kratos cannot stop this step itself: scripts are refused only where the gateway check is installed.',
  },
  {
    id: 'verification',
    label: 'Email verification (resend)',
    hint: 'Shown before a verification email is sent. Same limit as password reset: scripts are refused only where the gateway check is installed.',
  },
];

// The same shapes jinbe accepts (src/sign-in-protection/settings.ts).
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const DOMAIN = /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const MAX_ENTRIES = 500;

/** One entry per line or comma; trimmed, lowercased, de-duplicated, in the order typed. */
export function parseEntries(text: string): string[] {
  return [...new Set(text.split(/[\n,;]+/).map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
}

export function formatEntries(list: string[]): string {
  return list.join('\n');
}

/**
 * The allow-list box takes addresses and domains together (what people paste); they are stored apart.
 * `@corp.io` is read as the domain.
 */
export function splitAllowList(text: string): { emails: string[]; domains: string[]; invalid: string[] } {
  const emails: string[] = [];
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const e of parseEntries(text)) {
    if (e.includes('@')) (EMAIL.test(e) && e.length <= 254 ? emails : invalid).push(e);
    else (DOMAIN.test(e) && e.length <= 254 ? domains : invalid).push(e);
  }
  return { emails, domains, invalid };
}

export function invalidDomains(text: string): string[] {
  return parseEntries(text).filter((d) => d.length > 254 || !DOMAIN.test(d));
}

export interface ProtectionDraft {
  flows: Record<BotCheckFlow, boolean>;
  failMode: 'closed' | 'open';
  mode: SignInProtection['registration']['mode'];
  allowText: string;
  denyText: string;
  blockDisposable: boolean;
}

export function toDraft(s: SignInProtection): ProtectionDraft {
  return {
    flows: { ...s.captcha.flows },
    failMode: s.captcha.failMode,
    mode: s.registration.mode,
    allowText: formatEntries([...s.registration.allowDomains, ...s.registration.allowEmails]),
    denyText: formatEntries(s.registration.denyDomains),
    blockDisposable: s.registration.blockDisposable,
  };
}

export interface DraftProblems {
  allow?: string;
  deny?: string;
}

/** What stops Save, per field. */
export function draftProblems(d: ProtectionDraft): DraftProblems {
  const out: DraftProblems = {};
  const allow = splitAllowList(d.allowText);
  if (allow.invalid.length) out.allow = `Not an email address or a domain: ${allow.invalid.slice(0, 5).join(', ')}`;
  else if (allow.emails.length > MAX_ENTRIES || allow.domains.length > MAX_ENTRIES) out.allow = `At most ${MAX_ENTRIES} addresses and ${MAX_ENTRIES} domains.`;
  else if (d.mode === 'allowlist' && !allow.emails.length && !allow.domains.length) out.allow = 'Add at least one address or domain, or choose Closed.';
  const deny = invalidDomains(d.denyText);
  if (deny.length) out.deny = `Not a domain: ${deny.slice(0, 5).join(', ')}`;
  else if (parseEntries(d.denyText).length > MAX_ENTRIES) out.deny = `At most ${MAX_ENTRIES} domains.`;
  return out;
}

export function fromDraft(d: ProtectionDraft): SignInProtection {
  const allow = splitAllowList(d.allowText);
  return {
    captcha: { flows: { ...d.flows }, failMode: d.failMode },
    registration: {
      mode: d.mode,
      allowEmails: allow.emails,
      allowDomains: allow.domains,
      denyDomains: parseEntries(d.denyText),
      blockDisposable: d.blockDisposable,
    },
  };
}

/** Same settings, whatever the order of the lists. */
export function sameProtection(a: SignInProtection, b: SignInProtection): boolean {
  const norm = (s: SignInProtection) => JSON.stringify({
    ...s,
    registration: {
      ...s.registration,
      allowEmails: [...s.registration.allowEmails].sort(),
      allowDomains: [...s.registration.allowDomains].sort(),
      denyDomains: [...s.registration.denyDomains].sort(),
    },
  });
  return norm(a) === norm(b);
}

export type ProtectionWarning = 'login-fail-closed' | 'fail-open' | 'test-keys' | 'provider-lost';

/**
 * What an operator must know before saving:
 *   login-fail-closed — the sign-in check with "refuse" when the provider is down: a provider outage
 *                       locks everyone out of the console, the people who could turn it off included;
 *   fail-open         — a provider outage waves every attempt through unchecked;
 *   test-keys         — the provider's test keys pass every visitor: no bot check at all;
 *   provider-lost     — a flow is on but the provider is no longer configured: that flow refuses
 *                       every attempt (closed) or checks nothing (open).
 */
export function protectionWarnings(s: SignInProtection, provider: { configured: boolean; testKeys: boolean }): ProtectionWarning[] {
  const anyOn = Object.values(s.captcha.flows).some(Boolean);
  const out: ProtectionWarning[] = [];
  if (!anyOn) return out;
  if (!provider.configured) out.push('provider-lost');
  if (provider.configured && provider.testKeys) out.push('test-keys');
  if (s.captcha.flows.login && s.captcha.failMode === 'closed') out.push('login-fail-closed');
  if (s.captcha.failMode === 'open') out.push('fail-open');
  return out;
}

export const PROVIDER_LABEL: Record<string, string> = {
  turnstile: 'Cloudflare Turnstile',
  hcaptcha: 'hCaptcha',
  recaptcha: 'Google reCAPTCHA v3',
};
