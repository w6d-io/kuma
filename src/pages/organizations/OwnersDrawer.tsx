import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { api, type LookupHit } from '../../api/client';
import { useUserIdentity } from '../../api/hooks';
import { orgAccessApi, OWNER_ROLE } from '../../api/orgAccess';
import { Badge, Button, Card, Drawer, Field, cx } from '../../components/ui';
import { MultiSelectPills } from '../../components/ui/Primitives';
import { PersonFinder } from '../../components/PersonFinder';
import { toastFor, statusOf } from '../../lib/apiError';
import { readMemberInput, sameSet } from '../../lib/orgRoles';
import { stepUpAndResume } from '../../lib/resume';

// The owners editor. A PUT names the org's owners by identity id: each joins the org if needed and
// holds jinbe:owner there, everyone else loses it. orgs.owners:write and a recent second factor are
// enforced by jinbe; a stale factor returns reauth_required, handled with a step-up bounce. People
// are named by address: the members, anyone already an owner, and anybody found by email.
export const ORG_OWNERS = 'org-owners';
export type OwnersResume = { owners: string[]; was: string[] };

/** An owner by address: the member list's when it has them, looked up otherwise, the id as a last resort. */
export function OwnerBadge({ id, email }: { id: string; email?: string }) {
  const looked = useUserIdentity(id, !email).data?.traits?.email;
  const label = email ?? looked;
  return <Badge tone="accent" title={id}>{label ?? `${id.slice(0, 8)}…`}</Badge>;
}

/** `resume`: back from the step-up — the owners chosen, saved once by itself on open when `auto`. */
export function OwnersDrawer({ org, name, current, members, onClose, resume }: {
  org: string; name?: string; current: string[]; members: { id: string; label: string }[];
  onClose: () => void; resume?: { owners: string[]; auto: boolean };
}) {
  const { pushToast } = useApp();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>(resume?.owners ?? current);
  const [found, setFound] = useState<{ id: string; label: string }[]>([]);
  const [value, setValue] = useState('');
  const [picked, setPicked] = useState<LookupHit | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const labels = useMemo(() => new Map([...members, ...found].map((m) => [m.id, m.label])), [members, found]);
  const options = useMemo(() => [...new Set([...members.map((m) => m.id), ...found.map((f) => f.id), ...current, ...selected])], [members, found, current, selected]);
  const resumed = useRef(false);
  useEffect(() => {
    if (!resume?.auto || resumed.current) return;
    resumed.current = true;
    void save();
  });
  const dirty = !sameSet(selected, current);

  const toggle = (id: string) => setSelected(prev => (prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]));

  // Somebody by address: the one picked from the list, or the account that address belongs to.
  async function add() {
    const typed = readMemberInput(value);
    if (!(picked && picked.email === value) && typed.kind !== 'email') { setProblem('Enter their email address.'); return; }
    setProblem(null);
    setFinding(true);
    try {
      let person: { id: string; label: string };
      if (picked && picked.email === value) {
        person = { id: picked.id, label: picked.email };
      } else {
        const email = (typed as { email: string }).email;
        const hit = (await api.getUsersPage(undefined, 1, email)).data[0];
        if (!hit) { setProblem(`No account uses ${email}. Invite them to the organization first.`); return; }
        person = { id: hit.id, label: hit.traits?.email ?? email };
      }
      setFound((f) => (f.some((x) => x.id === person.id) ? f : [...f, person]));
      setSelected((s) => [...new Set([...s, person.id])]);
      setValue('');
      setPicked(null);
    } catch (err) {
      setProblem(statusOf(err) === 403 ? 'You cannot look people up by address.' : toastFor(err)[0]);
    } finally {
      setFinding(false);
    }
  }

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      await orgAccessApi.setOwners(org, selected);
      pushToast(`Owners of ${name ?? org} updated`, { sub: `${selected.length} owner${selected.length === 1 ? '' : 's'}` });
      qc.invalidateQueries({ queryKey: ['org-member-roles', org] });
      qc.invalidateQueries({ queryKey: ['all-orgs'] });
      qc.invalidateQueries({ queryKey: ['org-users', org] });
      onClose();
    } catch (e) {
      const err = e as Error & { code?: string };
      // Step-up: re-verify a recent second factor, then return to retry.
      if (err.code === 'reauth_required') {
        const going = stepUpAndResume(`${ORG_OWNERS}:${org}`, { owners: selected, was: current } satisfies OwnersResume);
        pushToast('Two-factor re-verification required', { err: true, sub: going
          ? 'Nothing was saved yet. You will be sent to re-verify your second factor; back here the owners are saved by themselves. This is not a sign-out.'
          : 'Nothing was saved. Re-verify your second factor, then save again.' });
        return;
      }
      pushToast(...toastFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      eyebrow="Organization owners"
      title="Name owners"
      footer={
        <>
          <span className="small muted">Needs orgs.owners:write and a recent second factor.</span>
          <div className="row">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!dirty || busy}>{busy ? 'Saving…' : `Save ${OWNER_ROLE.split(':')[1]}s`}</Button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <div className="input-label">Organization</div>
        <div className={cx('text-base', !name && 'mono')}>{name ?? org}</div>
      </div>
      <Field
        label="Owners"
        hint="Owners hold every permission of this organization (joining it if needed). Saving replaces the whole list."
      >
        <Card pad="sm">
          <MultiSelectPills
            options={options.map((id) => labels.get(id) ?? id)}
            selected={selected.map((id) => labels.get(id) ?? id)}
            onToggle={(l) => toggle(options.find((id) => (labels.get(id) ?? id) === l) ?? l)}
            empty="No members yet. Find somebody by email below."
          />
        </Card>
      </Field>
      <form className="row gap-8 wrap mt-8" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <PersonFinder
          size="sm"
          className="orgs-member-input"
          aria-label="Add an owner by email"
          placeholder="Add an owner: their email"
          value={value}
          onChange={(v) => { setValue(v); if (picked && picked.email !== v) setPicked(null); }}
          onPick={(h) => { setValue(h.email); setPicked(h); setProblem(null); }}
        />
        <Button size="sm" type="submit" loading={finding} disabled={!value.trim()}>Add</Button>
        {problem && <span className="small text-danger" role="alert">{problem}</span>}
      </form>
    </Drawer>
  );
}
