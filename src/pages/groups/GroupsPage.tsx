import { useMemo, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useStats } from '../../api/hooks';
import { useRbacUsers } from '../../api/rbacWrites';
import { Badge, Button, ButtonBase, Card, EmptyRow, I, Input, PageHeader, Table } from '../../components/ui';
import { isEverything, isOrgGrantable, membersOf } from '../../lib/rbacEdit';
import { ReadOnlyNote } from '../access/shared';
import { useCanEditAccess } from '../access/access';
import { GroupEditor } from './GroupEditor';

/**
 * Groups: a group is a set of roles across sites, handed to people. Editable here — create, change
 * the roles it gives per site, delete — with the member list and what it adds up to.
 * `#/groups/<name>` opens one.
 */
export function GroupsPage() {
  const { state, pageParam, setPage } = useApp();
  const canEdit = useCanEditAccess();
  const users = useRbacUsers();
  const { data: stats } = useStats();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');

  const names = useMemo(() => Object.keys(state.groups).sort(), [state.groups]);
  const low = filter.trim().toLowerCase();
  const shown = names.filter(g => !low || g.includes(low) || Object.keys(state.groups[g]).some(s => s.includes(low)));
  const open = pageParam && state.groups[pageParam] ? pageParam : null;
  const count = (g: string) => (users.data ? membersOf(users.data, [g]).length : stats?.perGroup?.[g] ?? 0);

  return (
    <>
      <PageHeader
        title="Groups"
        sub="A group is a set of roles across sites. People get access by being in groups."
        actions={canEdit && <Button variant="primary" icon={I.plus} onClick={() => setCreating(true)}>New group</Button>}
      />
      <>
          {!canEdit && <ReadOnlyNote what="groups" />}
          <div className="rb-filter mb-12">
            <Input aria-label="Filter groups" leading={I.search} placeholder="Filter by group or site" value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
          <Card pad="none">
            <Table className="rb-stack">
              <thead>
                <tr><th>Group</th><th>Gives</th><th className="text-right">Members</th><th>Org admins can hand it out</th></tr>
              </thead>
              <tbody>
                {shown.length === 0 && <EmptyRow colSpan={4}>{names.length ? 'No group matches.' : 'No group yet.'}</EmptyRow>}
                {shown.map(g => {
                  const def = state.groups[g];
                  const sites = Object.keys(def).filter(s => def[s]?.length).sort();
                  const grantable = isOrgGrantable(def, state.roles);
                  return (
                    <tr key={g} className="row-click" onClick={() => setPage('groups', g)}>
                      <td className="nowrap" data-label="Group">
                        <ButtonBase className="rb-row-link mono fw-medium" onClick={e => { e.stopPropagation(); setPage('groups', g); }}>{g}</ButtonBase>
                        {state.groupsMeta[g]?.system && <Badge tone="warning" icon={I.lock} className="ml-4">system</Badge>}
                      </td>
                      <td data-label="Gives">
                        {sites.length === 0 ? <span className="small muted">no role</span> : (
                          <span className="row wrap gap-4">
                            {sites.map(s => def[s].map(r => (
                              <Badge key={s + r} tone={isEverything(state.roles[s]?.[r]) ? 'accent' : 'info'} title={isEverything(state.roles[s]?.[r]) ? `everything in ${s}` : undefined}>
                                {s} · {r}
                              </Badge>
                            )))}
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular" data-label="Members">{count(g)}</td>
                      <td data-label="Org admins can hand it out">
                        {grantable.ok
                          ? <Badge tone="success" mono={false}>yes</Badge>
                          : <span className="small muted">no — {grantable.reasons.join(', ')}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
      </>
      {(open || creating) && (
        <GroupEditor
          key={open ?? '__new'}
          name={creating ? null : open}
          canEdit={canEdit}
          users={users.data}
          onClose={() => { setCreating(false); if (open) setPage('groups'); }}
          onCreated={g => { setCreating(false); setPage('groups', g); }}
          onDeleted={() => setPage('groups')}
        />
      )}
    </>
  );
}
