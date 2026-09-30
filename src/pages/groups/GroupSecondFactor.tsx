import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { useSecondFactorGroups, useSession, useSetSecondFactorGroups } from '../../api/hooks';
import { Switch, TwoFactorBadge } from '../../components/ui';
import { toastFor } from '../../lib/apiError';
import { stepUpAndResume, useResume } from '../../lib/resume';
import { permits } from '../../policy/model';
import type { GroupSecondFactor as Rule } from '../../lib/twoFactor';

/**
 * "Members must use 2FA", on one group (owner decision, wave 19): members enrol a second factor
 * before they can be added, and sign in with it on every app. Only a super admin changes it; it is
 * the same list as Settings → Two-step sign-in (jinbe /admin/settings/second-factor), one name added
 * or removed, saved at once — apart from the group's roles, which go through their own review.
 */
export function GroupSecondFactor({ name, rule }: { name: string; rule: Rule | undefined }) {
  const qc = useQueryClient();
  const { pushToast } = useApp();
  const { data: session } = useSession();
  const setting = useSecondFactorGroups();
  const save = useSetSecondFactorGroups();
  const superAdmin = permits(session?.permissions, '*');
  const listed = setting.data?.groups;
  const on = listed ? listed.includes(name) : !!rule?.required;

  const apply = (want: boolean) => {
    if (!listed) return;
    const next = want ? [...new Set([...listed, name])].sort() : listed.filter((g) => g !== name);
    save.mutate(next, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['groups'] });
        void qc.invalidateQueries({ queryKey: ['groups-map'] });
        pushToast(want ? `Members of ${name} must use two-step sign-in` : `${name} no longer requires two-step sign-in`, {
          sub: want ? 'Members without a second factor set one up at their next sign-in; nobody without one can be added.' : 'Members may still use it; nothing else changes.',
        });
      },
      onError: (e: Error & { code?: string }) => {
        if (e.code === 'reauth_required' && stepUpAndResume(`group-2fa:${name}`, { want })) {
          pushToast('Confirm it’s you', { err: true, sub: 'Nothing was saved yet. Taking you to prove your second factor; back here it is saved by itself.', ttl: 4000 });
          return;
        }
        pushToast(...toastFor(e));
      },
    });
  };
  // Back from the step-up: the same choice, once, if the group is not already there.
  useResume<{ want: boolean }>(superAdmin ? `group-2fa:${name}` : null, !!listed, ({ want }) => { if (want !== on) apply(want); });

  // A jinbe without the setting, or one this person may not read, and no rule on the group: nothing to show.
  if (setting.isError && !rule) return null;
  return (
    <div className="settings-row">
      <div className="flex-1 min-w-0">
        <div className="fw-medium text-base row gap-8 items-center">Members must use 2FA {on && <TwoFactorBadge kind="required" />}</div>
        <div className="small muted">
          Covers both: a person must have enrolled a second factor before being added, and members sign in with it on every app.
          {!superAdmin && ' Only a super admin can change it.'}
          {rule?.source === 'default' && on && ' On by default: no administrator has set the list yet.'}
        </div>
      </div>
      <Switch on={on} onChange={apply} label="Members must use 2FA" disabled={!superAdmin || !listed || save.isPending} />
    </div>
  );
}
