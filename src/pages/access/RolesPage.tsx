import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useServicePermissions } from '../../api/hooks';
import { useRbacUsers, useSaveSiteRoles } from '../../api/rbacWrites';
import { formatHash, parseHash } from '../../lib/route';
import { describeApiError } from '../../lib/apiError';
import {
  Badge, Button, Callout, Card, ConfirmDialog, EmptyRow, Field, I, PageHeader, Select, Table, Tabs,
} from '../../components/ui';
import { groupsUsingRole, membersOf, type SiteRoles } from '../../lib/rbacEdit';
import { PermChips, ReadOnlyNote } from './shared';
import { plural, useCanEditAccess } from './access';
import { RoleEditor, type RoleDraft } from './RoleEditor';
import { PermissionsOverview } from './PermissionsOverview';

type Tab = 'roles' | 'permissions';

const tabFromHash = (): Tab => (parseHash(window.location.hash).query?.tab === 'permissions' ? 'permissions' : 'roles');

/**
 * Roles & permissions, per site: what each role carries, who holds it through which group, and —
 * on the second tab — which routes need which permission. `#/roles/<site>?tab=permissions`.
 */
export function RolesPage() {
  const { state, pageParam } = useApp();
  const sites = useMemo(
    () => [...state.services].sort((a, b) => Number(!!a.system) - Number(!!b.system) || a.name.localeCompare(b.name)),
    [state.services],
  );
  const site = sites.some(s => s.name === pageParam) ? pageParam! : sites[0]?.name ?? '';
  const [tab, setTabRaw] = useState<Tab>(tabFromHash);
  // A link to another view of this page (an old `#/routes/x`, a pasted `?tab=`) changes only the
  // hash: the page stays mounted, so the tab follows the hash here.
  useEffect(() => {
    const sync = () => setTabRaw(tabFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const go = (nextSite: string, nextTab: Tab) => {
    window.location.hash = formatHash('roles', nextSite, nextTab === 'permissions' ? { tab: nextTab } : {});
  };
  const setTab = (t: Tab) => { setTabRaw(t); history.replaceState(null, '', `#${formatHash('roles', site, t === 'permissions' ? { tab: t } : {})}`); };
  const meta = sites.find(s => s.name === site);

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        sub="A role is a named set of permissions on one site. Groups hand roles to people."
      />
      <div className="row wrap gap-12 mb-12 items-end">
        <Field label="Site" htmlFor="roles-site" className="rb-site-pick">
          <Select id="roles-site" value={site} onChange={e => go(e.target.value, tab)}>
            {sites.map(s => <option key={s.name} value={s.name}>{s.name}{s.system ? ' (system)' : ''}</option>)}
          </Select>
        </Field>
        {meta?.system && <Badge tone="warning" icon={I.lock}>system site</Badge>}
        {site === 'global' && <Badge tone="info">applies on every site</Badge>}
      </div>
      <Tabs
        label="View"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'roles', label: 'Roles', count: Object.keys(state.roles[site] ?? {}).length },
          { value: 'permissions', label: 'Permissions by route', count: state.routeMaps[site]?.length },
        ]}
        className="mb-12"
      />
      {!site ? (
        <Card pad="md"><span className="small muted">No site is registered yet.</span></Card>
      ) : tab === 'roles' ? (
        <RolesTab site={site} system={!!meta?.system} key={site} />
      ) : (
        <PermissionsOverview site={site} />
      )}
    </>
  );
}

function RolesTab({ site, system }: { site: string; system: boolean }) {
  const { state, pushToast, pipeline } = useApp();
  const canEdit = useCanEditAccess();
  const users = useRbacUsers();
  const known = useServicePermissions(site);
  const save = useSaveSiteRoles();
  const [editing, setEditing] = useState<{ role: string | null } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const roles: SiteRoles = state.roles[site] ?? {};
  const unknown = state.rolesErrored?.includes(site) || !(site in state.roles);
  const names = Object.keys(roles).sort();
  const peopleIn = (groups: string[]) => (users.data ? membersOf(users.data, groups).length : null);

  const submit = async (draft: RoleDraft) => {
    try {
      await save.mutateAsync(draft.write);
      pipeline.run(draft.summary);
      setEditing(null);
    } catch (e) {
      pushToast('The roles were not saved', { err: true, sub: describeApiError(e).detail });
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await save.mutateAsync({ site, remove: deleting });
      pipeline.run(`role ${deleting} deleted on ${site}`);
      setDeleting(null);
    } catch (e) {
      pushToast('The role was not deleted', { err: true, sub: describeApiError(e).detail });
    }
  };

  const deletingGroups = deleting ? groupsUsingRole(state.groups, site, deleting) : [];
  const deletingPeople = peopleIn(deletingGroups);

  return (
    <>
      {!canEdit && <ReadOnlyNote what="roles" />}
      {system && canEdit && (
        <Callout tone="warning" icon={I.alert} className="mb-12">
          {site} is a system site: its roles decide who can administer the platform itself. Keep one
          role with everything, held by a group you are in.
        </Callout>
      )}
      {unknown && (
        <Callout tone="danger" icon={I.alert} className="mb-12" title="The roles of this site could not be read">
          Editing is off: saving on top of an unknown list would replace the real roles. Reload to retry.
        </Callout>
      )}
      <Card
        title={`Roles on ${site}`}
        sub="Everything in this site covers every route except the organization routes."
        actions={canEdit && !unknown && <Button size="sm" variant="primary" icon={I.plus} onClick={() => setEditing({ role: null })}>New role</Button>}
        pad="none"
      >
        <Table className="rb-stack">
          <thead>
            <tr><th>Role</th><th>Permissions</th><th>Given by groups</th><th className="text-right">People</th>{canEdit && <th aria-label="Actions" />}</tr>
          </thead>
          <tbody>
            {names.length === 0 && <EmptyRow colSpan={canEdit ? 5 : 4}>{unknown ? 'Unknown.' : 'This site has no role yet.'}</EmptyRow>}
            {names.map(role => {
              const groups = groupsUsingRole(state.groups, site, role);
              const people = peopleIn(groups);
              return (
                <tr key={role}>
                  <td className="mono fw-medium nowrap" data-label="Role">{role}</td>
                  <td data-label="Permissions"><PermChips perms={roles[role]} /></td>
                  <td data-label="Given by groups">
                    {groups.length === 0 ? <span className="small muted">no group</span> : (
                      <span className="row wrap gap-4">{groups.map(g => <Badge key={g} tone="info">{g}</Badge>)}</span>
                    )}
                  </td>
                  <td className="text-right tabular" data-label="People">{people ?? '…'}</td>
                  {canEdit && (
                    <td className="text-right nowrap rb-actions">
                      <Button size="sm" variant="ghost" icon={I.edit} onClick={() => setEditing({ role })} aria-label={`Edit ${role}`}>Edit</Button>
                      <Button size="sm" variant="ghost" iconOnly icon={I.trash} onClick={() => setDeleting(role)} aria-label={`Delete ${role}`} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {editing && !unknown && (
        <RoleEditor
          site={site}
          role={editing.role}
          roles={roles}
          groups={state.groups}
          routes={state.routeMaps[site] ?? []}
          known={known.data ?? []}
          peopleIn={peopleIn}
          busy={save.isPending}
          onSave={submit}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete the role ${deleting ?? ''}?`}
        danger
        confirmLabel="Delete role"
        busy={save.isPending}
        requireText={deletingGroups.length ? deleting ?? undefined : undefined}
        body={`Its permissions stop applying on ${site} as soon as the engines pick up the change.`}
        blastRadius={deletingGroups.length > 0 ? (
          <>
            Taken out of {plural(deletingGroups.length, 'group')} ({deletingGroups.join(', ')}) —{' '}
            {deletingPeople == null ? 'their members' : plural(deletingPeople, 'person', 'people')} lose what it gave them.
          </>
        ) : 'No group gives this role, so nobody loses anything.'}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
