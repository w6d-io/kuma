import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button, ButtonBase, Callout, Card, CodeView, EmptyRow, I, Input, Select, Switch, Table, Th, cx } from '../../../components/ui';
import { Method } from '../../../components/ui/Primitives';
import { displayPath } from '../../../lib/sites/paths';
import { routeProblems } from '../../../lib/sites/validate';
import { expandRolePermissions } from '../../../lib/sites/access';
import { allowsAnonymous } from '../../../lib/sites/presets';
import type { Access, Route } from '../../../lib/sites/types';
import type { SiteEditor } from '../useSiteEditor';
import type { Go } from '../SiteDetail';
import { AccessBadge, CheckList } from '../parts';
import { checkLines } from '../../../lib/sites/format';
import { RouteEditor } from './RouteEditor';
import { UrlTester } from './UrlTester';

/**
 * Routes & protection (site-ux.md §6): the tester on top, then every route with its methods, path,
 * gate and access, and "Everything else" last. Rows are edited inline; problems are said on the row
 * (format, here) and in the list below the table (gatekit overlap and ties, from the preview).
 */

function nextId(items: Route[]): string {
  let n = items.length + 1;
  while (items.some((r) => r.id === `r${n}`)) n++;
  return `r${n}`;
}

export function RoutesTab({ ed, readOnly, query, go }: { ed: SiteEditor; readOnly: boolean; query: Record<string, string>; go: Go }) {
  const site = ed.site;
  const [editing, setEditing] = useState<string | null>(query.route ?? null);
  const [filter, setFilter] = useState('');
  const [gateFilter, setGateFilter] = useState('');
  const [expert, setExpert] = useState(query.level === 'expert');
  const problems = useMemo(() => routeProblems(site?.routes.items ?? []), [site]);
  if (!site) return <Callout tone="warning" icon={I.alert}>This draft is incomplete; finish it in the wizard or discard it.</Callout>;

  const items = site.routes.items;
  const gates = site.gates;
  const permissions = [...new Set([
    ...items.flatMap((r) => (r.access.kind === 'permission' ? [r.access.permission] : [])),
    ...Object.values(expandRolePermissions(site)).flat().filter((p) => p !== '*'),
  ])].sort();
  const gateLabel = (id: string) => gates.find((g) => g.id === id)?.label ?? id;
  const setItems = (fn: (rs: Route[]) => Route[]) => ed.update((s) => ({ ...s, routes: { ...s.routes, items: fn(s.routes.items) } }));
  const setCatchAll = (c: { gate: string; access: Access }) => ed.update((s) => ({ ...s, routes: { ...s.routes, catchAll: c } }));
  const shown = items
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => (!gateFilter || r.gate === gateFilter) && (!filter || r.path.includes(filter) || displayPath(r.path).includes(filter)));

  const add = () => {
    const authGate = gates.find((g) => !allowsAnonymous(g)) ?? gates[0];
    const id = nextId(items);
    setItems((rs) => [...rs, { id, methods: ['GET'], path: site.address.pathPrefix ? `${site.address.pathPrefix}/new` : '/new', gate: authGate.id, access: { kind: 'signed-in' }, source: 'manual' }]);
    setEditing(id);
  };

  const preview = ed.preview.state === 'ok' ? ed.preview.preview : null;
  const routeChecks = preview?.checks.filter((c) => c.path?.startsWith('routes')) ?? [];
  const catchAll = site.routes.catchAll;

  return (
    <div className="stack gap-16">
      <UrlTester site={site} initial={query.test} hasDraft={ed.hasDraft} onChange={(test) => go('routes', { ...query, test })} />

      <Card
        pad="none"
        title={`Routes · ${items.length} route${items.length === 1 ? '' : 's'} · ${gates.length} gate${gates.length === 1 ? '' : 's'}`}
        actions={<>
          <Field2 label="Expert"><Switch on={expert} onChange={setExpert} label="Expert: show gateway patterns" /></Field2>
          {!readOnly && <Button size="sm" variant="primary" icon={I.plus} kbd="a" onClick={add}>Add route</Button>}
        </>}
      >
        <div className="site-toolbar p-12">
          <Select size="sm" aria-label="Filter by gate" value={gateFilter} onChange={(e) => setGateFilter(e.target.value)}>
            <option value="">All gates</option>
            {gates.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </Select>
          <Input size="sm" mono leading={I.search} aria-label="Search path" placeholder="search path" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <Table className="site-routes" aria-label="Routes">
          <thead>
            <tr><Th>#</Th><Th>Methods</Th><Th>Path</Th><Th>Gate</Th><Th>Access</Th><Th>Org</Th></tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <EmptyRow colSpan={6}>Nothing is mapped yet, so every request goes to <b>Everything else</b> ({catchAll.access.kind === 'permission' ? catchAll.access.permission : catchAll.access.kind}). Add your first route.</EmptyRow>
            )}
            {shown.map(({ r, i }) => {
              const problem = problems[r.id];
              const open = editing === r.id && !readOnly;
              return (
                <Fragment key={r.id}>
                  <tr className={cx(problem && 'site-row-problem', open && 'site-row-open')}>
                    <td className="small muted tabular">{problem ? <span className="text-warning" role="img" aria-label="problem">{I.alert}</span> : i + 1}</td>
                    <td><span className="site-method-list">{r.methods.map((m) => <Method key={m} m={m} />)}</span></td>
                    <td>
                      {readOnly
                        ? <span className="mono">{displayPath(r.path)}</span>
                        : <ButtonBase className="site-row-name mono" aria-expanded={open} onClick={() => setEditing(open ? null : r.id)}>{displayPath(r.path)}</ButtonBase>}
                      {problem && !open && <div className="small text-warning">{problem}</div>}
                    </td>
                    <td className="small">{r.access.kind === 'deny' ? '—' : gateLabel(r.gate)}</td>
                    <td><AccessBadge access={r.access} /></td>
                    <td className="small mono">{r.orgParam ? `:${r.orgParam}` : ''}</td>
                  </tr>
                  {open && (
                    <tr className="site-row-editor">
                      <td colSpan={6}>
                        <RouteEditor
                          route={r}
                          gates={gates}
                          permissions={permissions}
                          rowNumber={i + 1}
                          problem={problem}
                          onChange={(next) => setItems((rs) => rs.map((x) => (x.id === r.id ? { ...next, pinned: next.source === 'openapi' ? true : next.pinned } : x)))}
                          onDelete={() => { setItems((rs) => rs.filter((x) => x.id !== r.id)); setEditing(null); }}
                          onDone={() => setEditing(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <tr className="site-catchall">
              <td className="small muted">∗</td>
              <td className="small">any method</td>
              <td><span className="fw-medium">Everything else</span><div className="small muted">Requests that match no route above.</div></td>
              <td>
                {readOnly ? <span className="small">{gateLabel(catchAll.gate)}</span> : (
                  <Select size="sm" aria-label="Everything else: gate" value={catchAll.gate} onChange={(e) => setCatchAll({ ...catchAll, gate: e.target.value })}>
                    {gates.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </Select>
                )}
              </td>
              <td>
                {readOnly ? <AccessBadge access={catchAll.access} /> : (
                  <Select size="sm" aria-label="Everything else: access" value={catchAll.access.kind} onChange={(e) => {
                    const k = e.target.value as Access['kind'];
                    setCatchAll({ ...catchAll, access: k === 'permission' ? { kind: 'permission', permission: permissions[0] ?? `${site.name}:read` } : { kind: k } as Access });
                  }}>
                    <option value="signed-in">Signed-in</option>
                    <option value="permission">Needs permission</option>
                    <option value="public">Public</option>
                    <option value="deny">Refused</option>
                  </Select>
                )}
                {!readOnly && catchAll.access.kind === 'permission' && (
                  <Input size="sm" mono className="mt-4" aria-label="Everything else: permission" value={catchAll.access.permission} onChange={(e) => setCatchAll({ ...catchAll, access: { kind: 'permission', permission: e.target.value.trim() } })} />
                )}
              </td>
              <td />
            </tr>
          </tbody>
        </Table>
      </Card>

      {ed.preview.state === 'unavailable' && <Callout tone="warning" icon={I.alert}>{ed.preview.message}</Callout>}
      {routeChecks.length > 0 && (
        <Card title="Conflicts and warnings" sub="From the gateway’s own matcher (gatekit), against every live rule">
          <CheckList lines={checkLines(routeChecks)} />
        </Card>
      )}
      {expert && preview && (
        <Card title="Gateway patterns (generated)" sub="Read-only here; override a gate’s pattern on Gates → Expert.">
          {preview.artefacts.rules.map((rule) => (
            <div key={rule.id} className="mb-8">
              <div className="row gap-8 items-center"><Badge>{rule.id}</Badge><span className="small muted">{rule.match.methods.join(' ')}</span></div>
              <CodeView code={rule.match.url} title="match.url" wrap />
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Field2({ label, children }: { label: string; children: ReactNode }) {
  return <span className="row gap-4 items-center small muted">{label}{children}</span>;
}
