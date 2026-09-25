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
import { MultiSelectPills } from '../components/ui/Primitives';
import { Badge, Button, ButtonBase, Card, ConfirmDialog, EmptyHint, EmptyRow, Field, I, Input, LoadingRows, RadioGroup, PageHeader, Table, Textarea, cx, type BadgeTone } from '../components/ui';

// ─── Small helpers ────────────────────────────────────────────────────────────

const STATUS_TONE: Record<RecertStatus, BadgeTone> = {
  draft: 'neutral', active: 'info', closing: 'warning', completed: 'success', archived: 'neutral',
};

function fmtDate(s: string | undefined): string {
  return s ? new Date(s).toLocaleString() : '—';
}

function ProgressBar({ decided, total }: { decided: number; total: number }) {
  const pct = total > 0 ? Math.round((decided / total) * 100) : 0;
  return (
    <div title={`${decided}/${total} decided (${pct}%)`} className="recert-progress">
      <progress className={cx(pct === 100 && 'done')} value={pct} max={100} aria-label={`${decided} of ${total} decided`} />
      <span className="small muted mono">{decided}/{total}</span>
    </div>
  );
}

function decisionChip(item: RecertItem) {
  if (item.outcome === 'auto-revoked') return <Badge tone="danger">auto-revoked</Badge>;
  if (item.outcome === 'flagged') return <Badge tone="warning">flagged</Badge>;
  if (item.decision === 'approved') return <Badge tone="success">approved</Badge>;
  if (item.decision === 'revoked') return <Badge tone="danger">revoked</Badge>;
  return <Badge>pending</Badge>;
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
    <Card title="New campaign" sub="One review item per (user, group) in scope · explicit reviewers · one-shot" className="mb-12">
      <div className="recert-form">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 access review" />
        </Field>
        <div className="field">
          <div className="field-label">Groups in scope <span className="muted">(none selected = all groups; the default 'users' group is never revocable)</span></div>
          <MultiSelectPills
            options={groupOptions}
            selected={selectedGroups}
            onToggle={(g: string) => setSelectedGroups((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))}
            empty="No groups defined."
          />
        </div>
        <Field label="Reviewers (emails, comma-separated)">
          <Input value={reviewers} onChange={(e) => setReviewers(e.target.value)} placeholder="alice@example.com, bob@example.com" />
        </Field>
        <Field label="Deadline">
          {/* min = tomorrow: jinbe rejects past deadlines (the hourly sweep would
              close the campaign before anyone could review). */}
          <Input type="date" className="w-auto" min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
        <div className="field">
          <div className="field-label">On expiry — what happens to items still pending at the deadline</div>
          <RadioGroup
            label="On expiry"
            name="onExpiry"
            className="recert-radios"
            value={onExpiry}
            onChange={setOnExpiry}
            options={[
              { value: 'flag', label: 'Flag', hint: 'mark for follow-up, membership untouched' },
              { value: 'revoke', label: 'Revoke', hint: 'remove the group membership' },
            ]}
          />
        </div>
        <div className="row">
          <Button variant="primary" disabled={!valid || create.isPending} onClick={submit}>Create draft</Button>
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
      </div>
    </Card>
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
      <Card pad="md" className="mb-12">
        <div className="row wrap">
          <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
          <h3 className="m-0">{campaign.name}</h3>
          <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</Badge>
          <Badge>{campaign.onExpiry === 'revoke' ? 'auto-revoke at deadline' : 'flag at deadline'}</Badge>
          <span className="small muted">deadline {fmtDate(campaign.deadline)}</span>
          <span className="row ml-auto">
            <ProgressBar decided={decided} total={items.length} />
            {campaign.status === 'active' && (
              <Button size="sm" onClick={() => setConfirmClose(true)} disabled={close.isPending}>Close now</Button>
            )}
            {campaign.status === 'completed' && (
              <Button size="sm" icon={I.download} onClick={downloadReport}>Report (JSON)</Button>
            )}
          </span>
        </div>
        <div className="small muted mt-8">
          Scope: {campaign.scope.groups?.length ? campaign.scope.groups.join(', ') : 'all groups'} · Reviewers: {campaign.reviewers.join(', ')}
        </div>
      </Card>

      <Card title="Review items" sub="approve keeps the membership · revoke removes it immediately (comment required)" pad="none">
        <Table>
          <thead><tr><th>Subject</th><th>Group</th><th>Context</th><th>Reviewer</th><th>Decision</th><th className="recert-col-decide"></th></tr></thead>
          <tbody>
            {items.length === 0 && <EmptyRow colSpan={6}>No items — activate the campaign to generate them.</EmptyRow>}
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono small">{item.subject}</td>
                <td><Badge>{item.entitlement.group}</Badge></td>
                <td>
                  {item.context.tier != null && <Badge tone={item.context.tier <= 1 ? 'danger' : 'warning'}>T{item.context.tier}</Badge>}
                  {item.context.flags.map((f) => <Badge key={f} tone={f === 'self-review' ? 'danger' : 'neutral'}>{f}</Badge>)}
                </td>
                <td className="mono small">{item.reviewer}</td>
                <td>
                  {decisionChip(item)}
                  {item.decidedBy && <div className="small muted">by {item.decidedBy} · {fmtDate(item.decidedAt)}</div>}
                  {item.comment && <div className="small muted" title={item.comment}>“{item.comment}”</div>}
                </td>
                <td>
                  {campaign.status === 'active' && item.decision === 'pending' && (
                    <span className="row gap-4">
                      <Button variant="ghost" size="sm" onClick={() => approve(item)} disabled={decide.isPending}>Approve</Button>
                      <Button variant="ghost" size="sm" className="recert-revoke" onClick={() => { setRevokeTarget(item); setRevokeComment(''); }} disabled={decide.isPending}>Revoke</Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke this membership?"
        danger
        confirmLabel="Revoke now"
        blastRadius={<>Removes <b>{revokeTarget?.subject}</b> from <span className="mono">{revokeTarget?.entitlement.group}</span> in Kratos immediately — it does not wait for the deadline.</>}
        body={
          <Field label="Comment (required)">
            <Textarea
              rows={3}
              value={revokeComment}
              onChange={(e) => setRevokeComment(e.target.value)}
              placeholder="Why this access is being revoked…"
            />
          </Field>
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
        <PageHeader title="Recertification" sub="Periodic access reviews — decide who keeps what, with deadline and consequence." />
        <CampaignDetail id={openId} onBack={() => setOpenId(null)} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Recertification" sub="Periodic access reviews — decide who keeps what, with deadline and consequence (ISO 27001 A.9.2.5 / SOC 2 CC6.2–CC6.3)." />

      {creating
        ? <CreateCampaign onDone={() => setCreating(false)} />
        : (
          <Card pad="sm" className="mb-12">
            <div className="row">
              <span className="small muted">Campaigns generate one review item per (user, group) in scope; reviewer-approved revokes apply immediately.</span>
              <Button variant="primary" className="ml-auto" icon={I.plus} onClick={() => setCreating(true)}>New campaign</Button>
            </div>
          </Card>
        )}

      <Card title="Campaigns" pad="none">
        <Table>
          <thead><tr><th>Name</th><th>Status</th><th>Scope</th><th>Deadline</th><th>Progress</th><th className="recert-col-actions"></th></tr></thead>
          <tbody>
            {isLoading && <LoadingRows rows={5} cols={6} />}
            {!isLoading && (campaigns ?? []).length === 0 && (
              <EmptyRow colSpan={6}>No campaigns yet — create one to start a review cycle.</EmptyRow>
            )}
            {(campaigns ?? []).map((c) => (
              <tr key={c.id}>
                <td><ButtonBase className="fw-medium" onClick={() => setOpenId(c.id)}>{c.name}</ButtonBase></td>
                <td><Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge></td>
                <td className="small muted">{c.scope.groups?.length ? c.scope.groups.join(', ') : 'all groups'}</td>
                <td className="small">{fmtDate(c.deadline)}</td>
                <td><ProgressBar decided={c.decidedCount} total={c.itemCount} /></td>
                <td>
                  <span className="row gap-4 justify-end">
                    {c.status === 'draft' && <Button size="sm" onClick={() => doActivate(c)} disabled={activate.isPending}>Activate</Button>}
                    {c.status === 'draft' && <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(c)}>Delete</Button>}
                    {c.status === 'completed' && (
                      <Button variant="ghost" size="sm" onClick={() => api.downloadRecertReport(c.id).catch((e: any) => pushToast(e.message, { err: true }))}>Report</Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setOpenId(c.id)}>Open</Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

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
