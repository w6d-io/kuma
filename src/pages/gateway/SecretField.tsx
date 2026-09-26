import { useState } from 'react';
import { Badge, Button, Field, I, Input } from '../../components/ui';
import { secretState, vaultRef, vaultRefProblem } from '../../lib/gateway/logic';

/**
 * A secret in the gateway config. Its value is never shown or typed here: it is either set (masked
 * by the server) or a Vault reference kuma sends; the gateway reads the value from Vault when it
 * restarts.
 */
export function SecretField({ label, value, onChange, disabled, required }: {
  label: string; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; required?: boolean;
}) {
  const st = secretState(value);
  const [ref, setRef] = useState(st === 'vault' ? (value as { vault: string }).vault : '');
  const [editing, setEditing] = useState(st === 'empty' || st === 'plaintext');
  const problem = editing && ref ? vaultRefProblem(ref) : null;
  const badge = st === 'masked' ? <Badge tone="success" mono={false} icon={I.lock}>set · hidden</Badge>
    : st === 'vault' ? <Badge tone="info" mono={false} icon={I.key}>Vault</Badge>
    : st === 'plaintext' ? <Badge tone="danger" mono={false} icon={I.alert}>typed value — refused</Badge>
    : <Badge tone="neutral" mono={false}>not set</Badge>;

  return (
    <Field
      label={<>{label}{required && <span className="field-required" aria-hidden="true"> *</span>} {badge}</>}
      hint={editing ? 'A Vault reference: kv/path#key. The value itself never passes through kuma.' : undefined}
      error={problem ?? undefined}
    >
      {editing ? (
        <div className="row gap-8 items-center">
          <Input size="sm" mono aria-label={`${label}: Vault reference`} placeholder="kv/auth/hydrator#password" value={ref} disabled={disabled}
            onChange={(e) => { setRef(e.target.value.trim()); if (!vaultRefProblem(e.target.value.trim())) onChange(vaultRef(e.target.value)); }} />
          {st === 'masked' || st === 'vault' ? <Button size="sm" variant="ghost" onClick={() => { setEditing(false); onChange(value); }}>Keep current</Button> : null}
        </div>
      ) : (
        <div className="row gap-8 items-center">
          {st === 'vault' && <span className="mono small">{(value as { vault: string }).vault}</span>}
          {!disabled && <Button size="sm" icon={I.edit} onClick={() => setEditing(true)}>Change Vault reference</Button>}
          {!disabled && !required && st !== 'empty' && <Button size="sm" variant="ghost" onClick={() => { onChange(undefined); setRef(''); setEditing(true); }}>Remove</Button>}
        </div>
      )}
    </Field>
  );
}
