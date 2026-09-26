import { useMemo, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { formatHash } from '../../lib/route';
import { permissionOverview } from '../../lib/rbacEdit';
import type { RouteEntry } from '../../api/types';
import { Badge, ButtonBase, Callout, Card, EmptyRow, I, Input, Stat, Table } from '../../components/ui';
import { plural } from './access';

// A concrete path the checker can match: each `:param` (and `:any*` tail) becomes a sample value.
const checkLink = (site: string, r: RouteEntry) =>
  `#${formatHash('accesscheck', null, { app: site, method: r.method === '*' ? 'GET' : r.method, path: r.path.replace(/:\w+\*?/g, '1') })}`;

/**
 * The granular view: for one site, which routes need which permission, and which roles and groups
 * grant it. Each route links to the Access checker, prefilled, to ask it for one person.
 */
export function PermissionsOverview({ site }: { site: string }) {
  const { state, setPage } = useApp();
  const [filter, setFilter] = useState('');
  const routes = state.routeMaps[site];
  const unknown = state.routesErrored?.includes(site) || routes === undefined;
  const o = useMemo(
    () => permissionOverview(site, routes ?? [], state.roles[site] ?? {}, state.groups),
    [site, routes, state.roles, state.groups],
  );
  const low = filter.trim().toLowerCase();
  const matches = (r: RouteEntry) => !low || r.path.toLowerCase().includes(low) || r.method.toLowerCase() === low;
  const rows = o.rows
    .map(row => ({ ...row, shown: row.permission.toLowerCase().includes(low) ? row.routes : row.routes.filter(matches) }))
    .filter(row => row.shown.length > 0);
  const open = o.open.filter(matches);
  const nobody = o.rows.filter(r => r.roles.length === 0);

  if (unknown) {
    return (
      <Callout tone="danger" icon={I.alert} title="The routes of this site could not be read">
        Nothing here says which permission a route needs. Reload to retry.
      </Callout>
    );
  }

  return (
    <div className="col gap-12">
      <div className="rb-stats">
        <Stat label="Routes" value={routes!.length} />
        <Stat label="Permissions asked for" value={o.rows.length} />
        <Stat label="Need no permission" value={o.open.length} sub="signed-in or public, as the gate decides" />
        <Stat label="Granted by no role" value={nobody.length} tone={nobody.length ? 'warning' : undefined} sub={nobody.length ? 'only a super admin gets in' : undefined} />
      </div>

      <div className="row wrap gap-8">
        <div className="rb-filter flex-1">
          <Input aria-label="Filter routes or permissions" leading={I.search} placeholder="Filter by path, method or permission" value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <span className="small muted">Routes marked <span className="mono">:any*</span> match everything below them.</span>
      </div>

      <Card pad="none" title="Who can call what" sub="A permission is granted by the roles listed, and those roles are given by the groups listed.">
        <Table className="rb-stack">
          <thead>
            <tr><th>Permission</th><th>Routes</th><th>Granted by roles</th><th>Through groups</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={4}>{routes!.length ? 'Nothing matches the filter.' : 'This site declares no route.'}</EmptyRow>}
            {rows.map(row => (
              <tr key={row.permission}>
                <td className="nowrap" data-label="Permission">
                  <span className="mono fw-medium">{row.permission}</span>
                  {row.roles.length === 0 && <div><Badge tone="warning">no role grants it</Badge></div>}
                  {row.onlyEverything && <div><Badge tone="neutral" mono={false}>only via everything</Badge></div>}
                </td>
                <td data-label="Routes">
                  <ul className="rb-routes">
                    {row.shown.map(r => (
                      <li key={r.method + r.path}>
                        <a className="mono" href={checkLink(site, r)} title="Check a person on this route">
                          <span className="rb-method">{r.method}</span> {r.path}
                        </a>
                      </li>
                    ))}
                  </ul>
                </td>
                <td data-label="Granted by roles">
                  <span className="row wrap gap-4">
                    {row.roles.map(r => <Badge key={r} tone={(state.roles[site]?.[r] ?? []).includes('*') ? 'accent' : 'info'}>{r}</Badge>)}
                  </span>
                </td>
                <td data-label="Through groups">
                  {row.groups.length === 0 ? <span className="small muted">no group</span> : (
                    <span className="row wrap gap-4">
                      {row.groups.map(g => (
                        <ButtonBase key={g} className="rb-chip-link" onClick={() => setPage('groups', g)} title={`Open ${g}`}>
                          <Badge>{g}</Badge>
                        </ButtonBase>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {open.length > 0 && (
        <Card title={`Routes that need no permission (${open.length})`} sub="Anyone the gate lets through — signed in, or public if the gate allows anonymous callers." pad="sm">
          <ul className="rb-routes cols">
            {open.map(r => (
              <li key={r.method + r.path}>
                <a className="mono" href={checkLink(site, r)}><span className="rb-method">{r.method}</span> {r.path}</a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {o.unused.length > 0 && (
        <Callout tone="neutral" icon={I.info} title={`${plural(o.unused.length, 'permission')} no route asks for`}>
          <span className="row wrap gap-4">
            {o.unused.map(u => <Badge key={u.permission} title={`carried by ${u.roles.join(', ')}`}>{u.permission}</Badge>)}
          </span>
          <div className="small muted mt-4">Carried by a role but unused on {site} — harmless, or a route not declared yet.</div>
        </Callout>
      )}
    </div>
  );
}
