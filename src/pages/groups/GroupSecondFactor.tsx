import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { twoFactorApi } from '../../api/twoFactor';
import { isNotAvailable } from '../../api/orgAccess';
import { useApp } from '../../contexts/AppContext';
import { useSecondFactorGroups, useSession, useSetSecondFactorGroups } from '../../api/hooks';
import { Switch, TwoFactorBadge } from '../../components/ui';
import { toastFor } from '../../lib/apiError';
import { stepUpAndResume, useResume } from '../../lib/resume';
import { mayChangeGroup2fa, type GroupSecondFactor as Rule } from '../../lib/twoFactor';

/**
 * "Members must use 2FA", on one group (owner decision, wave 19): members enrol a second factor
 * before they can be added, and sign in with it on every app. Only a super admin changes it, through
 * the group's own switch (PUT /admin/rbac/groups/:name/second-factor); a jinbe without that route
 * takes the Settings → Two-step sign-in list with this one name added or removed. Saved at once —
 * apart from the group's roles, which go through their own review.
 */
export function GroupSecondFactor({ name, rule }: { name: string; rule: Rule | undefined }) {
  const qc = useQueryClient();
  const { pushToast } = useApp();
  const { data: session } = useSession();
  const setting = useSecondFactorGroups();
  const saveList = useSetSecondFactorGroups();
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState<boolean | null>(null);
  const superAdmin = mayChangeGroup2fa(session);
  const listed = setting.data?.groups;
  const on = shown ?? (rule ? rule.required : !!listed?.includes(name));

  const saved = (want: boolean) => {
    setShown(want);
    void qc.invalidateQueries({ queryKey: ['groups'] });
    void qc.invalidateQueries({ queryKey: ['groups-map'] });
    void qc.invalidateQueries({ queryKey: ['second-factor-groups'] });
    pushToast(want ? `Members of ${name} must use two-step sign-in` : `${name} no longer requires two-step sign-in`, {
      sub: want ? 'Members without a second factor set one up at their next sign-in; nobody without one can be added.' : 'Members may still use it; nothing else changes.',
    });
  };
  const failed = (e: Error & { code?: string }, want: boolean) => {
    if (e.code === 'reauth_required' && stepUpAndResume(`group-2fa:${name}`, { want })) {
      pushToast('Confirm it’s you', { err: true, sub: 'Nothing was saved yet. Taking you to prove your second factor; back here it is saved by itself.', ttl: 4000 });
      return;
    }
    pushToast(...toastFor(e));
  };
  const apply = async (want: boolean) => {
    setPending(true);
    try {
      await twoFactorApi.setGroupRequired(name, want);
      saved(want);
    } catch (err) {
      if (!isNotAvailable(err)) { failed(err as Error, want); return; }
      // An older jinbe: the whole list, this one name added or removed.
      try {
        const list = listed ?? (await api.getSecondFactorGroups()).groups;
        const next = want ? [...new Set([...list, name])].sort() : list.filter((g) => g !== name);
        await saveList.mutateAsync(next);
        saved(want);
      } catch (e) {
        failed(e as Error, want);
      }
    } finally {
      setPending(false);
    }
  };
  // Back from the step-up: the same choice, once, if the group is not already there.
  useResume<{ want: boolean }>(superAdmin ? `group-2fa:${name}` : null, !!rule || !!listed, ({ want }) => { if (want !== on) void apply(want); });

  // A jinbe without the setting, or one this person may not read, and no rule on the group: nothing to show.
  if (setting.isError && !rule) return null;
  return (
    <div className="settings-row">
      <div className="flex-1 min-w-0">
        <div className="fw-medium text-base row gap-8 items-center">Members must use 2FA {on && <TwoFactorBadge kind="required" />}</div>
        <div className="small muted">
          Covers both: a person must have enrolled a second factor before being added, and members sign in with it on every app.
          {!superAdmin && ' Only a super admin can change it.'}
          {rule?.source === 'default' && ' Not set yet: it follows the default for its roles.'}
          {rule?.defaultRequired !== undefined && ` Default for this group: ${rule.defaultRequired ? 'on' : 'off'}.`}
        </div>
      </div>
      <Switch on={on} onChange={(v) => void apply(v)} label="Members must use 2FA" disabled={!superAdmin || (!rule && !listed) || pending} />
    </div>
  );
}
