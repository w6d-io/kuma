import type { AuditEventV1 } from '../../api/audit';

/**
 * One person's timeline split three ways for the user drawer (audit-tab.md §5.1): what they did,
 * what was done to them, and their sign-ins. Keyed by Kratos id, so it survives an email change.
 */
export type TimelineSegment = 'did' | 'done' | 'logins';

export function segmentOf(e: AuditEventV1, userId: string): TimelineSegment | null {
  if (e.category === 'auth') return e.actor.id === userId || e.target?.id === userId ? 'logins' : null;
  if (e.actor.id === userId) return 'did';
  if (e.target?.id === userId) return 'done';
  return null;
}

export function splitTimeline(events: AuditEventV1[], userId: string): Record<TimelineSegment, AuditEventV1[]> {
  const out: Record<TimelineSegment, AuditEventV1[]> = { did: [], done: [], logins: [] };
  for (const e of events) {
    const s = segmentOf(e, userId);
    if (s) out[s].push(e);
  }
  return out;
}

const WINDOW = 30 * 86_400_000;

/** The k-th 30-day window back from `now` (0 = the latest). */
export function timelineWindow(k: number, now: number): { from: string; to: string } {
  return { from: new Date(now - WINDOW * (k + 1)).toISOString(), to: new Date(now - WINDOW * k).toISOString() };
}
