import { useMemo, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useDeleteGroup, useSaveGroup } from '../../api/rbacWrites';
import { describeApiError } from '../../lib/apiError';
import type { GroupMapping } from '../../api/types';
import {
  Badge, Button, ButtonBase, Callout, Checkbox, ConfirmDialog, Drawer, EmptyHint, Field, I, Input, Tabs,
} from '../../components/ui';
import {
  diffGroupSites, effectiveAccess, isEverything, isOrgGrantable, membersOf, validateGroupName, type RbacUser,
} from '../../lib/rbacEdit';
import { PermChips } from '../access/shared';
import { plural } from '../access/access';

type Tab = 'access' | 'members';

/**
 * One group: the roles it gives on each site (sites × roles), what that adds up to, and who is in it.
 * Changes go through a review — the roles gained and lost per site, and how many people they reach.
 */
export function GroupEditor({ name, canEdit, users, onClose, onCreated, onDeleted }: {
  /** null: a new group. */
  name: string | null;
  canEdit: boolean;
  users: RbacUser[] | undefined;
  onClose: () => void;
  onCreated: (name: string) => void;
  onDeleted: () => void;
}) {
  const { state, pushToast, pipeline, setPage } = useApp();
  const save = useSaveGroup();
  const remove = useDeleteGroup();
  const before: GroupMapping = useMemo(() => (name ? state.groups[name] ?? {} : {}), [name, state.groups]);
  const [newName, setNewName] = useState('');
  const [draft, setDraft] = useState<GroupMapping>(() => structuredClone(before));
  const [tab, setTab] = useState<Tab>('access');
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const system = !!(name && state.groupsMeta[name]?.system);
  const members = name && users ? membersOf(users, [name]) : [];
  const sites = [...state.services].sort((a, b) => Number(!!a.system) - Number(!!b.system) || a.name.localeCompare(b.name));
  const cleaned: GroupMapping = Object.fromEntries(Object.entries(draft).filter(([, r]) => r.length));
  const changes = diffGroupSites(before, cleaned);
  const nameError = name ? null : validateGroupName(newName, Object.keys(state.groups));
  const access = effectiveAccess(cleaned, state.roles);
  const grantable = isOrgGrantable(cleaned, state.roles);
  const finalName = name ?? newName.trim();
  // Everything on a system site or on `global`: the group administers the platform itself, so
  // deleting it is typed out whoever is in it.
  const systemSites = new Set(state.services.filter(s => s.system).map(s => s.name));
  const administersPlatform = effectiveAccess(before, state.roles).some(a => a.everything && (a.site === 'global' || systemSites.has(a.site)));

  const toggle = (site: string, role: string, on: boolean) => setDraft(d => {
    const cur = d[site] ?? [];
    return { ...d, [site]: on ? [...cur, role] : cur.filter(r => r !== role) };
  });

  const submit = async () => {
    try {
      await save.mutateAsync({ name: finalName, create: !name, changes });
      pipeline.run(name ? `group ${finalName}` : `new group ${finalName}`);
      if (name) onClose(); else onCreated(finalName);
    } catch (e) {
      pushToast('The group was not saved', { err: true, sub: describeApiError(e).detail, ttl: 8000 });
    }
  };
  const doDelete = async () => {
    try {
      await remove.mutateAsync(name!);
      pipeline.run(`group ${name} deleted`);
      setConfirmDelete(false);
      onDeleted();
    } catch (e) {
      pushToast('The group was not deleted', { err: true, sub: describeApiError(e).detail, ttl: 8000 });
    }
  };

  const footer = !canEdit ? <Button onClick={onClose}>Close</Button> : step === 'edit' ? (
    <>
      {name && !system && <Button variant="danger" icon={I.trash} onClick={() => setConfirmDelete(true)}>Delete</Button>}
      <span className="spacer" />
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!!nameError || (!!name && changes.length === 0)} onClick={() => setStep('review')}>Review changes</Button>
    </>
  ) : (
    <>
      <Button onClick={() => setStep('edit')} disabled={save.isPending}>Back</Button>
      <Button variant="primary" loading={save.isPending} onClick={submit}>{name ? 'Save group' : 'Create group'}</Button>
    </>
  );

  return (
    <Drawer open onClose={onClose} eyebrow="Group" title={name ?? 'New group'} size="lg" footer={footer}>
      {step === 'review' ? (
        <GroupReview name={finalName} changes={changes} people={name ? members.length : 0} creating={!name} />
      ) : (
        <div className="col gap-16">
          {system && (
            <Callout tone="warning" icon={I.lock}>
              A system group: it cannot be deleted, and changing it may need a super admin.
            </Callout>
          )}
          {!name && (
            <Field label="Name" htmlFor="group-name" error={newName && nameError} hint="Lowercase letters and _, e.g. payroll_editors" required>
              <Input id="group-name" mono value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            </Field>
          )}
          {name && (
            <Tabs
              label="Group"
              value={tab}
              onChange={setTab}
              items={[{ value: 'access', label: 'Roles per site' }, { value: 'members', label: 'Members', count: users ? members.length : undefined }]}
            />
          )}
          {tab === 'members' && name ? (
            <MemberList members={members} loading={!users} onOpen={u => u.identityId && setPage('users', u.identityId)} />
          ) : (
            <>
              <div className="col gap-8">
                {sites.map(s => {
                  const roles = Object.keys(state.roles[s.name] ?? {}).sort();
                  return (
                    <fieldset key={s.name} className="rb-site-row" disabled={!canEdit}>
                      <legend className="row gap-8">
                        <span className="mono fw-medium">{s.name}</span>
                        {s.system && <Badge tone="warning">system</Badge>}
                      </legend>
                      {!state.roles[s.name] ? <span className="small text-warning">its roles could not be read — reload to edit them</span>
                        : roles.length === 0 ? <span className="small muted">this site has no role</span> : (
                        <div className="rb-role-row">
                          {roles.map(r => (
                            <Checkbox
                              key={r}
                              checked={(draft[s.name] ?? []).includes(r)}
                              onChange={on => toggle(s.name, r, on)}
                              disabled={!canEdit}
                              label={<span className="mono">{r}</span>}
                              hint={isEverything(state.roles[s.name][r]) ? 'everything' : plural(state.roles[s.name][r].length, 'permission')}
                            />
                          ))}
                        </div>
                      )}
                    </fieldset>
                  );
                })}
              </div>
              <WhoGetsWhat access={access} grantable={grantable} />
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete the group ${name}?`}
        danger
        confirmLabel="Delete group"
        busy={remove.isPending}
        requireText={members.length || administersPlatform ? name ?? undefined : undefined}
        body={administersPlatform
          ? 'This group gives everything on a system site: it administers the platform. Make sure another group still does before deleting it.'
          : 'The group and the roles it gives are removed.'}
        blastRadius={members.length
          ? `${plural(members.length, 'person', 'people')} lose what it gave them, unless another group gives the same.`
          : 'Nobody is in it.'}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </Drawer>
  );
}

function WhoGetsWhat({ access, grantable }: { access: ReturnType<typeof effectiveAccess>; grantable: ReturnType<typeof isOrgGrantable> }) {
  return (
    <div className="col gap-8">
      <div className="fw-medium">Who gets what</div>
      {access.length === 0 ? <EmptyHint>Members get nothing from this group yet.</EmptyHint> : access.map(a => (
        <div key={a.site} className="rb-access">
          <div className="small mono text-muted">{a.site}</div>
          <PermChips perms={a.everything ? ['*'] : a.permissions} max={12} />
          {a.undefinedRoles.length > 0 && (
            <div className="small text-warning mt-4">{a.undefinedRoles.join(', ')} not defined on {a.site}: gives nothing.</div>
          )}
        </div>
      ))}
      <div className="small muted">
        {grantable.ok
          ? 'Org admins can hand this group out in their own organization.'
          : `Org admins cannot hand it out: ${grantable.reasons.join(', ')}.`}
      </div>
    </div>
  );
}

function GroupReview({ name, changes, people, creating }: { name: string; changes: ReturnType<typeof diffGroupSites>; people: number; creating: boolean }) {
  return (
    <div className="col gap-12">
      <div className="fw-medium">{creating ? `Create ${name}` : `What changes in ${name}`}</div>
      <ul className="rb-diff">
        {changes.length === 0 && <li className="muted">no role yet</li>}
        {changes.flatMap(c => [
          ...c.added.map(r => <li key={`+${c.site}${r}`} className="add">+ <span className="mono">{c.site} · {r}</span></li>),
          ...c.removed.map(r => <li key={`-${c.site}${r}`} className="del">− <span className="mono">{c.site} · {r}</span></li>),
        ])}
      </ul>
      {creating
        ? <span className="small muted">Nobody is in it yet: add people from People → Users.</span>
        : <Callout tone="info" icon={I.users}>Reaches {plural(people, 'person', 'people')} in this group.</Callout>}
      <span className="small muted">Stored at once; the engines apply it within about 40 seconds.</span>
    </div>
  );
}

function MemberList({ members, loading, onOpen }: { members: RbacUser[]; loading: boolean; onOpen: (u: RbacUser) => void }) {
  if (loading) return <EmptyHint>Loading members…</EmptyHint>;
  if (members.length === 0) return <EmptyHint>Nobody is in this group. Add people from People → Users.</EmptyHint>;
  return (
    <ul className="rb-members">
      {members.map(u => (
        <li key={u.email}>
          <ButtonBase className="rb-member" onClick={() => onOpen(u)}>
            <span className="fw-medium">{u.name || u.email}</span>
            <span className="small muted">{u.email}</span>
          </ButtonBase>
        </li>
      ))}
    </ul>
  );
}
