import { Badge, Field, I } from '../../components/ui';
import { secretState } from '../../lib/gateway/logic';

/**
 * A secret in the gateway config. The operator refuses secrets in the rendered config (it is
 * readable in the cluster), so they are set by the platform — chart values, from a Kubernetes
 * Secret — and shown here read-only, never typed.
 */
export function SecretField({ label, value, required }: { label: string; value: unknown; required?: boolean }) {
  const st = secretState(value);
  return (
    <Field label={<>{label}{required && <span className="field-required" aria-hidden="true"> *</span>}</>} hint="Set by the platform (chart values, from a Secret). It can’t be changed from the console.">
      <div className="row gap-8 items-center">
        {st === 'masked'
          ? <Badge tone="success" mono={false} icon={I.lock}>set by the platform</Badge>
          : st === 'typed'
            ? <Badge tone="danger" mono={false} icon={I.alert}>a value is in the config — it will be refused</Badge>
            : <Badge tone="neutral" mono={false} icon={I.lock}>not set</Badge>}
      </div>
    </Field>
  );
}
