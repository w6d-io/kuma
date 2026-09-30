import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Callout, Card, ConfirmDialog, Dialog, EmptyState, Field, I, PageHeader, SkeletonText, Textarea, Timeline } from '../../components/ui';
import { notAvailable, sitesApi, siteKeys } from '../../api/sites';
import { askedByMe, deletionTrail } from '../../lib/sites/lifecycle';
import { goSites, sitesHref } from '../../lib/sites/route';
import { timeAgo } from '../../lib/sites/format';
import type { DeletionRequest } from '../../lib/sites/types';
import { QueryError } from './parts';
import { useSiteAction } from './useAction';
import { useSitePerms } from './usePerms';

/**
 * Deletion requests (wave 19). Somebody who may change a site but not delete it asks; a person
 * holding sites:delete — never the one who asked, never through a key — approves, which deletes the
 * site as they would (rules first, then its permissions, a snapshot kept 30 days), or rejects with a
 * reason. The requester sees their request waiting, without the buttons. Everything is audited; each
 * request carries its own trail.
 */

const STATE: Record<DeletionRequest['state'], { tone: 'warning' | 'danger' | 'neutral'; word: string }> = {
  pending: { tone: 'warning', word: 'Waiting' },
  approved: { tone: 'danger', word: 'Deleted' },
  rejected: { tone: 'neutral', word: 'Rejected' },
  cancelled: { tone: 'neutral', word: 'Cancelled' },
};

function useInvalidateDeletions() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: siteKeys.deletions() }); void qc.invalidateQueries({ queryKey: siteKeys.list() }); };
}

/** Approve (a deletion, typed name to confirm) and Reject (an optional reason) — or why not, for the requester. */
function Decide({ r, onDeleted }: { r: DeletionRequest; onDeleted?: () => void }) {
  const perms = useSitePerms();
  const { run, busy } = useSiteAction();
  const invalidate = useInvalidateDeletions();
  const [open, setOpen] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  if (!perms.canDelete) return null;
  if (askedByMe(r, perms)) return <span className="small muted">You asked — someone else decides.</span>;
  const approve = async () => {
    const out = await run('Approve', () => sitesApi.approveDeletion(r.id), `${r.site} deleted — a snapshot is kept for 30 days`, { redo: `approve the deletion of ${r.site} again.` });
    setOpen(null);
    invalidate();
    if (out) onDeleted?.();
  };
  const reject = async () => {
    const out = await run('Reject', () => sitesApi.rejectDeletion(r.id, reason.trim() || undefined), `Deletion of ${r.site} rejected`, { redo: `reject the deletion of ${r.site} again.` });
    if (out) { setOpen(null); setReason(''); }
    invalidate();
  };
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen('reject')}>Reject</Button>
      <Button size="sm" variant="danger" icon={I.trash} onClick={() => setOpen('approve')}>Approve &amp; delete</Button>
      <ConfirmDialog
        open={open === 'approve'}
        title={`Delete ${r.site}?`}
        danger
        requireText={r.site}
        confirmLabel="Approve & delete"
        busy={busy === 'Approve'}
        body={<p className="m-0">{r.requestedBy} asked for this{r.reason ? `: “${r.reason}”` : '.'} Approving deletes the site now, as you — the gateway rules first, then its permissions. A snapshot is kept for 30 days. Needs a recent second factor.</p>}
        onCancel={() => setOpen(null)}
        onConfirm={() => void approve()}
      />
      <Dialog
        open={open === 'reject'}
        onClose={() => setOpen(null)}
        title={`Reject the deletion of ${r.site}?`}
        footer={<>
          <Button onClick={() => setOpen(null)} disabled={busy === 'Reject'}>Cancel</Button>
          <Button variant="primary" loading={busy === 'Reject'} onClick={() => void reject()}>Reject</Button>
        </>}
      >
        <Field label="Reason" hint={`Optional. ${r.requestedBy} sees it, and it is kept in the audit trail.`}>
          <Textarea rows={2} maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Still used by the reporting team" />
        </Field>
      </Dialog>
    </>
  );
}

function Trail({ r }: { r: DeletionRequest }) {
  return (
    <Timeline items={deletionTrail(r).map((t) => ({
      id: t.id, label: t.label, state: t.state, detail: t.detail,
      meta: t.at ? <span title={new Date(t.at).toLocaleString()}>{timeAgo(t.at)}</span> : undefined,
    }))} />
  );
}

/** At the top of a site: a deletion waiting on it, and who may decide. Absent when none is. */
export function SiteDeletionPending({ name, onDeleted }: { name: string; onDeleted: () => void }) {
  const q = useQuery({ queryKey: [...siteKeys.deletions(), 'site', name], queryFn: () => sitesApi.deletionRequests({ site: name }), retry: false });
  const pending = (q.data ?? []).filter((r) => r.state === 'pending');
  return (
    <>
      {pending.map((r) => (
        <Callout
          key={r.id}
          tone="warning"
          icon={I.trash}
          className="mb-12"
          title={`${r.requestedBy} asks to delete this site`}
          actions={<Decide r={r} onDeleted={onDeleted} />}
        >
          {timeAgo(r.requestedAt)}{r.reason ? ` · “${r.reason}”` : ''}{r.requestedVia ? ' · asked through a key' : ''} · someone other than the requester, holding sites:delete, decides.
        </Callout>
      ))}
    </>
  );
}

/** Settings: ask for the deletion (without sites:delete), and every request made for this site with its trail. */
export function DeletionRequestsCard({ name, displayName }: { name: string; displayName: string }) {
  const perms = useSitePerms();
  const { run, busy } = useSiteAction();
  const invalidate = useInvalidateDeletions();
  const q = useQuery({ queryKey: [...siteKeys.deletions(), 'site', name], queryFn: () => sitesApi.deletionRequests({ site: name }), retry: false });
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  if (notAvailable(q.error)) return null;
  const all = q.data ?? [];
  const waiting = all.some((r) => r.state === 'pending');
  const canAsk = perms.canRequest && !perms.canDelete;
  if (!canAsk && all.length === 0) return null;

  const ask = async () => {
    const out = await run('Request deletion', () => sitesApi.requestDeletion(name, reason.trim() || undefined), 'Deletion requested — someone holding sites:delete decides');
    if (out) { setAsking(false); setReason(''); }
    invalidate();
  };

  return (
    <Card
      title="Deletion requests"
      sub={canAsk ? 'You cannot delete sites. Ask, and a person holding sites:delete decides.' : 'Asked by people who cannot delete sites; decided by somebody else.'}
      actions={canAsk && <Button variant="danger" size="sm" icon={I.trash} disabled={waiting} title={waiting ? 'A request is already waiting' : undefined} onClick={() => setAsking(true)}>Request deletion…</Button>}
    >
      {q.isLoading ? <SkeletonText lines={2} /> : q.error ? <QueryError error={q.error} what="deletion requests" /> : all.length === 0 ? (
        <p className="small muted m-0">No deletion was asked for.</p>
      ) : (
        <div className="stack gap-16">
          {all.map((r) => (
            <div key={r.id} className="stack gap-8">
              <div className="row gap-8 items-center wrap"><Badge tone={STATE[r.state].tone} mono={false}>{STATE[r.state].word}</Badge><span className="small muted mono">{r.id.slice(0, 8)}</span></div>
              <Trail r={r} />
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={`Ask to delete ${displayName}?`}
        footer={<>
          <Button onClick={() => setAsking(false)} disabled={busy === 'Request deletion'}>Cancel</Button>
          <Button variant="danger" loading={busy === 'Request deletion'} onClick={() => void ask()}>Request deletion</Button>
        </>}
      >
        <p className="small mt-0">Nothing is deleted now. Someone holding sites:delete — not you — approves or rejects it, and the site keeps running until then.</p>
        <Field label="Reason" hint="Optional, up to 280 characters. The approver sees it, and it is kept in the audit trail.">
          <Textarea rows={2} maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Demo finished" />
        </Field>
      </Dialog>
    </Card>
  );
}

/** The inbox (#/sites/deletion-requests): every deletion waiting on a decision, oldest first. */
export function DeletionInbox() {
  const q = useQuery({ queryKey: [...siteKeys.deletions(), 'pending'], queryFn: () => sitesApi.pendingDeletions(), retry: false });
  const list = q.data ?? [];
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow={<Button variant="ghost" size="sm" icon={I.caretLeft} onClick={() => goSites(sitesHref({ view: 'list' }))}>Sites</Button>}
        title="Deletion requests"
        sub="Sites somebody asked to delete. A person holding sites:delete, other than the one who asked, approves or rejects each."
      />
      {notAvailable(q.error) ? (
        <EmptyState icon={I.clock} title="Deletion requests are not available on this server yet">Update jinbe to a version with site deletion requests.</EmptyState>
      ) : q.error ? <QueryError error={q.error} what="deletion requests" /> : q.isLoading ? <Card pad="md"><SkeletonText lines={4} /></Card> : list.length === 0 ? (
        <EmptyState icon={I.check} title="Nothing waiting">No site is waiting to be deleted.</EmptyState>
      ) : (
        <div className="stack gap-12">
          {list.map((r) => (
            <Card
              key={r.id}
              title={<a href={sitesHref({ view: 'site', name: r.site, tab: 'settings' })} className="mono">{r.site}</a>}
              sub={`Asked ${timeAgo(r.requestedAt)} by ${r.requestedBy}${r.requestedVia ? ' through a key' : ''}`}
              actions={<Decide r={r} />}
            >
              <Trail r={r} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** On the Sites list: how many deletions wait, with the way to the inbox. Absent when none do. */
export function DeletionsWaiting() {
  const perms = useSitePerms();
  const q = useQuery({ queryKey: [...siteKeys.deletions(), 'pending'], queryFn: () => sitesApi.pendingDeletions(), retry: false, enabled: perms.canRead });
  const n = q.data?.length ?? 0;
  if (n === 0) return null;
  const mine = (q.data ?? []).filter((r) => askedByMe(r, perms)).length;
  return (
    <Callout
      tone="warning"
      icon={I.trash}
      className="mb-12"
      title={`${n} deletion request${n === 1 ? '' : 's'} waiting`}
      actions={<Button size="sm" onClick={() => goSites(sitesHref({ view: 'deletions' }))}>Open requests</Button>}
    >
      {perms.canDelete ? (mine === n ? 'You asked for all of them: someone else decides.' : 'You can approve or reject the ones you did not ask for.') : 'A person holding sites:delete decides.'}
    </Callout>
  );
}
