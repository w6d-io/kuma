import { useState } from 'react';
import { Button, ButtonBase, Field, I, Input, RadioGroup, Select, Switch, Textarea, cx } from '../../../components/ui';
import { ERROR_NAMES, getPath, isDuration, setPath, type HandlerField } from '../../../lib/sites/handlerFields';
import { secretLooking } from '../../../lib/sites/validate';

/**
 * One handler config field, by type (docs/research/oathkeeper-spec.md §11). Locked fields show the
 * value they would have and why they cannot be set per gate. Anything that looks like a secret is
 * refused at the field.
 */

type Config = Record<string, unknown> | undefined;

const listText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : '');
const toList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function KvEditor({ value, onChange, disabled, onTemplate }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; disabled?: boolean; onTemplate?: () => void }) {
  const entries = Object.entries(value);
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  return (
    <div className="stack gap-4">
      {entries.map(([name, val]) => (
        <div key={name} className="row gap-8 items-center">
          <span className="mono small site-kv-name">{name}</span>
          <Input size="sm" mono aria-label={`${name} value`} value={val} disabled={disabled} invalid={secretLooking(val)} onChange={(e) => onChange({ ...value, [name]: e.target.value })} />
          {!disabled && <Button size="sm" variant="ghost" iconOnly icon={I.close} aria-label={`Remove ${name}`} onClick={() => { const n = { ...value }; delete n[name]; onChange(n); }} />}
        </div>
      ))}
      {!disabled && (
        <div className="row gap-8 items-center">
          <Input size="sm" mono placeholder="Name" aria-label="New name" value={k} onChange={(e) => setK(e.target.value)} />
          <Input size="sm" mono placeholder="Value" aria-label="New value" value={v} onChange={(e) => setV(e.target.value)} />
          <Button size="sm" icon={I.plus} disabled={!k.trim()} onClick={() => { onChange({ ...value, [k.trim()]: v }); setK(''); setV(''); }}>Add</Button>
          {onTemplate && <Button size="sm" variant="ghost" icon={I.sparkle} onClick={onTemplate}>Template builder</Button>}
        </div>
      )}
    </div>
  );
}

type TokenFrom = { header?: string; query_parameter?: string; cookie?: string };

function TokenFromEditor({ value, onChange, disabled, name }: { value: TokenFrom | undefined; onChange: (v: TokenFrom | undefined) => void; disabled?: boolean; name: string }) {
  const where = value?.query_parameter !== undefined ? 'query_parameter' : value?.cookie !== undefined ? 'cookie' : 'header';
  const current = value?.[where] ?? '';
  return (
    <div className="stack gap-4">
      <RadioGroup<keyof TokenFrom> label="Token is sent in" name={name} value={where} disabled={disabled} onChange={(w) => onChange({ [w]: current || (w === 'header' ? 'X-Session-Token' : 'token') })} options={[
        { value: 'header', label: 'Header' }, { value: 'query_parameter', label: 'Query parameter' }, { value: 'cookie', label: 'Cookie' },
      ]} />
      <Input size="sm" mono aria-label="Token name" value={current} disabled={disabled} placeholder="Authorization" onChange={(e) => onChange(e.target.value ? { [where]: e.target.value } : undefined)} />
    </div>
  );
}

type When = Array<{ error?: string[]; request?: { header?: { accept?: string[]; content_type?: string[] } } }>;

function WhenEditor({ value, onChange, disabled }: { value: When | undefined; onChange: (v: When | undefined) => void; disabled?: boolean }) {
  const clause = value?.[0] ?? {};
  const errors = clause.error ?? [];
  const accept = clause.request?.header?.accept ?? [];
  const set = (e: string[], a: string[]) => onChange(e.length || a.length ? [{ ...(e.length ? { error: e } : {}), ...(a.length ? { request: { header: { accept: a } } } : {}) }] : undefined);
  return (
    <div className="stack gap-4">
      <div className="pills" role="group" aria-label="For these errors">
        {ERROR_NAMES.map((n) => (
          <ButtonBase key={n} className={cx('pill', errors.includes(n) && 'on')} aria-pressed={errors.includes(n)} disabled={disabled}
            onClick={() => set(errors.includes(n) ? errors.filter((x) => x !== n) : [...errors, n], accept)}>{n.replace(/_/g, ' ')}</ButtonBase>
        ))}
      </div>
      <Input size="sm" mono aria-label="Only when the request accepts" placeholder="text/html (empty = any client)" value={accept.join(', ')} disabled={disabled} onChange={(e) => set(errors, toList(e.target.value))} />
      {(value?.length ?? 0) > 1 && <p className="small muted m-0">{value!.length - 1} more clause(s) — edit them in Expert.</p>}
    </div>
  );
}

export function HandlerFieldEditor({ field, config, onChange, disabled, idBase, onTemplate }: {
  field: HandlerField;
  config: Config;
  onChange: (c: Config) => void;
  disabled?: boolean;
  idBase: string;
  onTemplate?: () => void;
}) {
  const value = getPath(config, field.key);
  const set = (v: unknown) => onChange(setPath(config, field.key, v));
  if (field.locked) {
    return (
      <Field label={<>{field.label} <span className="muted" aria-label="locked">{I.lock}</span></>} hint={field.locked}>
        <Input size="sm" mono disabled value={value === undefined ? 'platform value' : JSON.stringify(value)} />
      </Field>
    );
  }
  const text = typeof value === 'string' ? value : value === undefined ? '' : String(value);
  const error =
    (field.type === 'duration' && text && !isDuration(text) && 'A duration like 1s, 100ms or 5m.')
    || ((field.type === 'string' || field.type === 'url') && text && secretLooking(text) && 'That looks like a secret; rules are readable inside the cluster.')
    || (field.type === 'url' && text && !/^(https?:\/\/|\/)/.test(text) && 'An http(s):// address or a path.')
    || undefined;

  switch (field.type) {
    case 'bool':
      return <Field label={field.label} hint={field.help} inline><Switch on={value === true} disabled={disabled} label={field.label} onChange={(on) => set(on ? true : undefined)} /></Field>;
    case 'enum':
      return (
        <Field label={field.label} hint={field.help}>
          <Select size="sm" value={text} disabled={disabled} onChange={(e) => set(e.target.value ? (field.key === 'code' ? Number(e.target.value) : e.target.value) : undefined)}>
            <option value="">default</option>
            {field.options!.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </Field>
      );
    case 'list':
      return <Field label={field.label} hint={field.help ?? 'Comma-separated.'}><Input size="sm" mono placeholder={field.placeholder} value={listText(value)} disabled={disabled} onChange={(e) => set(toList(e.target.value))} /></Field>;
    case 'kv':
      return <Field label={field.label} hint={field.help}><KvEditor value={(value as Record<string, string>) ?? {}} disabled={disabled} onChange={set} onTemplate={onTemplate} /></Field>;
    case 'template':
      return <Field label={field.label} hint={field.help}><Textarea mono rows={4} value={text} disabled={disabled} onChange={(e) => set(e.target.value || undefined)} /></Field>;
    case 'token_from':
      return <Field label={field.label} hint={field.help}><TokenFromEditor name={`${idBase}-${field.key}`} value={value as TokenFrom | undefined} disabled={disabled} onChange={set} /></Field>;
    case 'when':
      return <Field label={field.label} hint="Handlers’ conditions must not overlap — the server checks browsers, JSON clients and curl."><WhenEditor value={value as When | undefined} disabled={disabled} onChange={set} /></Field>;
    default:
      return <Field label={field.label} hint={field.help} error={error}><Input size="sm" mono placeholder={field.placeholder} value={text} disabled={disabled} onChange={(e) => set(e.target.value || undefined)} /></Field>;
  }
}
