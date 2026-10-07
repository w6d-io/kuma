import type { ReactNode } from 'react';
import { Badge, ButtonBase, Card, EmptyRow, I, Table, TwoFactorBadge } from '../../components/ui';
import { sitesHref } from '../../lib/sites/route';
import { bySite, twoFactorSentence, type GroupRow } from './groupKinds';

/**
 * The Groups page's tables, one per kind of group (groupKinds.ts): who can change it is said once in
 * the card, the columns fit what that kind gives. A row opens the group (#/groups/<name>).
 */

/** The 2FA cell: the shared badge for a rule that asks, a lock for a staff group's, plain words otherwise. */
export function TwoFactorCell({ row }: { row: GroupRow }) {
  const sentence = twoFactorSentence(row.kind, row.twoFactor, row.twoFactorSource);
  switch (row.twoFactor) {
    case 'locked':
      return (
        <span className="row wrap gap-4">
          <TwoFactorBadge kind="required" title={sentence} />
          <Badge tone="neutral" mono={false} icon={I.lock} title={sentence}>locked</Badge>
        </span>
      );
    case 'required':
      return <TwoFactorBadge kind="required" title={sentence} />;
    case 'optional':
      return <span className="small muted" title={sentence}>Optional</span>;
    case 'unknown':
      return <span className="small muted" title={sentence}>—</span>;
  }
}

function GroupName({ row, onOpen, extra }: { row: GroupRow; onOpen: (name: string) => void; extra?: ReactNode }) {
  return (
    <>
      <ButtonBase className="rb-row-link mono fw-medium" onClick={(e) => { e.stopPropagation(); onOpen(row.name); }}>{row.name}</ButtonBase>
      {extra}
    </>
  );
}

function Roles({ row, withApp }: { row: GroupRow; withApp: boolean }) {
  return (
    <span className="row wrap gap-4">
      {row.apps.flatMap((app) => (row.def[app] ?? []).map((role) => (
        <Badge key={`${app}:${role}`} tone="info">{withApp ? `${app} · ${role}` : role}</Badge>
      )))}
    </span>
  );
}

interface TableProps {
  rows: GroupRow[];
  onOpen: (name: string) => void;
  /** No row at all of this kind (as opposed to none matching the search). */
  none: string;
  filtered: boolean;
}

const emptyText = (p: TableProps) => (p.filtered ? 'No group of this kind matches.' : p.none);

export function StaffGroupsTable(p: TableProps) {
  return (
    <Card
      title="Staff"
      sub="Built into the platform: what each role can do is fixed in code. Add or remove people from Users; it needs a recent second factor."
      pad="none"
    >
      <Table className="rb-stack groups-table" aria-label="Staff groups">
        <thead><tr><th>Group</th><th>Role</th><th>Two-step sign-in</th><th className="num">Members</th></tr></thead>
        <tbody>
          {p.rows.length === 0 && <EmptyRow colSpan={4}>{emptyText(p)}</EmptyRow>}
          {p.rows.map((row) => (
            <tr key={row.name} className="row-click" onClick={() => p.onOpen(row.name)}>
              <td className="nowrap" data-label="Group">
                <GroupName row={row} onOpen={p.onOpen} extra={<Badge tone="neutral" mono={false} icon={I.lock} className="ml-4" title="Built in: its roles are fixed in code and it cannot be edited or deleted here">built in</Badge>} />
              </td>
              <td data-label="Role">
                {row.description ? <span className="small">{row.description}</span> : <Roles row={row} withApp />}
              </td>
              <td data-label="Two-step sign-in"><TwoFactorCell row={row} /></td>
              <td className="num" data-label="Members">{row.members}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

export function SiteGroupsTable(p: TableProps) {
  const sections = bySite(p.rows);
  return (
    <Card
      title="Site access"
      sub="Give people roles on a site. Anyone who manages sites can create these groups and add people; a site's own groups are also on its Users tab."
      pad="none"
    >
      <Table className="rb-stack groups-table" aria-label="Site access groups">
        <thead><tr><th>Group</th><th>Roles</th><th>Two-step sign-in</th><th className="num">Members</th></tr></thead>
        {p.rows.length === 0 && <tbody><EmptyRow colSpan={4}>{emptyText(p)}</EmptyRow></tbody>}
        {sections.map(({ site, rows }) => (
          <tbody key={site ?? '__several'} aria-label={site ?? 'Several sites'}>
            <tr className="groups-site-head">
              <th colSpan={4} scope="colgroup">
                <span className="row wrap gap-8">
                  <span className={site ? 'mono fw-medium' : 'fw-medium'}>{site ?? 'Several sites'}</span>
                  {site && <a className="small" href={sitesHref({ view: 'site', name: site, tab: 'users' })}>Open the site's Users tab</a>}
                </span>
              </th>
            </tr>
            {rows.map((row) => (
              <tr key={row.name} className="row-click" onClick={() => p.onOpen(row.name)}>
                <td className="nowrap" data-label="Group"><GroupName row={row} onOpen={p.onOpen} /></td>
                <td data-label="Roles"><Roles row={row} withApp={site === null} /></td>
                <td data-label="Two-step sign-in"><TwoFactorCell row={row} /></td>
                <td className="num" data-label="Members">{row.members}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </Table>
    </Card>
  );
}

export function PlatformGroupsTable(p: TableProps) {
  return (
    <Card
      title="Platform access"
      sub="Give roles on the platform itself: the console, its API, every organization. Only someone who already holds those rights can give them."
      pad="none"
    >
      <Table className="rb-stack groups-table" aria-label="Platform access groups">
        <thead><tr><th>Group</th><th>Gives</th><th>Two-step sign-in</th><th className="num">Members</th></tr></thead>
        <tbody>
          {p.rows.length === 0 && <EmptyRow colSpan={4}>{emptyText(p)}</EmptyRow>}
          {p.rows.map((row) => (
            <tr key={row.name} className="row-click" onClick={() => p.onOpen(row.name)}>
              <td className="nowrap" data-label="Group"><GroupName row={row} onOpen={p.onOpen} /></td>
              <td data-label="Gives">{row.kind === 'empty' ? <span className="small muted">no role yet</span> : <Roles row={row} withApp />}</td>
              <td data-label="Two-step sign-in"><TwoFactorCell row={row} /></td>
              <td className="num" data-label="Members">{row.members}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
