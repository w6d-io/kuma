import type { AuditActor } from '../../api/audit';
import { Button, I } from '../../components/ui';
import { useActor, useReveal } from './useActor';

export function ActorCell({ actor }: { actor: AuditActor }) {
  const { label } = useActor(actor);
  return (
    <span className="audit-actor">
      <span className={`audit-actor-dot ${label.kind}`} aria-hidden="true">{label.kind === 'system' ? I.cog : label.kind === 'user' ? '' : '?'}</span>
      <span className="min-w-0">
        <span className="small audit-clip">{label.primary}</span>
        {label.secondary && <span className="text-xs muted audit-clip">{label.secondary}</span>}
      </span>
    </span>
  );
}

/** The actor in the detail: the id, and a Reveal button until it has been looked up. */
export function ActorReveal({ actor }: { actor: AuditActor }) {
  const { label, revealed } = useActor(actor);
  const { reveal, busy, refused } = useReveal();
  const id = actor.type === 'user' ? actor.id : null;
  return (
    <div className="col gap-4">
      <div className="small">{label.primary}{label.secondary && <span className="muted"> · {label.secondary}</span>}</div>
      {id && <div className="mono text-xs muted">{id}</div>}
      {id && !revealed && (
        <div>
          <Button size="sm" variant="ghost" icon={I.search} loading={busy === id} onClick={() => void reveal(id)}>Reveal</Button>
        </div>
      )}
      {refused === id && <div className="text-xs text-warning">You cannot look this person up.</div>}
    </div>
  );
}
