import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { KratosIdentity } from '../../api/client';
import { orgAccessApi, refusedOf, type AssignableGroup, type OrgGrants, type RefusedGroup } from '../../api/orgAccess';
import { changedMembers, columnsFor, sameGroups, toggleGrant } from '../../lib/orgGrants';
import { Avatar, Chip, EmptyHint } from '../../components/ui/Primitives';
import { SkeletonRows } from '../../components/ui/Skeleton';
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
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Person</th>
            {columns.map((c) => (
              <th key={c.name} title={c.grantable ? siteSummary(byName.get(c.name)) : 'Held here, but not a group you may grant'} style={{ textAlign: 'center' }}>
                {c.name}{!c.grantable && <span className="muted"> · not yours</span>}
              </th>
            ))}
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          {loading && <SkeletonRows rows={4} cols={cols} />}
          {!loading && members.length === 0 && <tr><td colSpan={cols}><EmptyHint>No members yet — add someone who has an account, or invite a new person.</EmptyHint></td></tr>}
          {!loading && columns.length === 0 && members.length > 0 && (
            <tr><td colSpan={cols} className="small muted" style={{ padding: 12 }}>There is no group you may grant in this organization. Members keep their site access.</td></tr>
          )}
          {!loading && members.map((m) => {
            const email = m.traits?.email ?? '';
            const mine = draft[email] ?? [];
            const dirty = !sameGroups(saved[email], mine);
            const why = refused[email] ?? [];
            return (
              <FragmentRow key={m.id} cols={cols} refused={why}>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <Avatar name={m.traits?.name || email} />
                    <div>
                      <div style={{ fontWeight: 500 }}>{m.traits?.name || email}{m.state !== 'active' && <> <Chip tone="warn">inactive</Chip></>}</div>
                      <div className="small muted mono">{email}</div>
                    </div>
                  </div>
                </td>
                {columns.map((c) => (
                  <td key={c.name} style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      aria-label={`${c.name} for ${email}`}
                      checked={mine.includes(c.name)}
                      disabled={readOnly || !email || (!c.grantable && !mine.includes(c.name)) || saving === email}
                      onChange={() => setDraft((d) => toggleGrant(d, email, c.name))}
                    />
                  </td>
                ))}
                <td style={{ whiteSpace: 'nowrap' }}>
                  {dirty && (
                    <>
                      <button className="btn primary sm" disabled={saving === email} onClick={() => save(m, email)}>{saving === email ? 'Saving…' : 'Save'}</button>{' '}
                      <button className="btn ghost sm" disabled={saving === email} onClick={() => { setDraft((d) => ({ ...d, [email]: saved[email] ?? [] })); setRefused((r) => ({ ...r, [email]: [] })); }}>Undo</button>
                    </>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn ghost sm" onClick={() => onRemove(m)} title={`Remove from ${orgName} only`}>Remove</button>
                </td>
              </FragmentRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A member's row, and under it what the last save refused and why. */
function FragmentRow({ cols, refused, children }: { cols: number; refused: RefusedGroup[]; children: React.ReactNode }) {
  return (
    <>
      <tr>{children}</tr>
      {refused.length > 0 && (
        <tr>
          <td colSpan={cols} role="alert" style={{ background: 'var(--err-soft)' }}>
            <div className="small" style={{ fontWeight: 500, color: 'var(--err)' }}>Nothing was saved for this person. Refused:</div>
            <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {refused.map((r) => <li key={r.group}><span className="mono">{r.group}</span>{r.reason ? ` — ${r.reason}` : ''}</li>)}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
