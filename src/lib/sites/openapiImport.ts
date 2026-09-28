import type { Access } from './types';
import type { ImportDecision, ImportPreview, ImportRow, RiskLevel } from '../../api/siteImport';
import { edgeBlocked } from '../apiError';

/**
 * The OpenAPI import screen's logic, kept pure: what a person may choose on each proposed route,
 * the decisions sent to jinbe, and what still stands between them and the commit.
 *
 * The owner's rule: every HIGH-risk row is confirmed one by one (a tick on the row), never in bulk.
 * jinbe enforces the same at commit (`risk_unconfirmed`); here it disables the button first, so the
 * refusal is never the way somebody learns about a row.
 */

/** What a person picks for a row. `proposed` leaves jinbe's proposal as it is. */
export type Choice = 'proposed' | 'suggested' | 'public' | 'signed-in' | 'permission' | 'deny' | 'skip' | 'remove';
export interface RowPick { choice: Choice; permission?: string; confirm?: boolean }
export type Picks = Record<string, RowPick>;

/** The spec's size limit (jinbe LIMITS.bytes), checked before anything is sent. */
export const MAX_SPEC_BYTES = 5 * 1024 * 1024;
/** jinbe reads at most this many operations. */
export const MAX_OPERATIONS = 2000;

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
export function rowRisk(row: ImportRow): RiskLevel | null {
  return row.risk.reduce<RiskLevel | null>((m, f) => (m === null || RANK[f.level] > RANK[m] ? f.level : m), null);
}

/** A row that only reports: the spec's operation cannot be imported, or a hand-written route keeps it. */
export function readOnlyRow(row: ImportRow): boolean {
  return row.status === 'unsupported' || row.status === 'manual';
}

/** A route the spec no longer has: proposed as refused (deny), or removed on request. */
export function goneRow(row: ImportRow): boolean {
  return row.source === 'removed';
}

/** The choices a row offers, in the order the menu lists them. */
export function choicesFor(row: ImportRow): Choice[] {
  if (readOnlyRow(row)) return [];
  if (goneRow(row)) return ['proposed', 'remove'];
  return ['proposed', ...(row.suggestion?.access ? ['suggested' as const] : []), 'permission', 'signed-in', 'public', 'deny', 'skip'];
}

export const CHOICE_LABEL: Record<Choice, string> = {
  proposed: 'As proposed',
  suggested: 'As the spec asks',
  permission: 'Needs permission',
  'signed-in': 'Signed-in',
  public: 'Public',
  deny: 'Refused',
  skip: 'Don’t import',
  remove: 'Remove the route',
};

const lowers = (a: Access | undefined) => a?.kind === 'public' || a?.kind === 'signed-in';

/** The access a pick asks for, when it asks for one. */
export function pickedAccess(row: ImportRow, pick: RowPick | undefined): Access | undefined {
  switch (pick?.choice) {
    case 'suggested': return row.suggestion?.access;
    case 'public': return { kind: 'public' };
    case 'signed-in': return { kind: 'signed-in' };
    case 'deny': return { kind: 'deny' };
    case 'permission': return { kind: 'permission', permission: (pick.permission ?? '').trim() };
    default: return undefined;
  }
}

/**
 * Whether the row needs its own tick before the commit: a high-risk proposal left standing, or a
 * pick that lowers protection (public, signed-in). Refusing, skipping or removing needs none.
 */
export function needsTick(row: ImportRow, pick: RowPick | undefined): boolean {
  const c = pick?.choice ?? 'proposed';
  if (c === 'deny' || c === 'skip' || c === 'remove') return false;
  return !!row.needsConfirm || lowers(pickedAccess(row, pick));
}

/** The decisions sent with the preview and the commit: only rows a person acted on. */
export function toDecisions(rows: readonly ImportRow[], picks: Picks): ImportDecision[] {
  const out: ImportDecision[] = [];
  for (const row of rows) {
    const pick = picks[row.op];
    if (!pick) continue;
    const confirm = pick.confirm && needsTick(row, pick) ? { confirm: true } : {};
    const access = pickedAccess(row, pick);
    if (pick.choice === 'skip') out.push({ op: row.op, skip: true });
    else if (pick.choice === 'remove') out.push({ op: row.op, remove: true });
    else if (access) out.push({ op: row.op, access, ...(pick.choice === 'suggested' && row.suggestion?.gate ? { gate: row.suggestion.gate } : {}), ...confirm });
    else if (confirm.confirm) out.push({ op: row.op, confirm: true });
  }
  return out;
}

/** Codes a tick or a decision on the row settles here; any other blocking code needs a new check. */
const SETTLED_HERE = new Set(['risk_unconfirmed', 'confirmation_required', 'unmapped']);
const PERMISSION = /^[a-z][a-z0-9_.-]*:[a-z*][a-z0-9_*-]*$/;

export type RowState =
  | { kind: 'ok' }
  | { kind: 'confirm' }
  | { kind: 'decide'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'blocked'; message: string }
  | { kind: 'recheck'; message: string };

/**
 * What a row still needs, given the picks: nothing, its tick, a decision, or a new check. `changed`:
 * the pick differs from the one the last preview saw — only a new check can say whether that
 * settled a conflict jinbe found (two operations on one route, an unknown gate…).
 */
export function rowState(row: ImportRow, pick: RowPick | undefined, acceptDenied: boolean, changed = false): RowState {
  const access = pickedAccess(row, pick);
  if (access?.kind === 'permission' && !PERMISSION.test(access.permission)) return { kind: 'invalid', message: 'A permission looks like resource:verb.' };
  if (needsTick(row, pick) && !pick?.confirm) return { kind: 'confirm' };
  const code = row.blocking?.code;
  if (code === 'unmapped' && (pick?.choice ?? 'proposed') === 'proposed' && !acceptDenied) {
    return { kind: 'decide', message: 'No permission could be worked out from the spec: pick an access, or leave it refused.' };
  }
  if (code && !SETTLED_HERE.has(code)) {
    return changed
      ? { kind: 'recheck', message: 'Changed since the last check: check again to see whether this settles it.' }
      : { kind: 'blocked', message: row.blocking!.message };
  }
  return { kind: 'ok' };
}

export type Filter = 'all' | 'attention' | 'high' | 'changes' | 'kept';
export const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs you' },
  { value: 'high', label: 'High risk' },
  { value: 'changes', label: 'Changes' },
  { value: 'kept', label: 'Unchanged' },
];

export function matchesFilter(row: ImportRow, f: Filter, state: RowState): boolean {
  switch (f) {
    case 'all': return true;
    case 'attention': return state.kind !== 'ok';
    case 'high': return rowRisk(row) === 'high';
    case 'changes': return row.status === 'added' || row.status === 'changed' || row.status === 'removed';
    case 'kept': return !['added', 'changed', 'removed'].includes(row.status);
  }
}

export function matchesSearch(row: ImportRow, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return [row.op, row.operationId, row.specPath, row.route?.path, row.method].some((s) => s?.toLowerCase().includes(q));
}

/** Everything that keeps the commit disabled, counted, with the import-wide refusals. */
export function commitBlockers(preview: ImportPreview, picks: Picks, acceptDenied: boolean, checked: Picks = {}) {
  const counts = { confirm: 0, decide: 0, invalid: 0, blocked: 0, recheck: 0 };
  for (const row of preview.rows) {
    const s = rowState(row, picks[row.op], acceptDenied, pickChanged(picks[row.op], checked[row.op]));
    if (s.kind !== 'ok') counts[s.kind]++;
  }
  const global = preview.blocking.filter((b) => b.op === '*');
  return { ...counts, global, total: counts.confirm + counts.decide + counts.invalid + counts.blocked + counts.recheck + global.length };
}

/** Whether a row's pick is not the one the last preview was sent (the tick aside). */
export function pickChanged(now: RowPick | undefined, then: RowPick | undefined): boolean {
  const key = (p: RowPick | undefined) => (p && p.choice !== 'proposed' ? `${p.choice}:${p.choice === 'permission' ? (p.permission ?? '').trim() : ''}` : 'proposed');
  return key(now) !== key(then);
}

/** What the import will write, as the preview counted it, in one line. */
export function countsLine(c: Partial<Record<string, number>>): string {
  const parts = [
    c.added ? `${c.added} added` : '',
    c.changed ? `${c.changed} changed` : '',
    c.removed ? `${c.removed} refused (gone from the spec)` : '',
    c.unchanged ? `${c.unchanged} unchanged` : '',
    c.pinned ? `${c.pinned} kept as you edited them` : '',
    c.skipped ? `${c.skipped} not imported` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'nothing to change';
}

/** A refused preview or commit, in words that say what to do. */
export function describeImportError(err: unknown): string {
  const e = err as { status?: number; code?: string; message?: string; details?: { checks?: unknown[] } };
  // A spec is full of paths and examples a firewall can take for an attack.
  if (edgeBlocked(err)) {
    return 'The web firewall stopped the upload: something in the document looked like an attack to it. Do not send the same document again — repeated blocks ban your address for 4 hours. Ask an administrator to look at the firewall log.';
  }
  switch (e.code) {
    case 'spec_not_previewed': return 'This document was not previewed for this site in the last 24 hours. Preview it again.';
    case 'stale_base': return 'The draft changed since the preview — an edit, or another import. Preview again to map the routes onto it.';
    case 'import_blocked': return `${e.details?.checks?.length ?? 'Some'} row${e.details?.checks?.length === 1 ? '' : 's'} still need a decision. They are marked in the table.`;
    case 'draft_too_large': return `${e.message ?? 'The draft would be too large'}. Import fewer operations, or skip some.`;
    case 'url_import_disabled': return 'Importing by URL is not available yet. Upload the file or paste its content.';
    case 'import_busy': return 'Other imports are being read right now. Try again in a moment.';
  }
  if (e.status === 429) return 'Too many previews in a minute (10 at most). Wait a moment, then try again.';
  if (e.status === 422 && e.code) return `The document could not be read: ${e.message ?? e.code}`;
  if (e.status === 404) return 'This server cannot import OpenAPI documents yet.';
  if (e.status === 403) return 'Importing routes needs a super admin.';
  if (e.status === 503) return 'A service the import needs did not answer, so nothing was changed. Try again in a moment.';
  return e.message || 'The request failed.';
}
