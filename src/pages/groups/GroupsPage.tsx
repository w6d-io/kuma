import { useMemo, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useStats } from '../../api/hooks';
import { useRbacUsers } from '../../api/rbacWrites';
import { Button, ButtonBase, Card, I, Input, PageHeader, Toolbar, TwoFactorBadge } from '../../components/ui';
import { useGroupSecondFactors } from '../../api/twoFactor';
import { membersOf } from '../../lib/rbacEdit';
import { ReadOnlyNote } from '../access/shared';
import { useCanEditAccess } from '../access/access';
import { GroupEditor } from './GroupEditor';
import { appsOf, kindOf, matches, twoFactorSourceOf, twoFactorStateOf, type GroupRow } from './groupKinds';
import { PlatformGroupsTable, SiteGroupsTable, StaffGroupsTable } from './GroupTables';

/**
 * Groups: a group gives roles, people get access by being in groups. Three kinds, each in its own
 * table because each is changed differently (groupKinds.ts): staff (built in), site access (roles on
 * sites, given by whoever manages sites) and platform access (roles on the platform, given only by
 * someone who holds them). Each row says whether members must use two-step sign-in, and why.
 * `#/groups/<name>` opens one; the editor is unchanged.
 */
export function GroupsPage() {
  const { state, pageParam, setPage } = useApp();
  const canEdit = useCanEditAccess();
  const users = useRbacUsers();
  const { data: stats } = useStats();
  const secondFactorOf = useGroupSecondFactors();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');

  const rows = useMemo((): GroupRow[] => Object.keys(state.groups).sort().map((name) => {
    const def = state.groups[name] ?? {};
    const meta = state.groupsMeta[name];
    const kind = kindOf(def, meta);
    const sf = secondFactorOf(name);
    return {
      name, kind, def, apps: appsOf(def),
      description: meta?.description,
      members: users.data ? membersOf(users.data, [name]).length : stats?.perGroup?.[name] ?? 0,
      twoFactor: twoFactorStateOf(kind, sf),
      twoFactorSource: twoFactorSourceOf(sf),
    };
  }), [state.groups, state.groupsMeta, secondFactorOf, users.data, stats]);

  const shown = rows.filter((r) => matches(r, filter));
  const filtered = filter.trim() !== '';
  const open = pageParam && state.groups[pageParam] ? pageParam : null;
  const onOpen = (name: string) => setPage('groups', name);

  return (
    <>
      <PageHeader
        title="Groups"
        sub="People get access by being in groups. Staff, site access and platform access groups are each changed differently."
        actions={canEdit && <Button variant="primary" icon={I.plus} onClick={() => setCreating(true)}>New group</Button>}
      />
      {!canEdit && <ReadOnlyNote what="groups" />}
      <div className="stack gap-16">
        <Card pad="none">
          <Toolbar inset label="Find a group">
            <Input size="sm" aria-label="Find a group" leading={I.search} placeholder="Group, site or role" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <span className="small muted groups-legend">
              <TwoFactorBadge kind="required" /> members sign in with a second factor; anyone added before setting one up joins once they do.
              Optional: the group does not ask, the site's own setting decides. Only a super admin changes it, from the group.
            </span>
          </Toolbar>
        </Card>
        <StaffGroupsTable rows={shown.filter((r) => r.kind === 'staff')} onOpen={onOpen} filtered={filtered} none="No staff group: the platform defines them at start." />
        <SiteGroupsTable rows={shown.filter((r) => r.kind === 'site')} onOpen={onOpen} filtered={filtered} none="No group gives site access yet. Create one, or open a site's Users tab." />
        <PlatformGroupsTable rows={shown.filter((r) => r.kind === 'platform' || r.kind === 'empty')} onOpen={onOpen} filtered={filtered} none="No custom group gives platform access." />
        <p className="small muted m-0">
          Organization roles are not groups: they are given inside each organization, from{' '}
          <ButtonBase className="link" onClick={() => setPage('organizations')}>Organizations</ButtonBase>.
        </p>
      </div>
      {(open || creating) && (
        <GroupEditor
          key={open ?? '__new'}
          name={creating ? null : open}
          canEdit={canEdit}
          users={users.data}
          onClose={() => { setCreating(false); if (open) setPage('groups'); }}
          onCreated={(g) => { setCreating(false); setPage('groups', g); }}
          onDeleted={() => setPage('groups')}
        />
      )}
    </>
  );
}
