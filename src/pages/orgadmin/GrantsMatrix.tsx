import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { KratosIdentity } from '../../api/client';
import { orgAccessApi, refusedOf, type AssignableGroup, type OrgGrants, type RefusedGroup } from '../../api/orgAccess';
import { changedMembers, columnsFor, sameGroups, toggleGrant } from '../../lib/orgGrants';
import { Avatar, Badge, Button, Checkbox, EmptyHint, EmptyRow, LoadingRows, Table, Th } from '../../components/ui';
import { makeToastErr, type PushToast } from './toastErr';

const siteSummary = (g: AssignableGroup | undefined) =>
  g && Object.keys(g.services).length
    ? Object.entries(g.services).map(([s, roles]) => `${s}: ${roles.join(', ')}`).join(' · ')
    : undefined;

/**
 * People in one org × the groups the caller may grant there. Each row saves on its own, because a
 * refusal names groups for that person and should not hold back the others.
 */
export function GrantsMatrix({ org, orgName, members, loading, saved, assignable, readOnly, onRemove, pushToast }: {
  org: string;
  orgName: string;
  members: KratosIdentity[];
  loading: boolean;
  saved: OrgGrants;
  assignable: AssignableGroup[];
  /** Grants cannot be read or written on this server: shown, not editable. */
  readOnly: boolean;
  onRemove: (m: KratosIdentity) => void;
  pushToast: PushToast;
}) {
  const qc = useQueryClient();
  const toastErr = useMemo(() => makeToastErr(pushToast), [pushToast]);
  const [draft, setDraft] = useState<OrgGrants>(saved);
  const [refused, setRefused] = useState<Record<string, RefusedGroup[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  // A fresh read replaces the draft only for rows nobody is editing.
  useEffect(() => {
    setDraft((d) => {
      const next = { ...saved };
      for (const email of changedMembers(saved, d)) next[email] = d[email];
      return next;
    });
  }, [saved]);

  const columns = useMemo(() => columnsFor(assignable.map((g) => g.name), saved), [assignable, saved]);
  const byName = useMemo(() => new Map(assignable.map((g) => [g.name, g])), [assignable]);

  const save = async (m: KratosIdentity, email: string) => {
    const groups = draft[email] ?? [];
    setSaving(email);
    try {
      const res = await orgAccessApi.setGrants(org, m.id, groups);
      qc.setQueryData<OrgGrants>(['org-grants', org], (g) => ({ ...(g ?? {}), [email]: res?.groups ?? groups }));
      setRefused((r) => ({ ...r, [email]: [] }));
      pushToast(`Saved ${email} in ${orgName}`, { sub: 'Counts on this organization\'s routes only.' });
    } catch (err) {
      const list = refusedOf(err);
      if (list.length) setRefused((r) => ({ ...r, [email]: list }));
      else toastErr(err);
    } finally {
      setSaving(null);
    }
  };

  const cols = columns.length + 3;
  return (
    <Table>
        <thead>
          <tr>
            <th>Person</th>
            {columns.map((c) => (
              <Th key={c.name} align="center" title={c.grantable ? siteSummary(byName.get(c.name)) : 'Held here, but not a group you may grant'}>
                {c.name}{!c.grantable && <span className="muted"> · not yours</span>}
              </Th>
            ))}
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          {loading && <LoadingRows rows={4} cols={cols} />}
          {!loading && members.length === 0 && <EmptyRow colSpan={cols}><EmptyHint>No members yet — add someone who has an account, or invite a new person.</EmptyHint></EmptyRow>}
          {!loading && columns.length === 0 && members.length > 0 && (
            <tr><td colSpan={cols} className="small muted orgs-note">There is no group you may grant in this organization. Members keep their site access.</td></tr>
          )}
          {!loading && members.map((m) => {
            const email = m.traits?.email ?? '';
            const mine = draft[email] ?? [];
            const dirty = !sameGroups(saved[email], mine);
            const why = refused[email] ?? [];
            return (
              <FragmentRow key={m.id} cols={cols} refused={why}>
                <td>
                  <div className="row gap-8">
                    <Avatar name={m.traits?.name || email} />
                    <div>
                      <div className="fw-medium">{m.traits?.name || email}{m.state !== 'active' && <> <Badge tone="warning">inactive</Badge></>}</div>
                      <div className="small muted mono">{email}</div>
                    </div>
                  </div>
                </td>
                {columns.map((c) => (
                  <td key={c.name} className="text-center">
                    <Checkbox
                      className="orgs-grant"
                      label={<span className="sr-only">{`${c.name} for ${email}`}</span>}
                      checked={mine.includes(c.name)}
                      disabled={readOnly || !email || (!c.grantable && !mine.includes(c.name)) || saving === email}
                      onChange={() => setDraft((d) => toggleGrant(d, email, c.name))}
                    />
                  </td>
                ))}
                <td className="nowrap">
                  {dirty && (
                    <>
                      <Button variant="primary" size="sm" disabled={saving === email} onClick={() => save(m, email)}>{saving === email ? 'Saving…' : 'Save'}</Button>{' '}
                      <Button variant="ghost" size="sm" disabled={saving === email} onClick={() => { setDraft((d) => ({ ...d, [email]: saved[email] ?? [] })); setRefused((r) => ({ ...r, [email]: [] })); }}>Undo</Button>
                    </>
                  )}
                </td>
                <td className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => onRemove(m)} title={`Remove from ${orgName} only`}>Remove</Button>
                </td>
              </FragmentRow>
            );
          })}
        </tbody>
    </Table>
  );
}

/** A member's row, and under it what the last save refused and why. */
function FragmentRow({ cols, refused, children }: { cols: number; refused: RefusedGroup[]; children: React.ReactNode }) {
  return (
    <>
      <tr>{children}</tr>
      {refused.length > 0 && (
        <tr>
          <td colSpan={cols} role="alert" className="orgs-refused">
            <div className="small fw-medium text-danger">Nothing was saved for this person. Refused:</div>
            <ul className="small orgs-refused-list">
              {refused.map((r) => <li key={r.group}><span className="mono">{r.group}</span>{r.reason ? ` — ${r.reason}` : ''}</li>)}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
