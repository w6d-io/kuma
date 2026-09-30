import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Callout, I } from '../../components/ui';
import { sitesApi } from '../../api/sites';
import { timeAgo } from '../../lib/sites/format';
import { useSiteAction } from './useAction';
import { useResume } from '../../lib/resume';
import type { Finding } from '../../lib/sites/types';
import { FindingsDialog } from './Findings';

/**
 * Apply requests waiting on this site (site-ux.md §9.1, four-eyes): who asked, for which version,
 * and Approve (applies it, needs a recent second factor) or Reject. Absent when there are none or
 * the server has no requests yet. Approving re-checks the security findings against what the request
 * acknowledged; any still open are asked here before the approval runs again.
 */
export function PendingRequests({ name, onApplied }: { name: string; onApplied: () => void }) {
  const qc = useQueryClient();
  const { run, busy } = useSiteAction();
  const q = useQuery({ queryKey: ['sites', 'requests', name], queryFn: () => sitesApi.requests({ site: name, state: 'pending' }), retry: false });
  const pending = (q.data ?? []).filter((r) => r.state === 'pending');
  const done = () => { void qc.invalidateQueries({ queryKey: ['sites', 'requests', name] }); onApplied(); };
  const [held, setHeld] = useState<{ findings: Finding[]; id: string; version: number } | null>(null);
  const approve = async (id: string, version: number, acknowledge?: string[]) => {
    await run('Approve', () => sitesApi.approveRequest(id, acknowledge), `v${version} approved and applying`, { resume: `site-approve:${name}`, data: { id, acknowledge } },
      (findings) => setHeld({ findings, id, version }));
    done();
  };
  // Back from the step-up: approve the same request, once, if it is still waiting.
  useResume<{ id: string; acknowledge?: string[] }>(`site-approve:${name}`, !!q.data, ({ id, acknowledge }) => {
    const r = pending.find((x) => x.id === id);
    if (r) void approve(r.id, r.version, acknowledge);
  });
  if (pending.length === 0) return null;
  return (
    <>
      <FindingsDialog
        findings={held?.findings ?? null}
        what={held ? `v${held.version}` : ''}
        onClose={() => setHeld(null)}
        onRetry={async (acknowledge) => { const h = held!; setHeld(null); await approve(h.id, h.version, acknowledge); }}
      />
      {pending.map((r) => (
        <Callout
          key={r.id}
          tone="info"
          icon={I.clock}
          className="mb-12"
          title={`${r.requestedBy} asks to apply v${r.version}`}
          actions={<>
            <Button size="sm" variant="ghost" loading={busy === 'Reject'} onClick={async () => { await run('Reject', () => sitesApi.rejectRequest(r.id), 'Request rejected'); done(); }}>Reject</Button>
            <Button size="sm" variant="primary" loading={busy === 'Approve'} onClick={() => void approve(r.id, r.version)}>Approve &amp; apply</Button>
          </>}
        >
          {timeAgo(r.requestedAt)}{r.note ? ` · “${r.note}”` : ''}{r.risk ? ` · ${r.risk.level} risk` : ''}{r.needsSecondApprover ? ' · needs another super admin (four-eyes)' : ''}
        </Callout>
      ))}
    </>
  );
}
