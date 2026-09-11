/**
 * The change somebody was refused for want of a second factor, kept across the step-up.
 *
 * A privileged grant is refused, the browser leaves for Kratos, and it comes back on a fresh page.
 * Everything the operator had selected is gone with the old page, so they retype it — and reported
 * exactly that: the step-up worked, the grant had to be made by hand afterwards.
 *
 * `sessionStorage` and not `localStorage`: this belongs to the one tab that was interrupted, and it
 * must not outlive it. It is a PROPOSAL, never an authorisation — nothing is written on the way
 * back. The operator sees what they had asked for and applies it themself, and every gate in jinbe
 * runs again on that apply.
 */

const KEY = 'strada.pendingChange';
/** Long enough to prove a factor, short enough that a forgotten tab does not re-propose an old intent. */
const MAX_AGE_MS = 10 * 60 * 1000;

/** A user's group membership — the only change that is step-up gated today. */
export type PendingChange = {
  kind: 'user-groups';
  email: string;
  groups: string[];
  at: number;
};

export type PendingIntent = Omit<PendingChange, 'at'>;

export function rememberPendingChange(intent: PendingIntent): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...intent, at: Date.now() }));
  } catch {
    // A browser refusing storage costs the operator a retype, never a wrong write.
  }
}

/** Reads and CONSUMES the proposal: coming back twice must not re-propose it. */
export function takePendingChange(now: number = Date.now()): PendingChange | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingChange>;
    if (v.kind !== 'user-groups') return null;
    if (typeof v.email !== 'string' || !v.email) return null;
    if (!Array.isArray(v.groups) || v.groups.some((g) => typeof g !== 'string')) return null;
    if (typeof v.at !== 'number' || now - v.at > MAX_AGE_MS) return null;
    return { kind: 'user-groups', email: v.email, groups: v.groups, at: v.at };
  } catch {
    return null;
  }
}
