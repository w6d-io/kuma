import type { CheckLevel } from './format';
import type { Finding } from './types';

/**
 * POST /sites/:name/verify (jinbe wave18): is what was published really there, and does it keep out
 * who it should? The rollout conditions, an anonymous request per route, the access matrix from the
 * policy engine, and curl lines to try it by hand. Also the publish findings, grouped for a person
 * to acknowledge.
 */

export type RolloutStatus = 'ok' | 'pending' | 'warn' | 'fail' | 'unknown' | 'skipped';
export type AccessAnswer = 'ok' | 'forbidden' | 'not_found' | 'needs_2fa' | 'unknown';

export interface ProbeResult {
  route: string; method: string; url: string; expect: 'protected' | 'public' | 'denied';
  status: number | null; location?: string; verdict: 'ok' | 'exposed' | 'unexpected' | 'unreachable' | 'skipped'; level: 'ok' | 'error' | 'warn'; message: string;
}

export interface VerifyReport {
  site: string; host: string; version: { saved: number; applied: number | null }; checkedAt: string;
  rollout: { ready: boolean; checks: Array<{ id: string; label: string; status: RolloutStatus; message: string }> };
  probe: { available: boolean; reason?: string; notProbed: string[]; results: ProbeResult[] };
  access: {
    available: boolean; reason?: string; source: 'opa'; notChecked: string[];
    subjects: Array<{ key: string; kind: 'group' | 'org-group' | 'role' | 'signed-in'; name: string }>;
    rows: Array<{ route: string; method: string; path: string; access: string; answers: Record<string, AccessAnswer> }>;
  };
  waf: null | { checked: boolean; blocked: boolean | null; status: number | null; url: string; message: string };
  curl: Array<{ route: string; method: string; url: string; anonymous: string; withToken: string }>;
  summary: { ok: boolean; errors: string[]; warnings: string[] };
}

export const ROLLOUT_LEVEL: Record<RolloutStatus, CheckLevel> = { ok: 'ok', pending: 'pending', warn: 'warn', fail: 'error', unknown: 'info', skipped: 'info' };

export const ANSWER_WORD: Record<AccessAnswer, { text: string; tone: 'success' | 'neutral' | 'warning' | 'plain' }> = {
  ok: { text: 'Allowed', tone: 'success' },
  forbidden: { text: 'Refused', tone: 'neutral' },
  not_found: { text: 'Not found', tone: 'neutral' },
  needs_2fa: { text: 'Needs 2FA', tone: 'warning' },
  unknown: { text: 'Unknown', tone: 'plain' },
};

export const EXPECT_WORD: Record<ProbeResult['expect'], string> = { protected: 'Sign-in required', public: 'Public', denied: 'Refused' };

/** Findings by level; confirm ones grouped by code, since one acknowledgement covers the code. */
export function groupFindings(findings: readonly Finding[]) {
  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warn');
  const confirm = new Map<string, Finding[]>();
  for (const f of findings) if (f.level === 'confirm') confirm.set(f.code, [...(confirm.get(f.code) ?? []), f]);
  return { errors, warnings, confirm: [...confirm.entries()].map(([code, items]) => ({ code, items })) };
}

/** The confirm codes still to acknowledge. */
export function unacknowledged(findings: readonly Finding[], acknowledged: ReadonlySet<string>): string[] {
  return [...new Set(findings.filter((f) => f.level === 'confirm').map((f) => f.code))].filter((c) => !acknowledged.has(c));
}

/** One list from two answers (the preview's and a refused publish's), each finding once. */
export function mergeFindings(a: readonly Finding[], b: readonly Finding[]): Finding[] {
  const key = (f: Finding) => `${f.code}|${f.path ?? ''}|${f.message}`;
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((f) => !seen.has(key(f)))];
}

/** What a list of findings still needs, in one line; null when it can be published. */
export function findingsBlocker(findings: readonly Finding[], acknowledged: ReadonlySet<string>): string | null {
  const errors = findings.filter((f) => f.level === 'error').length;
  if (errors) return `${errors} security error${errors === 1 ? '' : 's'} must be fixed first.`;
  const left = unacknowledged(findings, acknowledged).length;
  return left ? `Acknowledge ${left} finding${left === 1 ? '' : 's'} first.` : null;
}
