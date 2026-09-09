import { useMemo, useState } from 'react';
import { useEnforcedConfig } from '../api/hooks';
import { YamlView, CopyButton } from '../components/YamlView';
import { Chip, EmptyHint, Method } from '../components/ui/Primitives';
import type { EnforcedDocument, EnforcedRole } from '../api/client';

/**
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
function RouteTable({ routes, roles }: { routes: NonNullable<EnforcedDocument['routes']>; roles: EnforcedRole[] }) {
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
          return (
            <tr key={`${route.method} ${route.path}`}>
              <td><Method m={route.method} /></td>
              <td className="mono">{route.path}</td>
              <td>
                <Chip tone={route.class === 'authorized' ? 'ok' : route.class === 'public' ? 'warn' : 'plain'}>
                  {route.class === 'public'
                    ? 'nothing'
                    : route.class === 'authenticated'
                      ? 'a session'
                      : 'a permission'}
                </Chip>
              </td>
              <td>{route.permission ? <Chip>{route.permission}</Chip> : <span className="small muted">—</span>}</td>
              <td>
                {!route.permission
                  ? <span className="small muted">—</span>
                  : holders.length > 0
                    ? <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{holders.map(r => <Chip key={r} tone="plain">{r}</Chip>)}</span>
                    /* Not cosmetic: a permission no role carries makes the route unreachable by
                       everybody, and from the caller's side that is indistinguishable from lacking
                       the right. */
                    : <span className="small" style={{ color: 'var(--err)' }}>no role carries it</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function EnforcedPage() {
  const query = useEnforcedConfig();
  const documents = useMemo(() => query.data ?? [], [query.data]);
  const [selected, setSelected] = useState<string | null>(null);
  const [asYaml, setAsYaml] = useState(false);
  // Every role the platform defines, wherever it was declared — the routes of one document are
  // almost never in the same document as the roles that satisfy them.
  const roles = useMemo(() => documents.flatMap(d => d.roles ?? []), [documents]);

  const current = documents.find(d => `${d.kind}/${d.name}` === selected) ?? documents[0];

  if (query.isLoading) {
    return (
      <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
        <span className="small muted">Reading what is enforced…</span>
      </div>
    );
  }

  if (query.isError) {
    // Deliberately not an empty list: "nothing is enforced" is the one answer that is certainly
    // wrong, and it is the one an empty screen gives.
    return (
      <div className="panel" style={{ padding: 20 }}>
        <EmptyHint>
          Couldn&apos;t read the enforced configuration — {(query.error as Error).message}. What is in
          force is unchanged; only this view is unavailable.
        </EmptyHint>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="panel" style={{ padding: 20 }}>
        <EmptyHint>Nothing is loaded by the engines in this namespace.</EmptyHint>
      </div>
    );
  }

  return (
    <div className="enforced">
      <div className="enforced-note small muted">
        Read-only. These objects are synced from Git by Argo — change them there, not here. What you
        see is the object each engine loads, not a rendering of it.
      </div>

      <div className="enforced-split">
        <aside className="enforced-list" aria-label="Enforced documents">
          {documents.map(d => {
            const id = `${d.kind}/${d.name}`;
            return (
              <button
                key={id}
                className={`enforced-item ${current && id === `${current.kind}/${current.name}` ? 'active' : ''}`}
                onClick={() => setSelected(id)}
              >
                <span className="enforced-item-head">
                  <span className="mono">{d.name}</span>
                  <Chip tone="plain">{d.kind}</Chip>
                </span>
                <span className="enforced-item-decides small muted">{d.decides}</span>
              </button>
            );
          })}
        </aside>

        {current && (
          <section className="enforced-doc panel">
            <header className="enforced-doc-head">
              <span className="mono">
                {current.namespace}/{current.name}
              </span>
              <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                <span className="small muted">{current.kind}</span>
                {current.routes && current.routes.length > 0 && (
                  <button className="btn ghost sm" onClick={() => setAsYaml(v => !v)}>
                    {asYaml ? 'Routes' : 'YAML'}
                  </button>
                )}
                <CopyButton text={current.yaml} />
              </span>
            </header>
            {current.routes && current.routes.length > 0 && !asYaml
              ? <RouteTable routes={current.routes} roles={roles} />
              : <YamlView value={current.yaml} ariaLabel={`${current.kind} ${current.name} as YAML`} />}
          </section>
        )}
      </div>
    </div>
  );
}
