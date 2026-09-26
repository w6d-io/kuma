import { Badge, Callout, I } from '../../components/ui';
import { isEverything } from '../../lib/rbacEdit';

export function ReadOnlyNote({ what }: { what: string }) {
  return (
    <Callout tone="neutral" icon={I.lock} className="mb-12">
      You can look around. Changing {what} needs an administrator with write access.
    </Callout>
  );
}

/** A role's permissions as chips, `*` spelt out as what it means. */
export function PermChips({ perms, max = 6 }: { perms: readonly string[]; max?: number }) {
  if (isEverything(perms)) {
    return (
      <Badge tone="accent" mono={false} title="Every route of this site except the organization routes" icon={I.sparkle}>
        Everything in this site
      </Badge>
    );
  }
  if (perms.length === 0) return <span className="small muted">no permission</span>;
  const shown = perms.slice(0, max);
  return (
    <span className="row wrap gap-4">
      {shown.map(p => <Badge key={p}>{p}</Badge>)}
      {perms.length > max && <span className="small muted">+{perms.length - max} more</span>}
    </span>
  );
}
