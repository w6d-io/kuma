import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { accountsApi } from '../../api/accounts';
import { ApiErrorState } from '../../components/ApiErrorState';
import { Badge, Button, Card, ConfirmDialog, EmptyHint } from '../../components/ui';
import { summarizeSession } from '../../lib/sessions';
import { toastFor } from '../../lib/apiError';
import { timeAgo } from '../../api/transforms';
import type { User } from '../../api/types';

/** Where this person is signed in, and a way to sign them out of one place or all of them. */
export function UserSessionsTab({ user }: { user: User }) {
  const { pushToast, persona } = useApp();
  const qc = useQueryClient();
  const key = ['user-sessions', user.id];
  const q = useQuery({ queryKey: key, queryFn: () => accountsApi.listSessions(user.id), staleTime: 10_000 });
  const [confirm, setConfirm] = useState<{ id: string | 'all'; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const revoke = async (target: { id: string | 'all'; label: string }) => {
    if (persona === 'viewer') { pushToast('Read-only persona · change blocked', { err: true }); return; }
    setBusy(true);
    try {
      if (target.id === 'all') await accountsApi.revokeAllSessions(user.id);
      else await accountsApi.revokeSession(target.id);
      pushToast(target.id === 'all' ? `Signed ${user.email} out everywhere` : 'Session revoked', { sub: target.label });
    } catch (err) {
      pushToast(...toastFor(err));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: key });
    }
  };

  if (q.isError) return <ApiErrorState compact what="sessions" error={q.error} onRetry={() => q.refetch()} />;

  const rows = (q.data ?? []).map(summarizeSession).filter(r => r.active);

  return (
    <div className="stack gap-12">
      <div className="row justify-between">
        <span className="small muted">
          {q.isLoading ? 'Loading sessions…' : `${rows.length} active session${rows.length === 1 ? '' : 's'}`}
        </span>
        <Button size="sm" disabled={busy || rows.length === 0}
          onClick={() => setConfirm({ id: 'all', label: `${rows.length} session${rows.length === 1 ? '' : 's'}` })}>
          Sign out everywhere
        </Button>
      </div>
      <Card>
        {!q.isLoading && rows.length === 0 && <div className="p-16"><EmptyHint>Not signed in anywhere.</EmptyHint></div>}
        {rows.map((r) => (
          <div key={r.id} className="people-sep people-row roomy row gap-12">
            <div className="flex-1 min-w-0">
              <div className="fw-medium text-base">{r.device}</div>
              <div className="small muted">
                {r.started ? `Signed in ${timeAgo(r.started)}` : 'Sign-in time unknown'}
                {r.expires ? ` · expires ${new Date(r.expires).toLocaleString()}` : ''}
              </div>
              {r.methods.length > 0 && (
                <div className="row wrap gap-4 mt-4">
                  {r.methods.map(m => <Badge key={m} mono={false}>{m}</Badge>)}
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm({ id: r.id, label: r.device })}>Revoke</Button>
          </div>
        ))}
      </Card>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.id === 'all' ? `Sign ${user.email} out everywhere?` : 'Revoke this session?'}
        danger
        confirmLabel={confirm?.id === 'all' ? 'Sign out everywhere' : 'Revoke'}
        body={confirm?.id === 'all'
          ? <>Every session for this person ends now. They can sign in again.</>
          : <>{confirm?.label} is signed out now. They can sign in again.</>}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) void revoke(c); }}
      />
    </div>
  );
}
