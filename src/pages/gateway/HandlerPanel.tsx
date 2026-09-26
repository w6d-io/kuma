import { useState } from 'react';
import { Badge, Button, Callout, EmptyHint, Field, I, Segmented, Textarea } from '../../components/ui';
import { getPath, setPath, type HandlerField } from '../../lib/sites/handlerFields';
import { configProblems, disableBlockers, restartWords, secretKeys, type HandlerRow } from '../../lib/gateway/logic';
import type { GlobalField } from '../../lib/gateway/catalog';
import type { HandlerChange } from '../../lib/gateway/types';
import { HandlerFieldEditor } from '../sites/tabs/HandlerFieldEditor';
import { SecretField } from './SecretField';

/**
 * One handler (GW-3): what it does, whether the gateway runs it, which sites use it, and its global
 * config at three levels — Basic (what it needs to work), Advanced (every tuning field), Expert
 * (every field and the raw JSON). Every action goes through the preview.
 */

type Level = 'basic' | 'advanced' | 'expert';
const LEVELS: Record<Level, Array<GlobalField['level']>> = { basic: ['B'], advanced: ['B', 'A'], expert: ['B', 'A', 'E'] };

export function HandlerPanel({ row, level, onLevel, canEdit, onReview }: {
  row: HandlerRow; level: Level; onLevel: (l: Level) => void; canEdit: boolean; onReview: (changes: HandlerChange[]) => void;
}) {
  const [config, setConfig] = useState<Record<string, unknown>>(row.config);
  const [raw, setRaw] = useState(JSON.stringify(row.config, null, 2));
  const [rawError, setRawError] = useState<string | null>(null);
  const dirty = JSON.stringify(config) !== JSON.stringify(row.config);
  const secrets = new Set(secretKeys(row));
  const fields = row.info.fields.filter((f) => LEVELS[level].includes(f.level));
  const hidden = row.info.fields.length - fields.length;
  const problems = configProblems(row, config, true);
  const problemOf = (k: string) => problems.find((p) => p.key === k)?.message;
  const blockers = disableBlockers(row);
  const readOnly = !canEdit;
  // Required fields with a known platform default (the catalog placeholder), still empty.
  const suggested = row.info.fields.filter((f) => f.required && f.placeholder && f.type !== 'secret' && problems.some((p) => p.key === f.key));

  const change = (enabled?: boolean): HandlerChange => ({
    kind: row.kind, name: row.name,
    ...(enabled !== undefined ? { enabled } : {}),
    ...(dirty || enabled ? { config } : {}),
  });

  return (
    <div className="stack gap-16">
      <p className="m-0">{row.info.summary}</p>
      <div className="row gap-8 wrap items-center">
        <Badge tone={row.enabled ? 'success' : 'neutral'} icon={row.enabled ? I.check : I.lock} mono={false}>{row.enabled ? 'Enabled' : 'Not enabled'}</Badge>
        <Badge tone="plain">{row.kind}/{row.name}</Badge>
        <span className="small muted">{restartWords(row.restart)}</span>
      </div>
      {row.info.caution && <Callout tone="warning" icon={I.alert}>{row.info.caution}</Callout>}

      <section className="stack gap-4">
        <h4 className="m-0 text-md">Used by</h4>
        {row.usedBy.length === 0 ? <EmptyHint>No site uses it.</EmptyHint> : (
          <ul className="site-list small">
            {row.usedBy.map((u) => (
              <li key={u.site}><a href={`#/sites/${encodeURIComponent(u.site)}/gates${u.gates[0] ? `?gate=${encodeURIComponent(u.gates[0])}` : ''}`}>{u.site}</a>{u.gates.length ? <span className="muted"> · gates {u.gates.join(', ')}</span> : null}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack gap-8">
        <div className="row gap-8 items-center justify-between wrap">
          <h4 className="m-0 text-md">Global config</h4>
          <Segmented label="Detail level" value={level} onChange={onLevel} options={[{ value: 'basic', label: 'Basic' }, { value: 'advanced', label: 'Advanced' }, { value: 'expert', label: 'Expert' }]} />
        </div>
        <p className="small muted m-0">Every site’s gate starts from these values; a gate may override the per-rule ones. Secrets are Vault references only.</p>
        {row.info.fields.length === 0 && <EmptyHint>This handler has no settings.</EmptyHint>}
        <div className="gw-fields">
          {fields.map((f) => secrets.has(f.key) || f.type === 'secret'
            ? <SecretField key={f.key} label={f.label} required={f.required} value={getPath(config, f.key)} disabled={readOnly} onChange={(v) => setConfig((c) => setPath(c, f.key, v) ?? {})} />
            : (
              <div key={f.key}>
                <HandlerFieldEditor
                  idBase={`gw-${row.kind}-${row.name}`}
                  field={{ ...f, label: f.required ? `${f.label} *` : f.label, level: f.level === 'E' ? 'E' : 'A', type: f.type === 'object' ? 'kv' : f.type } as HandlerField}
                  config={config}
                  disabled={readOnly}
                  onChange={(c) => setConfig(c ?? {})}
                />
                {problemOf(f.key) && (row.enabled || dirty) && <p className="field-error m-0">{problemOf(f.key)}</p>}
              </div>
            ))}
        </div>
        {hidden > 0 && <p className="small muted m-0">{hidden} more field{hidden === 1 ? '' : 's'} in {level === 'basic' ? 'Advanced and Expert' : 'Expert'}.</p>}
        {level === 'expert' && (
          <Field label="Config as JSON" hint="Secret fields must stay {masked: true} or {vault: ref}." error={rawError ?? undefined}>
            <Textarea mono rows={10} value={raw} disabled={readOnly} onChange={(e) => setRaw(e.target.value)}
              onBlur={() => { try { const v = JSON.parse(raw); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('an object'); setConfig(v); setRawError(null); } catch (err) { setRawError(`Not valid JSON: ${(err as Error).message}`); } }} />
          </Field>
        )}
      </section>

      {canEdit && (
        <div className="row gap-8 wrap justify-end">
          {row.enabled && (
            <Button
              variant="danger"
              disabled={blockers.length > 0}
              title={blockers.length ? `Used by ${blockers.join(', ')}` : undefined}
              onClick={() => onReview([change(false)])}
            >
              Disable
            </Button>
          )}
          {row.enabled && <Button variant="primary" disabled={!dirty || problems.some((p) => p.blocking)} onClick={() => onReview([change()])}>Review changes</Button>}
          {!row.enabled && <Button variant="primary" disabled={problems.some((p) => p.blocking)} onClick={() => onReview([change(true)])}>{row.known ? 'Enable' : 'Add and enable'}</Button>}
        </div>
      )}
      {canEdit && row.enabled && blockers.length > 0 && (
        <Callout tone="neutral" icon={I.lock} title="Can’t be disabled while sites use it">
          {blockers.map((s, i) => <span key={s}>{i > 0 && ', '}<a href={`#/sites/${encodeURIComponent(s)}/gates`}>{s}</a></span>)} — move their gates to another method first.
        </Callout>
      )}
      {canEdit && !row.enabled && problems.some((p) => p.blocking) && (
        <div className="row gap-8 items-center justify-end">
          <span className="small muted">Fill the required fields (*) to enable it.</span>
          {suggested.length > 0 && <Button size="sm" onClick={() => setConfig((c) => suggested.reduce((acc, f) => setPath(acc, f.key, f.type === 'list' ? [f.placeholder] : f.placeholder) ?? acc, c))}>Use the platform’s usual values</Button>}
        </div>
      )}
    </div>
  );
}
