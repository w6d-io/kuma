import type { AccessCheckResult } from '../api/orgAccess';
import { isNotAvailable } from '../api/orgAccess';
import { describeApiError, statusOf } from './apiError';

/**
 * "Can this person call this route, and why?" — the engine's answer, put in words.
 *
 * The checker is where somebody lands when a person says "I get a 403", so the reason has to name
 * what to change: the missing permission and the site that asks for it, the org boundary, or the
 * route nobody (or two sites at once) declares.
 */

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export interface CheckForm {
  email: string;
  method: string;
  path: string;
  /** Pin the site instead of letting the policy work out the owner. Empty = let it. */
  app: string;
}

export interface Explanation {
  verdict: 'ALLOWED' | 'DENIED';
  /** Two or more sites declare the route — the policy refuses everyone until one lets go. */
  tie: boolean;
  text: string;
}

export function requiredPermissions(r: AccessCheckResult): string[] {
  return [...new Set(r.matchingRules.map((m) => m.permission).filter((p): p is string => !!p))];
}

const list = (xs: string[]) => xs.join(', ');

export function explain(r: AccessCheckResult): Explanation {
  const tie = r.owners.length >= 2;
  const verdict = r.allow ? 'ALLOWED' : 'DENIED';
  const needs = requiredPermissions(r);
  const site = r.app ?? r.owners[0] ?? null;

  if (tie) {
    return {
      verdict,
      tie,
      text: `Two sites claim this route (${list(r.owners)}). The engine cannot tell which one decides, so it refuses everyone until one of them stops declaring it.`,
    };
  }
  if (r.allow) {
    if (r.superAdmin) return { verdict, tie, text: 'Allowed: they are a super admin, who may do everything.' };
    return {
      verdict,
      tie,
      text: needs.length
        ? `Allowed: ${site ?? 'the site'} asks for ${list(needs)}, and their roles include it.`
        : `Allowed: ${site ?? 'the site'} lets this route through without a specific permission.`,
    };
  }
  switch (r.reason) {
    case 'not_found':
      return { verdict, tie, text: 'Denied: no site declares this route, so nobody may call it. Add the route to the site that serves it.' };
    case 'forbidden_org':
      return {
        verdict,
        tie,
        text: 'Denied: this route belongs to an organization, and they are not a member of it or hold nothing there. An admin of that organization can add them or grant a group.',
      };
    default:
      return {
        verdict,
        tie,
        text: needs.length
          ? `Denied: ${site ?? 'the site'} asks for ${list(needs)}, and none of their roles carries it. Give them a group whose roles include it.`
          : `Denied: none of their roles lets them call this route on ${site ?? 'the site'}.`,
      };
  }
}

export function formFromQuery(q: Record<string, string> | undefined): CheckForm {
  const m = (q?.method ?? '').toUpperCase();
  return {
    email: q?.email ?? '',
    method: (METHODS as readonly string[]).includes(m) ? m : 'GET',
    path: q?.path ?? '',
    app: q?.app ?? '',
  };
}

/** What is wrong with the form in words, or null when it can be sent. Mirrors jinbe's own checks. */
export function validateCheck(f: CheckForm): string | null {
  if (!/^[^\s@]+@[^\s@]+$/.test(f.email.trim())) return 'Enter the person\'s email.';
  const path = f.path.trim();
  if (!path.startsWith('/')) return 'The path must start with / (for example /api/clusters/42).';
  if (/[?#\s]/.test(path)) return 'Leave the query string out of the path.';
  return null;
}

export function describeCheckError(err: unknown): { title: string; detail: string; retryable: boolean } {
  if (isNotAvailable(err)) {
    return { title: 'Not available yet', detail: 'This server does not have the access checker yet.', retryable: false };
  }
  const status = statusOf(err);
  if (status === 503) {
    return {
      title: 'The access checker is not set up',
      detail: 'This server has no token to ask the access engine with. Nothing was checked; this is configuration, not a refusal.',
      retryable: false,
    };
  }
  if (status === 502) {
    return { title: 'The access engine did not answer', detail: 'Nothing was checked. Try again in a moment.', retryable: true };
  }
  if (status === 400) {
    const message = (err as { message?: unknown } | null)?.message;
    return { title: 'The check was not accepted', detail: typeof message === 'string' ? message : 'Check the form.', retryable: false };
  }
  return describeApiError(err);
}
