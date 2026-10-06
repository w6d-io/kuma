import { useState } from 'react';
import { Button, Callout, ConfirmDialog, Drawer, I } from '../ui';
import { isNotAvailable } from '../../api/orgAccess';
import { refusedGrantsOf, useAddGrants, useRemoveGrant, useUserGrants, type RefusedGrant } from '../../api/grants';
import { stepUpOnRefusal } from '../../lib/resume';
import { describeApiError } from '../../lib/apiError';
import { grantLabel, type Grant, type GrantDraft } from '../../lib/grants';
import { GrantPicker } from './GrantPicker';
import { GrantsList } from './GrantsList';
import { RefusedGrants } from './RefusedGrants';
import type { useApp } from '../../contexts/AppContext';

type PushToast = ReturnType<typeof useApp>['pushToast'];

/**
 * One person's individual access: single roles and permissions given to them beside their groups (or
 * their org roles), each with its reason, who granted it, and its countdown. `org` scopes it to one
 * organization (org user management); without it, the platform and every org they are in.
 */
export function IndividualAccess({ userId, who, org, orgName, mayGrant, pushToast, fromGroups }: {
  userId: string;
  /** The person's platform groups: what they give shows ticked and locked when adding. */
  fromGroups?: readonly string[];
  who: string;
  org?: string;
  orgName?: (org: string | undefined) => string;
  /** May add and remove (jinbe still applies the holding rule to each grant). */
  mayGrant: boolean;
  pushToast: PushToast;
}) {
  const q = useUserGrants(userId, org);
  const remove = useRemoveGrant(userId, org);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Grant | null>(null);
  const missing = isNotAvailable(q.error);

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.id);
      pushToast(`Removed ${grantLabel(removing)} from ${who}`);
      setRemoving(null);
    } catch (e) {
      if (stepUpOnRefusal(e, pushToast, { redo: `Remove ${grantLabel(removing)} from ${who} again: nothing was removed before the check.` })) return;
      pushToast('The grant was not removed', { err: true, sub: describeApiError(e).detail });
    }
  };

  return (
    <section aria-labelledby={`grants-${userId}`} className="stack gap-8">
      <div className="row justify-between items-center gap-8">
        <div>
          <h3 id={`grants-${userId}`} className="m-0 text-base">Individual access</h3>
          <div className="small muted">Single roles or permissions given to {who} directly{org ? ' in this organization' : ''}, beside {org ? 'their org roles' : 'their groups'}.</div>
        </div>
        {mayGrant && !missing && <Button size="sm" icon={I.plus} onClick={() => setAdding(true)}>Add individual access</Button>}
      </div>
      {missing
        ? <Callout tone="neutral" icon={I.info}>Individual access is not available yet on this server.</Callout>
        : q.isError
          ? <Callout tone="danger" icon={I.alert}>{describeApiError(q.error).detail}</Callout>
          : <GrantsList grants={q.data ?? []} loading={q.isLoading} orgName={org ? undefined : orgName} onRemove={mayGrant ? setRemoving : undefined} />}
      {adding && <AddGrantsDrawer userId={userId} who={who} org={org} fromGroups={fromGroups} pushToast={pushToast} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={!!removing}
        danger
        title={`Remove ${removing ? grantLabel(removing) : ''}?`}
        body={`${who} loses what it gave them, unless a group or role gives the same.`}
        confirmLabel="Remove"
        busy={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      />
    </section>
  );
}

/** Adds grants to one person: the picker, then jinbe's answer — refusals named one by one. */
export function AddGrantsDrawer({ userId, who, org, pushToast, onClose, fromGroups }: {
  userId: string; who: string; org?: string; pushToast: PushToast; onClose: () => void; fromGroups?: readonly string[];
}) {
  const add = useAddGrants(userId, org);
  const [drafts, setDrafts] = useState<GrantDraft[]>([]);
  const [valid, setValid] = useState(true);
  const [refused, setRefused] = useState<RefusedGrant[]>([]);

  const save = async () => {
    setRefused([]);
    try {
      await add.mutateAsync(drafts);
      pushToast(`Granted ${drafts.length === 1 ? grantLabel(drafts[0]) : `${drafts.length} grants`} to ${who}`, { sub: org ? 'Counts in this organization only.' : undefined });
      onClose();
    } catch (e) {
      const list = refusedGrantsOf(e);
      if (list.length) { setRefused(list); return; }
      if (stepUpOnRefusal(e, pushToast, { redo: `Grant individual access to ${who} again: nothing was granted before the check.` })) return;
      pushToast('Nothing was granted', { err: true, sub: describeApiError(e).detail });
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      eyebrow={org ? 'Organization · individual access' : 'Individual access'}
      title={`Give ${who} individual access`}
      footer={<>
        <span className="small muted">You may grant only what you hold yourself{org ? ' in this organization' : ''}.</span>
        <div className="row">
          <Button onClick={onClose} disabled={add.isPending}>Cancel</Button>
          <Button variant="primary" loading={add.isPending} disabled={drafts.length === 0 || !valid} onClick={save}>
            {drafts.length > 1 ? `Grant ${drafts.length}` : 'Grant'}
          </Button>
        </div>
      </>}
    >
      <div className="stack gap-12">
        <GrantPicker org={org} fromGroups={fromGroups} onChange={(d, ok) => { setDrafts(d); setValid(ok); }} />
        <RefusedGrants refused={refused} />
      </div>
    </Drawer>
  );
}
