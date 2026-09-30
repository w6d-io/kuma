import { BULK_MAX_ITEMS, type BulkItemStatus, type BulkOutcome, type BulkPlan } from '../api/bulk';
import type { BadgeTone } from '../components/ui';
import { EDGE_BLOCKED, edgeBlocked } from './apiError';
import { emailError } from './profile';

/**
 * A bulk operation in the words the people screens show: what each item would do or did, and why a
 * plan or a run was refused. jinbe answers reasons as codes (`missing:users:recovery`,
 * `group_not_in_model:ops`); they are read here, once, so the preview and the progress agree.
 */

export type Invite = { email: string; name?: string };

/**
 * A pasted list of people: one per line or separated by commas or semicolons, each an address or
 * `Name <address>`. What is not an address comes back apart, and an address given twice counts once.
 */
export function parseInvites(text: string): { invites: Invite[]; invalid: string[]; tooMany: boolean } {
  const invites: Invite[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,;]+/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const named = entry.match(/^(.*)<([^<>]+)>$/);
    const email = (named ? named[2] : entry).trim().toLowerCase();
    const name = named?.[1].trim().replace(/^"(.*)"$/, '$1').trim();
    if (emailError(email)) { invalid.push(entry); continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    invites.push(name ? { email, name } : { email });
  }
  return { invites: invites.slice(0, BULK_MAX_ITEMS), invalid, tooMany: invites.length > BULK_MAX_ITEMS };
}

/** A reason code, split on its first colon: `missing:users:recovery` → missing, users:recovery. */
function split(reason: string): [string, string] {
  const at = reason.indexOf(':');
  return at < 0 ? [reason, ''] : [reason.slice(0, at), reason.slice(at + 1)];
}

/** Why an item was skipped, refused or failed, in a few words. Unknown codes are shown as they are. */
export function reasonText(reason: string | undefined): string {
  if (!reason) return '';
  const [code, rest] = split(reason);
  switch (code) {
    case 'already_verified': return 'Already verified';
    case 'already_exists': return 'Already has an account';
    case 'already_member': return 'Already in every group listed';
    case 'self_change': return 'Your own account — not from here';
    case 'not_found': return 'No such user';
    case 'unavailable': return 'Not available to you';
    case 'address_unavailable': return 'This address cannot be used';
    case 'duplicate': return 'Listed twice';
    case 'no_address': return 'Has no email address';
    case 'missing': return `Needs ${rest}`;
    case 'group_not_in_model': return `No group named ${rest}`;
    case 'step_up_unavailable': return `${rest} needs a second factor this sign-in cannot prove`;
    case 'invalid': return `Not valid: ${rest.split(':').slice(1).join(':') || rest}`;
    case 'rate_limited': return rest === 'caller' ? 'You reached 30 links this hour' : 'Three links in 15 minutes already';
    case 'verification_link_unavailable': return 'Kratos does not send verification links';
    case 'unknown_gate': return `No gate named ${rest}`;
    case 'pinned': return 'Pinned route — not changed by a bulk map';
    case 'same_route_as': return `Same path and method as ${rest}`;
    case 'unchanged': return 'Unchanged';
    case 'error': return 'Failed unexpectedly';
  }
  return reason;
}

/** What an item would do, from the plan's action code. */
export function actionText(action: string | undefined): string {
  if (!action) return '';
  const [code, rest] = split(action);
  switch (code) {
    case 'send': return 'Send the link';
    case 'create': return rest === 'invite_failed' ? 'Created · invite email not sent' : 'Create the account';
    case 'add': return rest ? `Add to ${rest.split(',').join(', ')}` : 'Add to the groups';
    case 'update': return 'Replace the route';
  }
  return action;
}

const OUTCOME: Record<BulkOutcome['status'], { tone: BadgeTone; label: string }> = {
  ok: { tone: 'success', label: 'will run' },
  skip: { tone: 'neutral', label: 'skip' },
  refused: { tone: 'danger', label: 'refused' },
  not_found: { tone: 'warning', label: 'not found' },
};

/** One planned item: its label and the line under it. */
export function outcomeView(o: BulkOutcome): { tone: BadgeTone; label: string; detail: string } {
  const detail = o.status === 'ok' ? actionText(o.action) : o.status === 'not_found' ? 'No such user' : reasonText(o.reason);
  return { ...OUTCOME[o.status], detail };
}

const STATUS: Record<BulkItemStatus, { tone: BadgeTone; label: string }> = {
  pending: { tone: 'neutral', label: 'waiting' },
  done: { tone: 'success', label: 'done' },
  skipped: { tone: 'neutral', label: 'skipped' },
  refused: { tone: 'danger', label: 'refused' },
  failed: { tone: 'danger', label: 'failed' },
};

export function jobItemView(item: { status: BulkItemStatus; action?: string; reason?: string }): { tone: BadgeTone; label: string; detail: string } {
  return { ...STATUS[item.status], detail: item.status === 'done' ? actionText(item.action) : reasonText(item.reason) };
}

/** A warning jinbe attaches to a whole plan (`caller_limit: …`), readable. */
export function warningText(w: string): string {
  if (w.startsWith('caller_limit')) return 'You can send at most 30 verification links an hour: the items beyond that will fail as rate-limited.';
  return w;
}

/**
 * Why planning or executing was refused. `replan` offers to plan again (an expired plan), `stepUp` to
 * confirm the caller's own second factor, and `plan` carries the new plan jinbe made when the old one
 * no longer holds.
 */
export type BulkFailure = { title: string; detail: string; replan?: boolean; stepUp?: boolean; plan?: BulkPlan };

export function bulkFailure(err: unknown): BulkFailure {
  const e = (err ?? {}) as { status?: number; code?: string; message?: string; details?: { plan?: BulkPlan } };
  switch (e.code) {
    case 'plan_changed':
      return {
        title: 'What this would do has changed',
        detail: 'Something changed since the preview, so nothing ran. Here is the new preview — check it and run it again.',
        plan: e.details?.plan,
      };
    case 'plan_hash_mismatch':
    case 'plan_not_found':
      return { title: 'This preview has expired', detail: 'Previews are kept for an hour. Nothing ran — preview again.', replan: true };
    case 'job_running':
      return { title: 'Already running', detail: 'This preview is being run already.' };
    case 'reauth_required':
      return {
        title: 'Confirm your own second factor first',
        detail: 'Adding people to groups needs your second factor proven in the last 15 minutes. Nothing ran.',
        stepUp: true,
      };
    case 'step_up_unavailable':
      return { title: 'Not possible with this sign-in', detail: 'Sign in to the console in a browser and try again there.' };
    case 'invalid_request':
      return { title: 'Not accepted', detail: e.message || 'The list is not valid.' };
  }
  if (edgeBlocked(err)) return { title: EDGE_BLOCKED.title, detail: EDGE_BLOCKED.detail };
  if (e.status === 403) return { title: 'Access denied', detail: 'Your roles do not include this action.' };
  return { title: 'Nothing ran', detail: e.message || 'The request failed.' };
}
