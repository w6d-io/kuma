import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../api/hooks';
import { recoveryApi } from '../../api/recovery';
import { ApiErrorState } from '../../components/ApiErrorState';
import { Badge, Button, Card } from '../../components/ui';
import { permits } from '../../policy/model';
import { FACTOR_LABELS } from '../../lib/recovery';
import { RemoveSecondFactorDialog } from './RemoveSecondFactorDialog';
import { SendLoginLinkDialog } from './SendLoginLinkDialog';
import type { User } from '../../api/types';

/**
 * Getting somebody back in: their two-step sign-in (and removing it when they lost it), and a
 * one-click sign-in link when the email code does not arrive. Each action shows to whoever holds its
 * fine permission or the coarse admin:write it refines; jinbe decides either way.
 */
export function UserSignInTab({ user }: { user: User }) {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const key = ['user-second-factors', user.id];
  const q = useQuery({ queryKey: key, queryFn: () => recoveryApi.secondFactors(user.id), staleTime: 10_000 });
  const [dialog, setDialog] = useState<'link' | 'remove' | null>(null);

  const may = (fine: string) => permits(session?.permissions, 'admin:write') || permits(session?.permissions, fine);
  const maySendLink = may('users:send_login_link');
  const mayRemove = may('users:reset_second_factor');
  const methods = q.data?.methods ?? [];
  const required = q.data?.required ?? null;

  const open = (which: 'link' | 'remove') => {
    setDialog(which);
  };

  return (
    <div className="stack gap-12">
      <Card pad="md">
        <div className="row gap-12">
          <div className="flex-1 min-w-0">
            <div className="fw-medium text-base">Two-step sign-in</div>
            {q.isLoading && <div className="small muted">Loading…</div>}
            {q.isError && <ApiErrorState compact what="their sign-in methods" error={q.error} onRetry={() => q.refetch()} />}
            {q.data && (methods.length > 0
              ? <div className="row wrap gap-4 mt-4">{methods.map(m => <Badge key={m} tone="success" mono={false}>{FACTOR_LABELS[m] ?? m}</Badge>)}</div>
              : <div className="small muted">
                  Not set up.{required ? ' Their role requires it: they will be asked to set it up at their next sign-in.' : ''}
                </div>)}
          </div>
          {mayRemove && methods.length > 0 && (
            <Button className="people-danger-outline" onClick={() => open('remove')}>Remove two-step sign-in</Button>
          )}
        </div>
      </Card>
      {maySendLink && (
        <Card pad="md">
          <div className="row gap-12">
            <div className="flex-1">
              <div className="fw-medium text-base">Sign-in link</div>
              <div className="small muted">Emails a one-click link that signs them in — for when the sign-in code does not arrive.</div>
            </div>
            <Button onClick={() => open('link')}>Send sign-in link</Button>
          </div>
        </Card>
      )}
      <RemoveSecondFactorDialog
        open={dialog === 'remove'}
        user={user}
        methods={methods}
        required={required}
        onClose={() => setDialog(null)}
        onRemoved={() => {
          qc.invalidateQueries({ queryKey: key });
          qc.invalidateQueries({ queryKey: ['user-sessions', user.id] });
          qc.invalidateQueries({ queryKey: ['users'] });
        }}
        onSendLink={() => setDialog(maySendLink ? 'link' : null)}
      />
      <SendLoginLinkDialog
        open={dialog === 'link'}
        user={user}
        hasSecondFactor={methods.length > 0}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
