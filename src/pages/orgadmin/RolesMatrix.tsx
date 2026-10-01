import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { KratosIdentity } from '../../api/client';
import { orgAccessApi, refusalWords, refusedOf, type OrgRole, type RefusedRole } from '../../api/orgAccess';
import { changedMembers, columnsFor, roleLabel, sameSet, toggleRole, type MemberRoles } from '../../lib/orgRoles';
import { Avatar, Badge, Button, Checkbox, EmptyHint, EmptyRow, LoadingRows, Table, Th } from '../../components/ui';
import { makeToastErr, type PushToast } from './toastErr';

/**
 * Members of one org × the org roles it may hold. Each row saves on its own, because a refusal names
 * roles for that person and should not hold back the others. A role the caller may not hand out is
 * shown and can be taken away, never added: jinbe's holding rule refuses it anyway.
 */
export function RolesMatrix({ org, orgName, members, loading, saved, roles, mayManage, onRemove, pushToast }: {
  org: string;
  orgName: string;
  members: KratosIdentity[];
  loading: boolean;
  /** member id → their roles here, as jinbe answered. */
  saved: MemberRoles;
  roles: OrgRole[];
  /** Holds org.members:write in this org: may change roles and remove members. */
  mayManage: boolean;
  onRemove: (m: KratosIdentity) => void;
  pushToast: PushToast;
}) {
  const qc = useQueryClient();
  const toastErr = useMemo(() => makeToastErr(pushToast), [pushToast]);
  const [draft, setDraft] = useState<MemberRoles>(saved);
  const [refused, setRefused] = useState<Record<string, RefusedRole[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  // A fresh read replaces the draft only for rows nobody is editing. Keyed on the content: the map
  // is rebuilt from one answer per member, so its identity says nothing.
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setDraft((d) => {
      const next = { ...saved };
      for (const id of changedMembers(saved, d)) next[id] = d[id];
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns = useMemo(() => columnsFor(roles, saved), [roles, savedKey]);

  const save = async (m: KratosIdentity) => {
    const wanted = draft[m.id] ?? [];
    const label = m.traits?.email ?? m.id;
    setSaving(m.id);
    try {
      const now = await orgAccessApi.setMemberRoles(org, m.id, wanted);
      qc.setQueryData<string[]>(['org-member-roles', org, m.id], now);
      setRefused((r) => ({ ...r, [m.id]: [] }));
      pushToast(`Saved ${label} in ${orgName}`, { sub: 'Counts on this organization\'s routes only.' });
    } catch (err) {
      const list = refusedOf(err);
      if (list.length) setRefused((r) => ({ ...r, [m.id]: list }));
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
          {columns.map((c) => {
            const { name, site } = roleLabel(c.role);
            const title = c.retired
              ? 'Held here, but this organization no longer offers it'
              : `${c.role}: ${c.permissions.join(', ') || 'no permission'}${c.assignable ? '' : ' · you may not assign it'}`;
            return (
              <Th key={c.role} align="center" title={title}>
                {name}{site && <> <Badge mono={false}>{site}</Badge></>}
                {c.retired ? <span className="muted"> · retired</span> : !c.assignable && <span className="muted"> · not yours</span>}
              </Th>
            );
          })}
          <th />
          <th className="actions" />
        </tr>
      </thead>
      <tbody>
        {loading && <LoadingRows rows={4} cols={cols} />}
        {!loading && members.length === 0 && <EmptyRow colSpan={cols}><EmptyHint>No members yet — add someone who has an account, or invite a new person.</EmptyHint></EmptyRow>}
        {!loading && columns.length === 0 && members.length > 0 && (
          <tr><td colSpan={cols} className="small muted orgs-note">This organization has no role to assign. Members keep their platform access.</td></tr>
        )}
        {!loading && members.map((m) => {
          const email = m.traits?.email ?? '';
          const mine = draft[m.id] ?? [];
          const dirty = !sameSet(saved[m.id], mine);
          return (
            <MemberRow key={m.id} cols={cols} refused={refused[m.id] ?? []}>
              <td>
                <div className="row gap-8">
                  <Avatar name={m.traits?.name || email} />
                  <div>
                    <div className="fw-medium">{m.traits?.name || email}{m.state !== 'active' && <> <Badge tone="warning">inactive</Badge></>}</div>
                    <div className="small muted mono">{email}</div>
                  </div>
                </div>
              </td>
              {columns.map((c) => {
                const on = mine.includes(c.role);
                return (
                  <td key={c.role} className="text-center">
                    <Checkbox
                      className="orgs-grant"
                      label={<span className="sr-only">{`${c.role} for ${email || m.id}`}</span>}
                      checked={on}
                      disabled={!mayManage || !(m.id in saved) || (!c.assignable && !on) || saving === m.id}
                      onChange={() => setDraft((d) => toggleRole(d, m.id, c.role))}
                    />
                  </td>
                );
              })}
              <td className="nowrap">
                {dirty && (
                  <>
                    <Button variant="primary" size="sm" disabled={saving === m.id} onClick={() => save(m)}>{saving === m.id ? 'Saving…' : 'Save'}</Button>{' '}
                    <Button variant="ghost" size="sm" disabled={saving === m.id} onClick={() => { setDraft((d) => ({ ...d, [m.id]: saved[m.id] ?? [] })); setRefused((r) => ({ ...r, [m.id]: [] })); }}>Undo</Button>
                  </>
                )}
              </td>
              <td className="actions">
                {mayManage && <Button variant="ghost" size="sm" onClick={() => onRemove(m)} title={`Remove from ${orgName} only`}>Remove</Button>}
              </td>
            </MemberRow>
          );
        })}
      </tbody>
    </Table>
  );
}

/** A member's row, and under it what the last save refused and why, role by role. */
function MemberRow({ cols, refused, children }: { cols: number; refused: RefusedRole[]; children: React.ReactNode }) {
  return (
    <>
      <tr>{children}</tr>
      {refused.length > 0 && (
        <tr>
          <td colSpan={cols} role="alert" className="orgs-refused">
            <div className="small fw-medium text-danger">Nothing was saved for this person. Refused:</div>
            <ul className="small orgs-refused-list">
              {refused.map((r) => (
                <li key={r.role}>
                  <span className="mono">{r.role}</span> — {refusalWords(r)}
                  {r.grantedBy && <span className="muted"> · granted by {r.grantedBy}</span>}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
