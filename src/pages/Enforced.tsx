import { useMemo, useState } from 'react';
import { useEnforcedConfig } from '../api/hooks';
import { YamlView, CopyButton } from '../components/YamlView';
import { Chip, EmptyHint } from '../components/ui/Primitives';

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
export function EnforcedPage() {
  const query = useEnforcedConfig();
  const documents = useMemo(() => query.data ?? [], [query.data]);
  const [selected, setSelected] = useState<string | null>(null);

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
                <CopyButton text={current.yaml} />
              </span>
            </header>
            <YamlView value={current.yaml} ariaLabel={`${current.kind} ${current.name} as YAML`} />
          </section>
        )}
      </div>
    </div>
  );
}
