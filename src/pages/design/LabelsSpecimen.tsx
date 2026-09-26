import type { ReactNode } from 'react';
import { Badge, I } from '../../components/ui';
import { Method } from '../../components/ui/Primitives';
import { Specimen } from './Specimen';

/**
 * The label system: what each kind of label means and how it is drawn. No label is ever a capsule;
 * most have no container at all. The rules live in `Badge.tsx`; `ui-counts --check` enforces the shape.
 */
const ROLES: { role: string; pattern: string; use: string; example: ReactNode }[] = [
  {
    role: 'Status',
    pattern: 'Square marker (or icon) + words in the tone colour. No box.',
    use: 'Health and lifecycle: live, enabled, failed, inactive, needs a look.',
    example: <><Badge tone="success" mono={false}>Live</Badge><Badge tone="warning" mono={false}>inactive</Badge><Badge tone="danger" mono={false}>failed</Badge><Badge tone="info" icon={I.key} mono={false}>Vault</Badge><Badge tone="accent" mono={false}>org admin</Badge></>,
  },
  {
    role: 'Severity · risk',
    pattern: 'Icon + words in the tone colour; the row gets a 3px left accent bar.',
    use: 'Audit severity, risk level, flags that call for review.',
    example: <><Badge tone="success" icon={I.check} mono={false}>Low risk</Badge><Badge tone="warning" icon={I.alert} mono={false}>Medium risk</Badge><Badge tone="danger" icon={I.alert} mono={false}>High risk</Badge></>,
  },
  {
    role: 'Verdict',
    pattern: 'Check or cross + weighted words, one size up (className="verdict").',
    use: 'A decision the screen exists to show: ALLOWED, DENIED.',
    example: <><Badge tone="success" icon={I.check} className="verdict">ALLOWED</Badge><Badge tone="danger" icon={I.close} className="verdict">DENIED</Badge></>,
  },
  {
    role: 'Tag',
    pattern: 'Monospace in a square-cornered subtle box; tone="plain" is outline only.',
    use: 'Identifiers you might copy or search: groups, roles, permissions, scopes, rule ids, versions.',
    example: <><Badge>billing.read</Badge><Badge>admins</Badge><Badge>rule-7f3c</Badge><Badge tone="plain">v12</Badge></>,
  },
  {
    role: 'Meta',
    pattern: 'Small caps, muted, icon if any (tone="plain" mono={false}).',
    use: 'Something about the thing, not its health: draft, system, customized, member.',
    example: <><Badge tone="plain" mono={false} icon={I.edit}>draft</Badge><Badge tone="plain" mono={false}>system</Badge><Badge tone="plain" mono={false}>customized</Badge></>,
  },
  {
    role: 'Count',
    pattern: 'Bare tabular number, muted, beside what it counts. Inferred from the children.',
    use: 'Totals and overflow: tab counts, "+3 more".',
    example: <><span className="small">Members <Badge>12</Badge></span><Badge tone="plain">+3 more</Badge></>,
  },
  {
    role: 'Method',
    pattern: 'Coloured monospace word in a fixed column, no box.',
    use: 'HTTP methods on routes and rules.',
    example: <>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <Method key={m} m={m} />)}</>,
  },
];

export function LabelsSpecimen() {
  return (
    <Specimen name="Labels · Badge" note="What a label means picks how it looks. None of them is a capsule." wide>
      <div className="labels-guide">
        {ROLES.map((r) => (
          <div key={r.role} className="labels-guide-row">
            <div><div className="fw-medium text-sm">{r.role}</div><div className="small muted">{r.use}</div></div>
            <div className="small muted">{r.pattern}</div>
            <div className="row wrap gap-12">{r.example}</div>
          </div>
        ))}
      </div>
      <div className="grid g2">
        <div>
          <div className="fw-medium text-sm text-success mb-4">Do</div>
          <ul className="small muted labels-rules">
            <li>Say the state in words; colour and marker only back them up.</li>
            <li>Use a tag only for an identifier; words that describe go in status or meta.</li>
            <li>Show one status per cell: the most severe one.</li>
            <li>Put counts as plain numbers next to their label.</li>
          </ul>
        </div>
        <div>
          <div className="fw-medium text-sm text-danger mb-4">Don't</div>
          <ul className="small muted labels-rules">
            <li>Round a label into a capsule or pill: <code>ui-counts --check</code> fails on it.</li>
            <li>Fill a box with a tone colour to show a state.</li>
            <li>Box a count in a bubble.</li>
            <li>Rely on colour alone, or on a tooltip for the only copy of the words.</li>
          </ul>
        </div>
      </div>
    </Specimen>
  );
}
