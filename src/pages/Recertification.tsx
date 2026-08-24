import { useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import {
  useGroups,
  useRecertCampaigns,
  useRecertCampaign,
  useCreateRecertCampaign,
  useActivateRecertCampaign,
  useCloseRecertCampaign,
  useDeleteRecertCampaign,
  useDecideRecertItem,
} from '../api/hooks';
import { api, type RecertCampaignSummary, type RecertItem, type RecertOnExpiry, type RecertStatus } from '../api/client';
import { I } from '../components/ui/Icons';
import { Chip, ConfirmDialog, EmptyHint, MultiSelectPills } from '../components/ui/Primitives';

// ─── Small helpers ────────────────────────────────────────────────────────────

const STATUS_TONE: Record<RecertStatus, string> = {
  draft: '', active: 'info', closing: 'warn', completed: 'ok', archived: '',
};

function fmtDate(s: string | undefined): string {
  return s ? new Date(s).toLocaleString() : '—';
}

function ProgressBar({ decided, total }: { decided: number; total: number }) {
  const pct = total > 0 ? Math.round((decided / total) * 100) : 0;
  return (
    <div title={`${decided}/${total} decided (${pct}%)`} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: pct === 100 ? 'var(--ok, #22c55e)' : 'var(--accent)' }} />
      </div>
      <span className="small muted mono">{decided}/{total}</span>
    </div>
  );
}

function decisionChip(item: RecertItem) {
  if (item.outcome === 'auto-revoked') return <Chip tone="err">auto-revoked</Chip>;
  if (item.outcome === 'flagged') return <Chip tone="warn">flagged</Chip>;
  if (item.decision === 'approved') return <Chip tone="ok">approved</Chip>;
  if (item.decision === 'revoked') return <Chip tone="err">revoked</Chip>;
  return <Chip>pending</Chip>;
}

// ─── Create form (phase 1: explicit reviewers, one-shot schedule) ────────────

function CreateCampaign({ onDone }: { onDone: () => void }) {
  const { pushToast } = useApp();
  const { data: groups } = useGroups();
  const create = useCreateRecertCampaign();

  const [name, setName] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [reviewers, setReviewers] = useState('');
  const [deadline, setDeadline] = useState('');
  const [onExpiry, setOnExpiry] = useState<RecertOnExpiry>('flag');

  // The default 'users' group is never revocable — not offered as scope.
  const groupOptions = useMemo(() => (groups ?? []).map((g) => g.name).filter((g) => g !== 'users').sort(), [groups]);
  const reviewerList = reviewers.split(/[,;\s]+/).map((r) => r.trim()).filter(Boolean);
  const valid = name.trim().length > 0 && reviewerList.length > 0 && !!deadline;

  async function submit() {
    try {
      const campaign = await create.mutateAsync({
        name: name.trim(),
        scope: selectedGroups.length > 0 ? { groups: selectedGroups } : undefined,
        reviewers: reviewerList,
        deadline: new Date(deadline).toISOString(),
        onExpiry,
      });
      pushToast('Campaign created (draft)', { sub: campaign.name });
      onDone();
    } catch (e: any) {
      pushToast(e.message || 'Could not create campaign', { err: true });
    }
  }

  return (
    <div className="panel mb-12" style={{ padding: 16 }}>
      <div className="panel-head" style={{ padding: 0, marginBottom: 12 }}>
        <div><h3>New campaign</h3><span className="small muted">One review item per (user, group) in scope · explicit reviewers · one-shot</span></div>
      </div>
      <div style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
        <label className="small">
          <div className="muted" style={{ marginBottom: 4 }}>Name</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 access review" style={{ width: '100%' }} />
        </label>
        <div className="small">
          <div className="muted" style={{ marginBottom: 4 }}>Groups in scope <span className="muted">(none selected = all groups; the default 'users' group is never revocable)</span></div>
          <MultiSelectPills
            options={groupOptions}
            selected={selectedGroups}
            onToggle={(g: string) => setSelectedGroups((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))}
            empty="No groups defined."
          />
        </div>
        <label className="small">
          <div className="muted" style={{ marginBottom: 4 }}>Reviewers (emails, comma-separated)</div>
          <input className="input" value={reviewers} onChange={(e) => setReviewers(e.target.value)} placeholder="alice@example.com, bob@example.com" style={{ width: '100%' }} />
        </label>
        <label className="small">
          <div className="muted" style={{ marginBottom: 4 }}>Deadline</div>
          {/* min = tomorrow: jinbe rejects past deadlines (the hourly sweep would
              close the campaign before anyone could review). */}
          <input className="input" type="date" min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <div className="small">
          <div className="muted" style={{ marginBottom: 4 }}>On expiry — what happens to items still pending at the deadline</div>
          <label style={{ marginRight: 16, cursor: 'pointer' }}>
            <input type="radio" name="onExpiry" checked={onExpiry === 'flag'} onChange={() => setOnExpiry('flag')} /> Flag <span className="muted">(mark for follow-up, membership untouched)</span>
          </label>
          <label style={{ cursor: 'pointer' }}>
            <input type="radio" name="onExpiry" checked={onExpiry === 'revoke'} onChange={() => setOnExpiry('revoke')} /> Revoke <span className="muted">(remove the group membership)</span>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" disabled={!valid || create.isPending} onClick={submit}>Create draft</button>
          <button className="btn ghost" onClick={onDone}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Campaign detail (items table + decisions + report) ──────────────────────

function CampaignDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { pushToast } = useApp();
  const { data, isLoading } = useRecertCampaign(id);
  const decide = useDecideRecertItem(id);
  const close = useCloseRecertCampaign();
  const [revokeTarget, setRevokeTarget] = useState<RecertItem | null>(null);
  const [revokeComment, setRevokeComment] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  const campaign = data?.campaign;
  const items = data?.items ?? [];
  const decided = items.filter((i) => i.decision !== 'pending').length;

  async function approve(item: RecertItem) {
    try {
      await decide.mutateAsync({ itemId: item.id, decision: 'approved' });
      pushToast('Approved', { sub: `${item.subject} keeps '${item.entitlement.group}'` });
    } catch (e: any) {
      pushToast(e.message || 'Decision failed', { err: true });
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    if (!revokeComment.trim()) {
      pushToast('A comment is required when revoking', { err: true });
      return;
    }
    try {
      await decide.mutateAsync({ itemId: revokeTarget.id, decision: 'revoked', comment: revokeComment.trim() });
      pushToast('Revoked — membership removed', { sub: `${revokeTarget.subject} · ${revokeTarget.entitlement.group}`, err: false });
    } catch (e: any) {
      pushToast(e.message || 'Revoke failed', { err: true });
    } finally {
      setRevokeTarget(null);
      setRevokeComment('');
    }
  }

  async function doClose() {
    try {
      await close.mutateAsync(id);
      pushToast('Campaign closed — report frozen');
    } catch (e: any) {
      pushToast(e.message || 'Close failed', { err: true });
    } finally {
      setConfirmClose(false);
    }
  }

  async function downloadReport() {
    try {
      await api.downloadRecertReport(id);
    } catch (e: any) {
      pushToast(e.message || 'Report unavailable', { err: true });
    }
  }

  if (isLoading || !campaign) return <EmptyHint>Loading campaign…</EmptyHint>;

  return (
    <>
      <div className="panel mb-12" style={{ padding: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost sm" onClick={onBack}>← Back</button>
          <h3 style={{ margin: 0 }}>{campaign.name}</h3>
          <Chip tone={STATUS_TONE[campaign.status]}>{campaign.status}</Chip>
          <Chip>{campaign.onExpiry === 'revoke' ? 'auto-revoke at deadline' : 'flag at deadline'}</Chip>
          <span className="small muted">deadline {fmtDate(campaign.deadline)}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <ProgressBar decided={decided} total={items.length} />
            {campaign.status === 'active' && (
              <button className="btn sm" onClick={() => setConfirmClose(true)} disabled={close.isPending}>Close now</button>
            )}
            {campaign.status === 'completed' && (
              <button className="btn sm" onClick={downloadReport}>
                <span style={{ width: 13, height: 13, display: 'inline-grid', placeItems: 'center', marginRight: 6 }}>{I.download}</span>
                Report (JSON)
              </button>
            )}
          </span>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Scope: {campaign.scope.groups?.length ? campaign.scope.groups.join(', ') : 'all groups'} · Reviewers: {campaign.reviewers.join(', ')}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><div><h3>Review items</h3><span className="small muted">approve keeps the membership · revoke removes it immediately (comment required)</span></div></div>
        <table className="table">
          <thead><tr><th>Subject</th><th>Group</th><th>Context</th><th>Reviewer</th><th>Decision</th><th style={{ width: 170 }}></th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6}><span className="small muted">No items — activate the campaign to generate them.</span></td></tr>}
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono small">{item.subject}</td>
                <td><Chip>{item.entitlement.group}</Chip></td>
                <td>
                  {item.context.tier != null && <Chip tone={item.context.tier <= 1 ? 'err' : 'warn'}>T{item.context.tier}</Chip>}
                  {item.context.flags.map((f) => <Chip key={f} tone={f === 'self-review' ? 'err' : ''}>{f}</Chip>)}
                </td>
                <td className="mono small">{item.reviewer}</td>
                <td>
                  {decisionChip(item)}
                  {item.decidedBy && <div className="small muted">by {item.decidedBy} · {fmtDate(item.decidedAt)}</div>}
                  {item.comment && <div className="small muted" title={item.comment}>“{item.comment}”</div>}
                </td>
                <td>
                  {campaign.status === 'active' && item.decision === 'pending' && (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button className="btn ghost sm" onClick={() => approve(item)} disabled={decide.isPending}>Approve</button>
                      <button className="btn ghost sm danger" onClick={() => { setRevokeTarget(item); setRevokeComment(''); }} disabled={decide.isPending}>Revoke</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke this membership?"
        danger
        confirmLabel="Revoke now"
        blastRadius={<>Removes <b>{revokeTarget?.subject}</b> from <span className="mono">{revokeTarget?.entitlement.group}</span> in Kratos immediately — it does not wait for the deadline.</>}
        body={
          <label className="small" style={{ display: 'block' }}>
            <div className="muted" style={{ marginBottom: 4 }}>Comment (required)</div>
            <textarea
              className="input"
              rows={3}
              value={revokeComment}
              onChange={(e) => setRevokeComment(e.target.value)}
              placeholder="Why this access is being revoked…"
              style={{ width: '100%' }}
            />
          </label>
        }
        busy={decide.isPending}
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />

      <ConfirmDialog
        open={confirmClose}
        title="Close this campaign now?"
        danger={campaign.onExpiry === 'revoke'}
        confirmLabel="Close campaign"
        blastRadius={
          campaign.onExpiry === 'revoke'
            ? <>All {items.length - decided} pending item(s) will be AUTO-REVOKED (memberships removed in Kratos), then the completion report is frozen.</>
            : <>All {items.length - decided} pending item(s) will be flagged for follow-up, then the completion report is frozen.</>
        }
        body={<>Closing <b>{campaign.name}</b>.</>}
        busy={close.isPending}
        onConfirm={doClose}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  );
}

// ─── Page: list + create + detail ─────────────────────────────────────────────

export function RecertificationPage() {
  const { pushToast } = useApp();
  const { data: campaigns, isLoading } = useRecertCampaigns();
  const activate = useActivateRecertCampaign();
  const del = useDeleteRecertCampaign();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecertCampaignSummary | null>(null);

  async function doActivate(c: RecertCampaignSummary) {
    try {
      const r = await activate.mutateAsync(c.id);
      pushToast('Campaign activated', { sub: `${r.itemCount} review item(s) generated` });
    } catch (e: any) {
      pushToast(e.message || 'Activation failed', { err: true });
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    try {
      await del.mutateAsync(deleteTarget.id);
      pushToast('Campaign deleted', { sub: deleteTarget.name });
    } catch (e: any) {
      pushToast(e.message || 'Delete failed', { err: true });
    } finally {
      setDeleteTarget(null);
    }
  }

  if (openId) {
    return (
      <>
        <div className="page-head">
          <h1>Recertification</h1>
          <div className="sub">Periodic access reviews — decide who keeps what, with deadline and consequence.</div>
        </div>
        <CampaignDetail id={openId} onBack={() => setOpenId(null)} />
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Recertification</h1>
        <div className="sub">Periodic access reviews — decide who keeps what, with deadline and consequence (ISO 27001 A.9.2.5 / SOC 2 CC6.2–CC6.3).</div>
      </div>

      {creating
        ? <CreateCampaign onDone={() => setCreating(false)} />
        : (
          <div className="panel mb-12" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="small muted">Campaigns generate one review item per (user, group) in scope; reviewer-approved revokes apply immediately.</span>
            <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}>
              <span style={{ width: 13, height: 13, display: 'inline-grid', placeItems: 'center', marginRight: 6 }}>{I.plus}</span>
              New campaign
            </button>
          </div>
        )}

      <div className="panel">
        <div className="panel-head"><div><h3>Campaigns</h3></div></div>
        <table className="table">
          <thead><tr><th>Name</th><th>Status</th><th>Scope</th><th>Deadline</th><th>Progress</th><th style={{ width: 220 }}></th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6}><span className="small muted">Loading…</span></td></tr>}
            {!isLoading && (campaigns ?? []).length === 0 && (
              <tr><td colSpan={6}><span className="small muted">No campaigns yet — create one to start a review cycle.</span></td></tr>
            )}
            {(campaigns ?? []).map((c) => (
              <tr key={c.id}>
                <td><a style={{ cursor: 'pointer', fontWeight: 500 }} onClick={() => setOpenId(c.id)}>{c.name}</a></td>
                <td><Chip tone={STATUS_TONE[c.status]}>{c.status}</Chip></td>
                <td className="small muted">{c.scope.groups?.length ? c.scope.groups.join(', ') : 'all groups'}</td>
                <td className="small">{fmtDate(c.deadline)}</td>
                <td><ProgressBar decided={c.decidedCount} total={c.itemCount} /></td>
                <td>
                  <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {c.status === 'draft' && <button className="btn sm" onClick={() => doActivate(c)} disabled={activate.isPending}>Activate</button>}
                    {c.status === 'draft' && <button className="btn ghost sm" onClick={() => setDeleteTarget(c)}>Delete</button>}
                    {c.status === 'completed' && (
                      <button className="btn ghost sm" onClick={() => api.downloadRecertReport(c.id).catch((e: any) => pushToast(e.message, { err: true }))}>Report</button>
                    )}
                    <button className="btn ghost sm" onClick={() => setOpenId(c.id)}>Open</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this draft campaign?"
        danger
        confirmLabel="Delete"
        body={<>Deleting <b>{deleteTarget?.name}</b>. Drafts have no items or report — nothing else is affected.</>}
        busy={del.isPending}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
