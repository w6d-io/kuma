import { useMemo, useState } from 'react';
import {
  Avatar, Badge, Button, Callout, Card, EmptyHint, EmptyRow, EmptyState, I, LoadingRows, PageHeader,
  Pagination, SkeletonText, Stat, Table, Th, Tooltip, nextSort, sortRows, type BadgeTone, type SortState,
} from '../../components/ui';
import { Method } from '../../components/ui/Primitives';
import { SectionTitle, Specimen, State } from './Specimen';

const TONES: BadgeTone[] = ['neutral', 'accent', 'success', 'warning', 'danger', 'info', 'plain'];
const PEOPLE = [
  { name: 'Ada Lovelace', email: 'ada@acme.io', groups: 3, seen: '2 min ago' },
  { name: 'Grace Hopper', email: 'grace@acme.io', groups: 1, seen: 'yesterday' },
  { name: 'Alan Turing', email: 'alan@acme.io', groups: 5, seen: 'never' },
];

export function SurfacesSection() {
  const [sort, setSort] = useState<SortState<'name' | 'groups'> | null>({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(0);
  const rows = useMemo(() => (sort ? sortRows(PEOPLE, (p) => p[sort.key], sort.dir) : PEOPLE), [sort]);
  const onSort = (k: 'name' | 'groups') => setSort((s) => nextSort(s, k));
  return (
    <>
      <SectionTitle id="surfaces" title="Surfaces" sub="Where content sits: headers, cards, badges, tables, empty states." />
      <Specimen name="PageHeader" wide>
        <PageHeader eyebrow="Sites" title="billing.acme.io" status={<Badge tone="success" icon={I.check} mono={false}>Live</Badge>} sub="Acme's invoicing app · 42 people · 2 organizations" actions={<><Button>Pause</Button><Button variant="primary" icon={I.edit}>Edit site</Button></>} />
      </Specimen>
      <div className="specimen-grid">
        <Specimen name="Card">
          <Card title="Security signals" sub="Risk activity in the last 24 h" actions={<Button variant="ghost" size="sm">Open →</Button>}>
            Body with <code>pad="md"</code> (the default under a header).
          </Card>
          <Card pad="md" tone="muted" className="mt-12">Muted card without a header.</Card>
        </Specimen>
        <Specimen name="Stat">
          <div className="grid g2">
            <Stat label="Users" value={1284} sub="1 190 active" />
            <Stat label="Denials" value={17} tone="danger" sub="loaded window" onClick={() => {}} />
          </div>
        </Specimen>
        <Specimen name="Callout" note="Tone in the rule and icon, words say what to do.">
          <div className="col gap-8">
            <Callout icon={I.info}>Changes reach the engine within 40 s.</Callout>
            <Callout tone="success" icon={I.check} title="Factor proven">Review the change below, then apply it.</Callout>
            <Callout tone="warning" icon={I.alert} title="Shared host">Another site serves app.acme.io.</Callout>
            <Callout tone="danger" icon={I.alert} actions={<Button size="sm">Retry</Button>}>The engine could not be reached.</Callout>
            <Callout tone="neutral">Read-only: this org is managed from Git.</Callout>
          </div>
        </Specimen>
        <Specimen name="Badge · Method · Tooltip · Avatar">
          <State label="tones"><div className="row wrap gap-4">{TONES.map((t) => <Badge key={t} tone={t}>{t}</Badge>)}</div></State>
          <State label="icon + words"><div className="row wrap gap-4"><Badge tone="success" icon={I.lock} mono={false}>2FA on</Badge><Badge tone="warning" icon={I.alert} mono={false}>2FA off</Badge></div></State>
          <State label="methods"><div className="row wrap gap-4">{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <Method key={m} m={m} />)}</div></State>
          <State label="tooltip (hover or focus)"><Tooltip content="Copies the identity id"><Badge>7f3c…a91</Badge></Tooltip></State>
          <State label="avatars"><div className="row gap-4"><Avatar name="Ada Lovelace" /><Avatar name="Grace Hopper" size={26} /><Avatar email="alan@acme.io" size={32} /></div></State>
        </Specimen>
      </div>
      <Specimen name="Table" note="Sortable header (aria-sort), row click, empty and loading rows, pagination." wide>
        <div className="grid g2">
          <Card pad="none">
            <Table>
              <thead><tr>
                <Th sortKey="name" sort={sort} onSort={onSort}>Identity</Th>
                <Th sortKey="groups" sort={sort} onSort={onSort} align="right">Groups</Th>
                <Th>Last seen</Th>
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.email} className="row-click" tabIndex={0}>
                    <td><div className="row gap-8"><Avatar name={p.name} /><div><div className="fw-medium">{p.name}</div><div className="small muted mono">{p.email}</div></div></div></td>
                    <td className="align-right tabular">{p.groups}</td>
                    <td className="small muted nowrap">{p.seen}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={3} total={40} onPageChange={setPage} onPageSizeChange={() => {}} />
          </Card>
          <div className="col gap-12">
            <Card pad="none"><Table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><EmptyRow colSpan={2}>No API keys yet.</EmptyRow></tbody></Table></Card>
            <Card pad="none"><Table aria-busy><thead><tr><th>Name</th><th>Status</th><th>When</th></tr></thead><tbody><LoadingRows cols={3} rows={3} /></tbody></Table></Card>
          </div>
        </div>
      </Specimen>
      <div className="specimen-grid">
        <Specimen name="EmptyState">
          <Card><EmptyState icon={I.globe} title="No sites yet" action={<Button variant="primary" icon={I.plus}>Plug a site</Button>}>Plug an app to put sign-in and permissions in front of it.</EmptyState></Card>
        </Specimen>
        <Specimen name="EmptyHint · Skeleton">
          <State label="EmptyHint"><Card><EmptyHint>No sessions.</EmptyHint></Card></State>
          <State label="SkeletonText"><SkeletonText lines={3} /></State>
        </Specimen>
      </div>
    </>
  );
}
