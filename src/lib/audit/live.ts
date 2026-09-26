import type { AuditEventV1 } from '../../api/audit';

/**
 * The live tail's bookkeeping. jinbe caps a tail at 15 minutes and one per user; the console stops
 * itself at the same mark and says so, rather than leaving a stream that silently went quiet.
 */
export const LIVE_MAX_MS = 15 * 60_000;
export const LIVE_POLL_MS = 10_000;
export const LIVE_CAP = 500;

/** New events on top, duplicates (by event_id) dropped, newest first, at most `cap`. */
export function mergeLive(existing: AuditEventV1[], incoming: AuditEventV1[], cap = LIVE_CAP): AuditEventV1[] {
  const seen = new Set(existing.map((e) => e.event_id));
  const fresh = incoming.filter((e) => e && e.event_id && !seen.has(e.event_id) && (seen.add(e.event_id), true));
  if (!fresh.length) return existing;
  return [...fresh, ...existing].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, cap);
}

/** One SSE `data:` payload: an event, a batch, or nothing usable. */
export function parseTailMessage(data: string): AuditEventV1[] {
  try {
    const v = JSON.parse(data);
    const list = Array.isArray(v) ? v : Array.isArray(v?.events) ? v.events : [v];
    return list.filter((e: unknown): e is AuditEventV1 =>
      !!e && typeof (e as AuditEventV1).event_id === 'string' && typeof (e as AuditEventV1).ts === 'string');
  } catch { return []; }
}

export function liveExpired(startedAt: number, now: number = Date.now()): boolean {
  return now - startedAt >= LIVE_MAX_MS;
}
