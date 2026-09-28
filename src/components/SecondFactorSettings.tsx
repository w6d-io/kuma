import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useAuthMethods, useSecondFactorGroups, useSetSecondFactorGroups } from '../api/hooks';
import { MultiSelectPills } from './ui/Primitives';
import { I, Button, Callout, Card } from './ui';
import { toastFor } from '../lib/apiError';
import { stepUpAndResume, useResume } from '../lib/resume';
import { sameGroups, secondFactorWarnings } from '../lib/secondFactor';

/**
 * Settings · Two-step sign-in: the groups whose members must use a second factor. They are asked to
 * set one up at their next sign-in, before going anywhere, and every permission-protected route
 * (this console's API included) refuses them until they have signed in with it. Hidden when jinbe
 * predates the setting.
 */
export function SecondFactorSettings() {
  const { state, pushToast } = useApp();
  const { data, isError } = useSecondFactorGroups();
  const save = useSetSecondFactorGroups();
  const { data: auth } = useAuthMethods();
  const [draft, setDraft] = useState<string[] | null>(null);

  useEffect(() => { if (data) setDraft(data.groups); }, [data]);

  // Back from the step-up the save needed: the same groups saved again, once, if nobody changed the
  // setting meanwhile; otherwise they are put back in the form to be checked and saved by hand.
  useResume<{ next: string[]; was: string[] }>('second-factor-groups', !!data, ({ next, was }) => {
    setDraft(next);
    if (data && sameGroups(data.groups, was)) submit(next);
    else pushToast('The requirement changed meanwhile', { sub: 'Nothing was saved. Your choice is back in the form — check it and save.', ttl: 8000 });
  });

  const options = useMemo(
    () => [...new Set([...Object.keys(state.groups ?? {}), ...(data?.groups ?? [])])].sort(),
    [state.groups, data],
  );
  if (isError || !data || !draft) return null;

  const dirty = !sameGroups(draft, data.groups);
  const warnings = secondFactorWarnings(draft, auth?.methods);
  const toggle = (g: string) => setDraft(d => (d ?? []).includes(g) ? (d ?? []).filter(x => x !== g) : [...(d ?? []), g]);

  function submit(next = draft) {
    if (!next || !data) return;
    const was = data.groups;
    save.mutate(next, {
      onSuccess: (r) => pushToast('Two-step sign-in requirement saved', {
        sub: r.groups.length
          ? `Members of ${r.groups.join(', ')} set up a second factor at their next sign-in.`
          : 'Nobody is required to use two-step sign-in.',
      }),
      onError: (e: Error & { code?: string }) => {
        if (e.code === 'reauth_required') {
          const going = stepUpAndResume('second-factor-groups', { next, was });
          pushToast('Two-factor re-verification required', { err: true, sub: going
            ? 'Nothing was saved yet. You will be sent to re-verify your second factor; back here it is saved by itself. This is not a sign-out.'
            : 'Nothing was saved. Re-verify your second factor, then save again.' });
          return;
        }
        pushToast(...toastFor(e));
      },
    });
  }

  return (
    <Card
      title="Two-step sign-in"
      sub="Members of these groups must use a second factor — an authenticator app or a security key. At their next sign-in they set one up before going anywhere, and nothing that needs a permission (this console included) works for them until they sign in with it."
    >
      <MultiSelectPills options={options} selected={draft} onToggle={toggle} empty="No groups yet." />
      {warnings.includes('nobody') && (
        <Callout tone="warning" icon={I.alert} title="Nobody is required to use two-step sign-in" className="mt-12">
          <div className="small">Administrator accounts would be protected by a password or an email code alone. The recommended minimum is <span className="mono">{data.defaultGroups.join(', ')}</span>.</div>
        </Callout>
      )}
      {warnings.includes('no-method') && (
        <Callout tone="danger" icon={I.alert} title="No second factor can be set up" className="mt-12">
          <div className="small">Authenticator app (TOTP) and security keys are both off under Authentication methods. Members of these groups could not finish signing in — turn one on first.</div>
        </Callout>
      )}
      <div className="row wrap gap-8 mt-12">
        <Button variant="primary" onClick={() => submit()} disabled={!dirty} loading={save.isPending}>
          Save
        </Button>
        <Button variant="ghost" onClick={() => setDraft(data.defaultGroups)} disabled={sameGroups(draft, data.defaultGroups) || save.isPending}>
          Reset to recommended
        </Button>
        <span className="small muted">Saving needs a super admin who confirmed a second factor in the last 15 minutes.</span>
      </div>
    </Card>
  );
}
