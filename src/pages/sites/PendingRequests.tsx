import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Callout, I } from '../../components/ui';
import { sitesApi } from '../../api/sites';
import { timeAgo } from '../../lib/sites/format';
import { useSiteAction } from './useAction';

/**
 * Apply requests waiting on this site (site-ux.md §9.1, four-eyes): who asked, for which version,
 * and Approve (applies it, needs a recent second factor) or Reject. Absent when there are none or
 * the server has no requests yet.
 */
export function PendingRequests({ name, onApplied }: { name: string; onApplied: () => void }) {
  const qc = useQueryClient();
  const { run, busy } = useSiteAction();
  const q = useQuery({ queryKey: ['sites', 'requests', name], queryFn: () => sitesApi.requests({ site: name, state: 'pending' }), retry: false });
  const pending = (q.data ?? []).filter((r) => r.state === 'pending');
  if (pending.length === 0) return null;
  const done = () => { void qc.invalidateQueries({ queryKey: ['sites', 'requests', name] }); onApplied(); };
  return (
    <>
      {pending.map((r) => (
        <Callout
          key={r.id}
          tone="info"
          icon={I.clock}
          className="mb-12"
          title={`${r.requestedBy} asks to apply v${r.version}`}
          actions={<>
            <Button size="sm" variant="ghost" loading={busy === 'Reject'} onClick={async () => { await run('Reject', () => sitesApi.rejectRequest(r.id), 'Request rejected'); done(); }}>Reject</Button>
            <Button size="sm" variant="primary" loading={busy === 'Approve'} onClick={async () => { await run('Approve', () => sitesApi.approveRequest(r.id), `v${r.version} approved and applying`); done(); }}>Approve &amp; apply</Button>
          </>}
        >
          {timeAgo(r.requestedAt)}{r.note ? ` · “${r.note}”` : ''}{r.risk ? ` · ${r.risk.level} risk` : ''}{r.needsSecondApprover ? ' · needs another super admin (four-eyes)' : ''}
        </Callout>
      ))}
    </>
  );
}
