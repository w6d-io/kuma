import { Fragment, useMemo, useState } from 'react';
import { useEnforcedConfig } from '../api/hooks';
import { YamlView, CopyButton } from '../components/YamlView';
import { Method } from '../components/ui/Primitives';
import { Badge, Button, ButtonBase, Callout, Card, EmptyHint, PageHeader, cx } from '../components/ui';
import { I } from '../components/ui/Icons';
import type { EnforcedDocument, EnforcedEdge, EnforcedGrant, EnforcedRole } from '../api/client';
import { sharedTables, splitByKind } from '../policy/edges';
import { SkeletonPanel, SkeletonTiles } from '../components/ui/Skeleton';

/**
 * What protects each API, and who can reach it.
 *
 * This screen replaced a "Services" workspace that kept its own registry of APIs — their roles,
 * their route tables, their gateway rules — and let an operator edit it. Nothing read that registry
 * any more, so the edits looked applied and changed nothing. The question the workspace existed to
 * answer is still a real one; it is answered here, against the objects the engines actually load.
 *
 * What actually decides, as it reads in the repository.
 *
 * This console used to EDIT these rules, and the engines used to fetch them from the service behind
 * it. Neither is true now: the edge is fed from `Rule` resources and the policy engine from labelled
 * ConfigMaps, both synced from Git by Argo. An editor would therefore write somewhere nothing reads,
 * and — worse — would look like it worked until somebody wondered why nothing changed.
 *
 * So the screen shows and does not offer. It is not a reduced editor: it answers the question an
 * operator actually has at 03:00, which is "what is in force right now", and it answers it with the
 * object rather than with a rendering of it that could disagree.
 */
/**
 * What each route requires, as a table.
 *
 * The YAML is the authority and stays one click away, but nobody audits a permission model by
 * reading indented JSON. What a reader actually asks is "which routes are open, and who can reach
 * the rest" — so the class is shown as a word, and each permission is traced back to the roles that
 * carry it. A permission no role carries is the interesting case: the route is unreachable by
 * anybody, and it looks identical to a missing right from the caller's side.
 */
/**
 * The whole chain behind one route, opened on demand.
 *
 * "This route needs `context:read`" answers half the question somebody came with. The half that
 * matters is how anybody comes to hold it — so the chain is followed to its end: permission, the
 * roles carrying it, and the people holding those roles, per organisation.
 *
 * There is no group in this chain, and its absence is the finding rather than an omission: what the
 * engine enforces binds a PERSON to roles in an organisation, one grant at a time.
 */
/** As `groups.json` writes it: a group granting here grants wherever the holder happens to be. */
const EVERY_ORGANISATION = '*';

function Chain({ permission, roles, grants }: { permission: string; roles: EnforcedRole[]; grants: EnforcedGrant[] }) {
  const carriers = roles.filter(r => r.permissions.includes(permission) || r.permissions.includes('*'));

  if (carriers.length === 0) {
    return (
      <div className="chain">
        <span className="small text-danger">
          No role carries <span className="mono">{permission}</span>, so nobody can reach this route —
          which, from the caller&apos;s side, is indistinguishable from lacking the right.
        </span>
      </div>
    );
  }

  return (
    <div className="chain">
      {carriers.map(carrier => {
        // Who holds this role, and where. A grant names an organisation, so the same person can hold
        // the role in one and not in another — showing the person without the organisation would
        // claim more than the grant does.
        const holders = grants
          .map(g => ({ ...g, held: g.held.filter(h => h.roles.includes(carrier.role)) }))
          .filter(g => g.held.length > 0);

        return (
          <div key={carrier.role} className="chain-step">
            <div className="chain-head">
              <Badge>{permission}</Badge>
              <span className="chain-arrow" aria-hidden="true">←</span>
              <span className="small muted">carried by role</span>
              <Badge tone="plain">{carrier.role}</Badge>
            </div>
            {holders.length === 0 ? (
              <span className="small text-danger">
                Nobody holds <span className="mono">{carrier.role}</span> anywhere.
              </span>
            ) : (
              <ul className="chain-holders">
                {holders.map(holder => (
                  <li key={holder.subject}>
                    {/* The address for a reader, the identifier when nothing can name it — a grant
                        nobody can attribute is more interesting than one that can be, not less. */}
                    <span className={holder.email ? '' : 'mono'}>
                      {holder.email ?? holder.subject}
                    </span>
                    <span className="small muted"> in </span>
                    {holder.held.map(h => (
                      <span key={h.organisation}>
                        {/* The name for a reader, the identifier in the tooltip and when nothing can
                            name it. `*` is the model's own way of saying every one, so it is said in
                            words rather than shown as a symbol nobody outside the file recognises. */}
                        <Badge tone="plain" title={h.organisation}>
                          {h.organisation === EVERY_ORGANISATION
                            ? 'every organisation'
                            : (h.organisationName ?? h.organisation)}
                        </Badge>
                        {/* WHY they hold it. Without the group a reader sees the role and has no way
                            to know what to change to take it away. */}
                        {h.viaGroups?.length ? (
                          <span className="small muted">
                            {' via '}
                            <span className="mono">{h.viaGroups.join(', ')}</span>
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}


/**
 * The rule, in the terms somebody asks in: what gets in, how it is identified, where it goes — and
 * which route table decides it.
 *
 * That last row is not in the rule. The authorizer's payload names a service and the policy selects
 * the table by that name, so a reader looking only at the rule cannot tell what decides it. Showing
 * it here is the whole point: a rule can be perfectly formed and point at a table nothing declares.
 */
function EdgeSummary({ edge }: { edge: EnforcedEdge }) {
  return (
    <dl className="edge-summary">
      <div>
        <dt>Matches</dt>
        <dd className="mono">{edge.url || <span className="muted">anything</span>}</dd>
      </div>
      <div>
        <dt>Methods</dt>
        <dd>{edge.methods.length > 0 ? edge.methods.join(' · ') : <span className="muted">any</span>}</dd>
      </div>
      <div>
        <dt>Caller identified by</dt>
        <dd>
          {edge.authenticators.length > 0
            ? edge.authenticators.map(a => <Badge key={a} tone="plain">{a}</Badge>)
            /* An edge that identifies nobody forwards everybody, whatever the table below says. */
            : <span className="text-danger">nothing — every caller is anonymous here</span>}
        </dd>
      </div>
      <div>
        <dt>Forwarded to</dt>
        <dd className="mono">{edge.upstream ?? <span className="muted">—</span>}</dd>
      </div>
      <div>
        <dt>Decided against</dt>
        <dd>
          {!edge.authorizesAs ? (
            <span className="muted">
              the edge configuration could not be read, so which table decides this rule is unknown
            </span>
          ) : (
            <>
              <Badge tone={edge.tableDeclared === false ? 'warning' : 'plain'}>{edge.authorizesAs}</Badge>
              {edge.tableDeclared === false && (
                <span className="small text-danger">
                  {' '}— no loaded document declares routes for it, so every call here is refused for
                  a reason nothing on this rule shows.
                </span>
              )}
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Two rules decided against the same table.
 *
 * The service is named in the engine's payload, not in the rule, so rules that do not carry their
 * own payload all inherit one value. With one API that is invisible; with two, the second is
 * authorized against the first one's routes — and it reads as "everything is refused".
 */
function SharedTableWarning({ documents }: { documents: EnforcedDocument[] }) {
  const shared = sharedTables(documents);
  if (shared.length === 0) return null;

  return (
    <Callout tone="warning" icon={I.alert} className="edge-warning">
      {shared.map(({ table, rules }) => (
        <p key={table}>
          <strong>{rules.length} rules are decided against the same route table.</strong>{' '}
          <span className="mono">{rules.join(', ')}</span> all authorize as{' '}
          <span className="mono">{table}</span>. The service is named in the engine&apos;s payload
          rather than in the rule, so a rule that carries no payload of its own inherits that one
          value — and is matched against another API&apos;s routes.
        </p>
      ))}
    </Callout>
  );
}

function RouteTable({
  routes,
  roles,
  grants,
}: {
  routes: NonNullable<EnforcedDocument['routes']>;
  roles: EnforcedRole[];
  grants: EnforcedGrant[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const carriedBy = (permission: string) =>
    roles.filter(r => r.permissions.includes(permission) || r.permissions.includes('*')).map(r => r.role);

  return (
    <table className="enforced-routes">
      <thead>
        <tr>
          <th>Method</th>
          <th>Path</th>
          <th>Requires</th>
          <th>Permission</th>
          <th>Held by</th>
        </tr>
      </thead>
      <tbody>
        {routes.map(route => {
          const holders = route.permission ? carriedBy(route.permission) : [];
          const id = `${route.method} ${route.path}`;
          return (
            <Fragment key={id}>
            <tr
              className={route.permission ? 'expandable' : ''}
              onClick={() => route.permission && setOpen(open === id ? null : id)}
            >
              <td><Method m={route.method} /></td>
              <td className="mono">{route.path}</td>
              <td>
                <Badge tone={route.class === 'authorized' ? 'success' : route.class === 'public' ? 'warning' : 'plain'}>
                  {route.class === 'public'
                    ? 'nothing'
                    : route.class === 'authenticated'
                      ? 'a session'
                      : 'a permission'}
                </Badge>
              </td>
              <td>{route.permission ? <Badge>{route.permission}</Badge> : <span className="small muted">—</span>}</td>
              <td>
                {!route.permission
                  ? <span className="small muted">—</span>
                  : holders.length > 0
                    ? <span className="row gap-4 wrap">{holders.map(r => <Badge key={r} tone="plain">{r}</Badge>)}</span>
                    /* Not cosmetic: a permission no role carries makes the route unreachable by
                       everybody, and from the caller's side that is indistinguishable from lacking
                       the right. */
                    : <span className="small text-danger">no role carries it</span>}
              </td>
            </tr>
            {open === id && route.permission && (
              <tr className="chain-row">
                <td colSpan={5}>
                  <Chain permission={route.permission} roles={roles} grants={grants} />
                </td>
              </tr>
            )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export function ApisPage() {
  const query = useEnforcedConfig();
  const documents = useMemo(() => query.data ?? [], [query.data]);
  const [selected, setSelected] = useState<string | null>(null);
  const [asYaml, setAsYaml] = useState(false);
  // Every role the platform defines, wherever it was declared — the routes of one document are
  // almost never in the same document as the roles that satisfy them.
  const roles = useMemo(() => documents.flatMap(d => d.roles ?? []), [documents]);
  const grants = useMemo(() => documents.flatMap(d => d.grants ?? []), [documents]);
  const { edges, model } = useMemo(() => splitByKind(documents), [documents]);

  const current = documents.find(d => `${d.kind}/${d.name}` === selected) ?? documents[0];

  if (query.isLoading) {
    return (
      <div aria-busy="true" aria-label="Reading what is enforced">
        <SkeletonTiles count={3} />
        <div className="mt-12"><SkeletonPanel lines={5} /></div>
      </div>
    );
  }

  if (query.isError) {
    // Deliberately not an empty list: "nothing is enforced" is the one answer that is certainly
    // wrong, and it is the one an empty screen gives.
    return (
      <Card className="p-24">
        <EmptyHint>
          Couldn&apos;t read the enforced configuration — {(query.error as Error).message}. What is in
          force is unchanged; only this view is unavailable.
        </EmptyHint>
      </Card>
    );
  }

  if (documents.length === 0) {
    return (
      <Card className="p-24">
        <EmptyHint>Nothing is loaded by the engines in this namespace.</EmptyHint>
      </Card>
    );
  }

  return (
    <div className="enforced">
      <PageHeader
        title="APIs"
        sub="What protects each one, and who can reach it — read from the objects the engines load"
      />

      <div className="enforced-note small muted">
        Read-only. These objects are synced from Git by Argo — change them there, not here. What you
        see is the object each engine loads, not a rendering of it.
      </div>

      <SharedTableWarning documents={edges} />

      <div className="enforced-split">
        <aside className="enforced-list" aria-label="Enforced documents">
          {/* APIs first, the shared model after: a reader comes here for an API, and the model is
              the thing every one of them is decided against rather than one more entry in the list. */}
          {[
            { heading: 'APIs', items: edges },
            { heading: 'The model they are decided against', items: model },
          ].map(group => group.items.length === 0 ? null : (
            <Fragment key={group.heading}>
              <h2 className="enforced-group">{group.heading}</h2>
              {group.items.map(d => {
                const id = `${d.kind}/${d.name}`;
                return (
                  <ButtonBase
                    key={id}
                    className={cx('enforced-item', current && id === `${current.kind}/${current.name}` && 'active')}
                    onClick={() => setSelected(id)}
                  >
                    <span className="enforced-item-head">
                      <span className="mono">{d.name}</span>
                      {d.edge?.tableDeclared === false && <Badge tone="warning">no route table</Badge>}
                    </span>
                    <span className="enforced-item-decides small muted">{d.decides}</span>
                  </ButtonBase>
                );
              })}
            </Fragment>
          ))}
        </aside>

        {current && (
          <section className="enforced-doc panel">
            <header className="enforced-doc-head">
              <span className="mono">
                {current.namespace}/{current.name}
              </span>
              <span className="row gap-4">
                <span className="small muted">{current.kind}</span>
                {current.routes && current.routes.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setAsYaml(v => !v)}>
                    {asYaml ? 'Routes' : 'YAML'}
                  </Button>
                )}
                <CopyButton text={current.yaml} />
              </span>
            </header>
            {/* For a rule, the summary is what the reader came for; the object stays below it. */}
            {current.edge && <EdgeSummary edge={current.edge} />}
            {current.routes && current.routes.length > 0 && !asYaml
              ? <RouteTable routes={current.routes} roles={roles} grants={grants} />
              : <YamlView value={current.yaml} ariaLabel={`${current.kind} ${current.name} as YAML`} />}
          </section>
        )}
      </div>
    </div>
  );
}
