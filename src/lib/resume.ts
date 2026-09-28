import { useEffect, useRef } from 'react';
import { bounceToStepUp } from './stepUp';

/**
 * An action refused for want of a recent second factor (`reauth_required`), kept across the
 * step-up so it can be finished on the way back.
 *
 * The browser leaves for the sign-in site and comes back on a fresh page: whatever the operator had
 * clicked is gone with the old one, and every screen used to leave them believing it had gone
 * through. Each screen now names the action it was doing and what it needs to do it again; on the
 * way back the screen takes it and runs it again — once — when it is still valid (nothing changed
 * underneath), or says plainly what to redo. Every gate in jinbe runs again on that call.
 *
 * `sessionStorage`: it belongs to the one tab that was interrupted and must not outlive it.
 */

const PREFIX = 'kuma:resume:';
const REDO = 'kuma:resume-redo';
/** Long enough to prove a factor, short enough that a forgotten tab does not re-run an old intent. */
const MAX_AGE_MS = 10 * 60 * 1000;
/** A retry refused again this soon means the step-up did not give the level: stop, do not loop. */
const LOOP_MS = 60 * 1000;

type Stored = { data: unknown; at: number };

function store(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** Remembers `data` for `action`. False when the same action was resumed moments ago (a loop). */
export function rememberResume(action: string, data: unknown, now: number = Date.now()): boolean {
  const s = store();
  try {
    const last = Number(s?.getItem(`${PREFIX}${action}:resumed`) || 0);
    if (last && now - last < LOOP_MS) return false;
    s?.setItem(`${PREFIX}${action}`, JSON.stringify({ data, at: now } satisfies Stored));
  } catch {
    // A browser refusing storage costs the operator a redo, never a wrong write.
  }
  return true;
}

/** Reads and CONSUMES what was remembered for `action`: coming back twice must not run it twice. */
export function takeResume<T>(action: string, now: number = Date.now()): T | null {
  const s = store();
  let raw: string | null;
  try {
    raw = s?.getItem(`${PREFIX}${action}`) ?? null;
    if (!raw) return null;
    s?.removeItem(`${PREFIX}${action}`);
    s?.setItem(`${PREFIX}${action}:resumed`, String(now));
  } catch {
    return null;
  }
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v.at !== 'number' || now - v.at > MAX_AGE_MS || v.data === undefined) return null;
    return v.data as T;
  } catch {
    return null;
  }
}

/**
 * Remembers the action and sends the person to prove their second factor. False when it did not go
 * (no auth domain, or the same action already came back refused): the caller shows the refusal.
 */
export function stepUpAndResume(action: string, data: unknown): boolean {
  if (!rememberResume(action, data)) return false;
  return bounceToStepUp();
}

/**
 * For an action a screen cannot safely run again by itself (a delete, a cut-over, one whose form is
 * gone): the step-up still happens, and the page it comes back to says what to redo.
 */
export function stepUpAndAskToRedo(what: string): boolean {
  try { store()?.setItem(REDO, JSON.stringify({ data: what, at: Date.now() } satisfies Stored)); } catch { /* storage blocked */ }
  return bounceToStepUp();
}

/** What to ask the person to redo, consumed; null when nothing is waiting. */
export function takeRedo(now: number = Date.now()): string | null {
  const s = store();
  try {
    const raw = s?.getItem(REDO);
    if (!raw) return null;
    s?.removeItem(REDO);
    const v = JSON.parse(raw) as Partial<Stored>;
    return typeof v.data === 'string' && typeof v.at === 'number' && now - v.at <= MAX_AGE_MS ? v.data : null;
  } catch {
    return null;
  }
}

/**
 * Runs `handler` once with what `action` remembered, as soon as the screen is `ready` (its data
 * loaded, so it can tell whether the action is still valid). Nothing remembered: nothing happens.
 */
export function useResume<T>(action: string | null, ready: boolean, handler: (data: T) => void): void {
  const done = useRef<string | null>(null);
  const latest = useRef(handler);
  useEffect(() => { latest.current = handler; });
  useEffect(() => {
    if (!action || !ready || done.current === action) return;
    done.current = action;
    const data = takeResume<T>(action);
    if (data !== null) latest.current(data);
  }, [action, ready]);
}
