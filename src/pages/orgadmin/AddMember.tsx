import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { orgAccessApi } from '../../api/orgAccess';
import { readMemberInput } from '../../lib/orgGrants';
import { statusOf } from '../../lib/apiError';
import { Button, Input } from '../../components/ui';
import { makeToastErr, type PushToast } from './toastErr';

/**
 * Adds somebody who already has an account to this org. Their other orgs and their site access stay.
 * By email when the caller may look people up, by user id otherwise — the form says which it needs.
 */
export function AddMember({ org, orgName, pushToast }: { org: string; orgName: string; pushToast: PushToast }) {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const add = async () => {
    const target = readMemberInput(value);
    if (target.kind === 'invalid') { setProblem('Enter their email or their user id.'); return; }
    setBusy(true);
    setProblem(null);
    try {
      let id: string;
      if (target.kind === 'id') {
        id = target.id;
      } else {
        const found = await api.getUsersPage(undefined, 1, target.email).catch((err) => {
          if (statusOf(err) === 403) throw Object.assign(new Error('lookup'), { lookupRefused: true });
          throw err;
        });
        if (!found.data[0]) { setProblem(`No account uses ${target.email}. Use "Invite new person" to create one.`); return; }
        id = found.data[0].id;
      }
      await orgAccessApi.addMember(org, id);
      pushToast(`Added to ${orgName}`, { sub: 'Their other organizations and site access are unchanged.' });
      setValue('');
      qc.invalidateQueries({ queryKey: ['org-users', org] });
      qc.invalidateQueries({ queryKey: ['org-grants', org] });
    } catch (err) {
      if ((err as { lookupRefused?: boolean }).lookupRefused) {
        setProblem('You cannot look people up by email here. Paste their user id instead.');
      } else if (statusOf(err) === 404) {
        setProblem('No account has that id.');
      } else {
        makeToastErr(pushToast)(err);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="row gap-8 wrap" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <Input
        mono
        size="sm"
        className="orgs-member-input"
        aria-label="Email or user id of an existing account"
        placeholder="Existing account: email or user id"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button size="sm" type="submit" disabled={busy || !value.trim()}>{busy ? 'Adding…' : 'Add member'}</Button>
      {problem && <span className="small text-danger" role="alert">{problem}</span>}
    </form>
  );
}
