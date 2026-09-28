import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type LookupHit } from '../../api/client';
import { orgAccessApi } from '../../api/orgAccess';
import { readMemberInput } from '../../lib/orgGrants';
import { statusOf } from '../../lib/apiError';
import { Button } from '../../components/ui';
import { PersonFinder } from '../../components/PersonFinder';
import { makeToastErr, type PushToast } from './toastErr';

/**
 * Adds somebody who already has an account to this org. Their other orgs and their site access stay.
 * Found as you type (the checker's quick find: start of an email, a whole one, or a Kratos id) and
 * picked from the list; typed out in full when the caller may not look people up.
 */
export function AddMember({ org, orgName, pushToast }: { org: string; orgName: string; pushToast: PushToast }) {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  // The person picked from the list, while the box still shows their address.
  const [picked, setPicked] = useState<LookupHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const add = async () => {
    const target = picked && picked.email === value ? { kind: 'id' as const, id: picked.id } : readMemberInput(value);
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
      setPicked(null);
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
      <PersonFinder
        size="sm"
        className="orgs-member-input"
        aria-label="Find an existing account by email or user id"
        placeholder="Find an existing account: email or user id"
        value={value}
        onChange={(v) => { setValue(v); if (picked && picked.email !== v) setPicked(null); }}
        onPick={(h) => { setValue(h.email); setPicked(h); setProblem(null); }}
      />
      <Button size="sm" type="submit" loading={busy} disabled={!value.trim()}>Add member</Button>
      {problem && <span className="small text-danger" role="alert">{problem}</span>}
    </form>
  );
}
