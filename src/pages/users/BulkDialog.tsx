import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bulkApi, type BulkJob, type BulkOp, type BulkPlan } from '../../api/bulk';
import { Badge, Button, Callout, Dialog, Meter, Stat, Table, type BadgeTone } from '../../components/ui';
import { I } from '../../components/ui/Icons';
import { bulkFailure, jobItemView, outcomeView, warningText, type BulkFailure } from '../../lib/bulk';
import { stepUpAndAskToRedo } from '../../lib/resume';

/** What one run sends: the items, the op's params, and a label per item for the tables. */
export interface BulkRequest {
  items: unknown[];
  params?: Record<string, unknown>;
  labels: string[];
}

type Phase =
  | { kind: 'compose' }
  | { kind: 'planning' }
  | { kind: 'preview'; plan: BulkPlan; changed?: boolean }
  | { kind: 'executing'; plan: BulkPlan }
  | { kind: 'running'; plan: BulkPlan; job: BulkJob }
  | { kind: 'error'; failure: BulkFailure; plan?: BulkPlan };

/**
 * A bulk change, in the order jinbe runs it: preview first (each item judged against your rights
 * now, nothing written), then run the preview as shown, then follow each item's result. What the
 * items are is the caller's `compose` step; without one, the preview starts as soon as it opens.
 *
 * A preview that no longer holds is never run: jinbe answers the new one, shown for another look.
 */
export function BulkDialog({ open, onClose, title, op, compose, ready = true, build, runLabel, redo, onFinished }: {
  open: boolean;
  onClose: () => void;
  title: string;
  op: BulkOp;
  /** The form that says what to do. Absent: nothing to choose, the preview starts at once. */
  compose?: ReactNode;
  /** The form is complete. */
  ready?: boolean;
  build: () => BulkRequest;
  /** The run button: "Send 12 links". */
  runLabel: (willRun: number) => string;
  /** What to ask the operator to redo after confirming their second factor. */
  redo: string;
  onFinished?: (job: BulkJob) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: compose ? 'compose' : 'planning' });
  const [request, setRequest] = useState<BulkRequest | null>(null);
  const finished = useRef<string | null>(null);

  const plan = async (req: BulkRequest) => {
    setRequest(req);
    setPhase({ kind: 'planning' });
    try {
      setPhase({ kind: 'preview', plan: await bulkApi.plan(op, req.items, req.params) });
    } catch (err) {
      setPhase({ kind: 'error', failure: bulkFailure(err) });
    }
  };

  useEffect(() => {
    if (!open) return;
    finished.current = null;
    if (compose) { setPhase({ kind: 'compose' }); setRequest(null); } else plan(build());
    // Opening starts over; `build` and `compose` are read at that moment only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const execute = async (p: BulkPlan) => {
    setPhase({ kind: 'executing', plan: p });
    try {
      setPhase({ kind: 'running', plan: p, job: await bulkApi.execute(op, p) });
    } catch (err) {
      const failure = bulkFailure(err);
      setPhase(failure.plan ? { kind: 'preview', plan: failure.plan, changed: true } : { kind: 'error', failure, plan: p });
    }
  };

  const jobId = phase.kind === 'running' ? phase.job.id : null;
  const jobQ = useQuery({
    queryKey: ['bulk-job', jobId],
    queryFn: () => bulkApi.job(jobId as string),
    enabled: !!jobId && phase.kind === 'running' && phase.job.state === 'running',
    refetchInterval: (q) => (q.state.data?.state === 'running' ? 1000 : false),
  });
  const job = phase.kind === 'running' ? (jobQ.data?.id === phase.job.id ? jobQ.data : phase.job) : null;
  useEffect(() => {
    if (job && job.state !== 'running' && finished.current !== job.id) {
      finished.current = job.id;
      onFinished?.(job);
    }
  }, [job, onFinished]);

  const labelOf = (index: number) => request?.labels[index] ?? `#${index + 1}`;
  const busy = phase.kind === 'planning' || phase.kind === 'executing';
  const willRun = phase.kind === 'preview' ? phase.plan.counts.ok : 0;

  const footer = (() => {
    switch (phase.kind) {
      case 'compose':
        return <><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => plan(build())} disabled={!ready}>Preview</Button></>;
      case 'planning':
      case 'executing':
        return <><Button onClick={onClose} disabled>Cancel</Button><Button variant="primary" loading>{phase.kind === 'planning' ? 'Checking…' : 'Starting…'}</Button></>;
      case 'preview':
        return <>
          {compose ? <Button onClick={() => setPhase({ kind: 'compose' })}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
          <Button variant="primary" onClick={() => execute(phase.plan)} disabled={willRun === 0}>{runLabel(willRun)}</Button>
        </>;
      case 'running':
        return <Button variant="primary" onClick={onClose}>{job?.state === 'running' ? 'Close — it keeps running' : 'Done'}</Button>;
      case 'error':
        return <>
          <Button onClick={onClose}>Close</Button>
          {phase.failure.replan && request && <Button variant="primary" onClick={() => plan(request)}>Preview again</Button>}
          {phase.failure.stepUp && <Button variant="primary" onClick={() => stepUpAndAskToRedo(redo)}>Confirm my second factor</Button>}
        </>;
    }
  })();

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} title={title} size="lg" footer={footer}>
      {phase.kind === 'compose' && compose}
      {phase.kind === 'planning' && <div className="small muted">Checking each item against your rights… nothing is changed yet.</div>}
      {(phase.kind === 'preview' || phase.kind === 'executing') && (
        <PlanView plan={phase.plan} changed={phase.kind === 'preview' && phase.changed} labelOf={labelOf} />
      )}
      {phase.kind === 'running' && job && <JobView job={job} labelOf={labelOf} />}
      {phase.kind === 'error' && (
        <Callout tone={phase.failure.stepUp ? 'warning' : 'danger'} icon={phase.failure.stepUp ? I.lock : I.alert} title={phase.failure.title}>
          {phase.failure.detail}
        </Callout>
      )}
    </Dialog>
  );
}

function PlanView({ plan, changed, labelOf }: { plan: BulkPlan; changed?: boolean; labelOf: (i: number) => string }) {
  const { ok, skip, refused, not_found } = plan.counts;
  return (
    <div className="stack gap-12">
      {changed && (
        <Callout tone="warning" icon={I.alert} title="What this would do has changed">
          Something changed since the preview, so nothing ran. This is the new preview — check it and run it again.
        </Callout>
      )}
      <div className="grid g4">
        <Stat label="Will run" value={ok} tone={ok ? 'success' : undefined} />
        <Stat label="Skipped" value={skip} sub="nothing to do" />
        <Stat label="Refused" value={refused} tone={refused ? 'danger' : undefined} />
        <Stat label="Not found" value={not_found} tone={not_found ? 'warning' : undefined} />
      </div>
      {plan.warnings.map(w => <Callout key={w} tone="warning" icon={I.alert}>{warningText(w)}</Callout>)}
      <div className="small muted">
        Nothing has changed yet. Running it checks each item again right before it goes; the preview is kept until {new Date(plan.expiresAt).toLocaleTimeString()}.
      </div>
      <ItemTable rows={plan.items.map(({ index, outcome }) => ({ index, ...outcomeView(outcome) }))} labelOf={labelOf} />
    </div>
  );
}

function JobView({ job, labelOf }: { job: BulkJob; labelOf: (i: number) => string }) {
  const settled = job.total - (job.counts.pending ?? 0);
  return (
    <div className="stack gap-12">
      {job.state === 'running' && <Meter value={settled} of={job.total} label="Items settled" />}
      {job.state === 'done' && (
        <Callout tone={job.counts.failed || job.counts.refused ? 'warning' : 'success'} icon={I.check} title="Finished">
          {job.counts.done} done · {job.counts.skipped} skipped · {job.counts.refused} refused · {job.counts.failed} failed.
        </Callout>
      )}
      {job.state === 'failed' && (
        <Callout tone="danger" icon={I.alert} title="Stopped part-way">
          The run stopped{job.error ? ` (${job.error})` : ''}. What was done stays done; the rest is marked failed.
        </Callout>
      )}
      <ItemTable rows={job.items.map(item => ({ index: item.index, ...jobItemView(item) }))} labelOf={labelOf} />
    </div>
  );
}

function ItemTable({ rows, labelOf }: { rows: { index: number; tone: BadgeTone; label: string; detail: string }[]; labelOf: (i: number) => string }) {
  return (
    <div className="people-bulk-items">
      <Table aria-label="Items">
        <thead><tr><th>Item</th><th>Outcome</th><th>Detail</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.index}>
              <td className="mono small">{labelOf(r.index)}</td>
              <td><Badge tone={r.tone} mono={false}>{r.label}</Badge></td>
              <td className="small muted">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
