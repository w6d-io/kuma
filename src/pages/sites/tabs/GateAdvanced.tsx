import { useState } from 'react';
import { Badge, Button, Callout, I, Select } from '../../../components/ui';
import { AdvancedDisclosure } from '../../../components/ui/Primitives';
import { HANDLER_FIELDS, HANDLER_LABEL, type HandlerKind } from '../../../lib/sites/handlerFields';
import { ALL_HANDLERS, type HandlerCatalog } from '../../../lib/sites/presets';
import { explicitErrors, gateChecks, moveHandler } from '../../../lib/sites/gateChecks';
import type { Gate, Handler, Site } from '../../../lib/sites/types';
import { CheckList } from '../parts';
import { checkLines } from '../../../lib/sites/format';
import { HandlerFieldEditor } from './HandlerFieldEditor';
import { HeaderBuilder } from './HeaderBuilder';

/**
 * A gate's Advanced panel (site-ux.md §7.2): each stage as an ordered list of handlers, every
 * catalog field reachable (Expert-level fields behind a disclosure, locked ones explained). Handlers
 * the gateway does not run are listed with a lock and lead to the platform change they need.
 */

type Stage = { kind: HandlerKind; title: string; note?: string };
const STAGES: Stage[] = [
  { kind: 'authenticators', title: '1 Who is calling?', note: 'Order matters: the first method that recognises the caller wins.' },
  { kind: 'authorizers', title: '2 Who may pass?' },
  { kind: 'mutators', title: '3 What the service gets' },
  { kind: 'errors', title: '4 When access fails' },
];

function HandlerCard({ h, kind, index, count, readOnly, onChange, onMove, onRemove, onTemplate, idBase }: {
  h: Handler; kind: HandlerKind; index: number; count: number; readOnly: boolean;
  onChange: (h: Handler) => void; onMove: (to: number) => void; onRemove?: () => void; onTemplate?: () => void; idBase: string;
}) {
  const fields = HANDLER_FIELDS[kind][h.handler] ?? [];
  const adv = fields.filter((f) => f.level === 'A');
  const exp = fields.filter((f) => f.level === 'E');
  const customized = !!h.config && Object.keys(h.config).length > 0;
  return (
    <li
      className="site-handler"
      tabIndex={count > 1 && !readOnly ? 0 : undefined}
      aria-label={`${HANDLER_LABEL[h.handler] ?? h.handler}, position ${index + 1} of ${count}`}
      onKeyDown={(e) => {
        if (!e.altKey || readOnly || e.target !== e.currentTarget) return;
        if (e.key === 'ArrowUp') { e.preventDefault(); onMove(index - 1); }
        if (e.key === 'ArrowDown') { e.preventDefault(); onMove(index + 1); }
      }}
    >
      <div className="site-handler-head">
        {count > 1 && <span className="muted small tabular">{index + 1}</span>}
        <span className="fw-medium">{HANDLER_LABEL[h.handler] ?? h.handler}</span>
        <span className="mono small muted">{h.handler}</span>
        {customized && <Badge tone="info" mono={false}>Customized</Badge>}
        {!readOnly && count > 1 && <>
          <Button size="sm" variant="ghost" iconOnly icon={I.caretUp} aria-label="Move up" disabled={index === 0} onClick={() => onMove(index - 1)} />
          <Button size="sm" variant="ghost" iconOnly icon={I.caret} aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(index + 1)} />
        </>}
        {!readOnly && onRemove && <Button size="sm" variant="ghost" iconOnly icon={I.close} aria-label={`Remove ${h.handler}`} onClick={onRemove} />}
      </div>
      {fields.length === 0 && <p className="small muted m-0">No settings.</p>}
      <div className="site-handler-fields">
        {adv.map((f) => <HandlerFieldEditor key={f.key} idBase={idBase} field={f} config={h.config} disabled={readOnly} onTemplate={f.key === 'headers' && h.handler === 'header' ? onTemplate : undefined} onChange={(config) => onChange({ handler: h.handler, ...(config ? { config } : {}) })} />)}
      </div>
      {exp.length > 0 && (
        <AdvancedDisclosure label="Expert fields" note={`${exp.length} · usually left as the platform sets them`}>
          <div className="site-handler-fields">
            {exp.map((f) => <HandlerFieldEditor key={f.key} idBase={idBase} field={f} config={h.config} disabled={readOnly} onChange={(config) => onChange({ handler: h.handler, ...(config ? { config } : {}) })} />)}
          </div>
        </AdvancedDisclosure>
      )}
    </li>
  );
}

export function GateAdvanced({ gate, site, enabled, readOnly, onChange, onLocked }: {
  gate: Gate; site: Site; enabled: HandlerCatalog; readOnly: boolean; onChange: (g: Gate) => void; onLocked: (h: string) => void;
}) {
  const [builder, setBuilder] = useState(false);
  const listOf = (kind: HandlerKind): Handler[] => {
    if (kind === 'authenticators') return gate.authenticators;
    if (kind === 'mutators') return gate.mutators;
    if (kind === 'errors') return explicitErrors(gate.errors);
    return gate.authorizer === 'policy' ? [] : [gate.authorizer];
  };
  const setList = (kind: HandlerKind, list: Handler[]) => {
    if (kind === 'authenticators') onChange({ ...gate, authenticators: list });
    else if (kind === 'mutators') onChange({ ...gate, mutators: list });
    else if (kind === 'errors') onChange({ ...gate, errors: list.length ? list : 'platform' });
    else onChange({ ...gate, authorizer: list[0] ?? 'policy' });
  };
  const header = gate.mutators.find((m) => m.handler === 'header');

  return (
    <div className="stack gap-16">
      {STAGES.map(({ kind, title, note }) => {
        const list = listOf(kind);
        const single = kind === 'authorizers';
        const on = enabled[kind];
        const addable = ALL_HANDLERS[kind].filter((h) => !list.some((x) => x.handler === h) && h !== 'keto_engine_acp_ory');
        return (
          <section key={kind} className="site-stage">
            <h4>{title}</h4>
            {note && <p className="small muted m-0">{note}</p>}
            {kind === 'authorizers' && gate.authorizer === 'policy' && (
              <Callout tone="neutral" icon={I.shield} title="Check permissions (remote_json) — generated">
                The decision request is generated with <span className="mono">"app": "{site.name}"</span> and asks the platform policy engine (address locked). Per-gate decision headers and retries are not accepted by the server yet.
              </Callout>
            )}
            {kind === 'errors' && typeof gate.errors === 'string' && (
              <p className="small m-0">Preset: <b>{gate.errors}</b>{gate.errors === 'platform' ? ' — the gateway’s global fallback applies.' : ' — the handlers below are what it renders; editing one makes it custom.'}</p>
            )}
            <ol className="site-handlers">
              {list.map((h, i) => (
                <HandlerCard
                  key={`${h.handler}-${i}`}
                  idBase={`${gate.id}-${kind}-${i}`}
                  h={h}
                  kind={kind}
                  index={i}
                  count={list.length}
                  readOnly={readOnly}
                  onChange={(next) => setList(kind, list.map((x, j) => (j === i ? next : x)))}
                  onMove={(to) => setList(kind, moveHandler(list, i, to))}
                  onRemove={list.length > 1 || kind === 'errors' || kind === 'authorizers' ? () => setList(kind, list.filter((_, j) => j !== i)) : undefined}
                  onTemplate={() => setBuilder(true)}
                />
              ))}
            </ol>
            {!readOnly && (
              <Select
                size="sm"
                aria-label={`Add to ${title}`}
                value=""
                onChange={(e) => {
                  const h = e.target.value;
                  if (!h) return;
                  if (!on.includes(h)) { onLocked(h); return; }
                  setList(kind, single ? [{ handler: h }] : [...list, { handler: h }]);
                }}
              >
                <option value="">{single ? (gate.authorizer === 'policy' ? 'Replace the permission check with…' : 'Replace with…') : '+ Add…'}</option>
                {addable.map((h) => <option key={h} value={h}>{HANDLER_LABEL[h] ?? h} ({h}){on.includes(h) ? '' : ' — locked, not enabled'}</option>)}
                {single && gate.authorizer !== 'policy' && <option value="" disabled>—</option>}
              </Select>
            )}
            {kind === 'authorizers' && gate.authorizer !== 'policy' && !readOnly && (
              <Button size="sm" variant="ghost" onClick={() => onChange({ ...gate, authorizer: 'policy' })}>Back to “Check permissions per route”</Button>
            )}
          </section>
        );
      })}
      <CheckList lines={checkLines(gateChecks(gate))} />
      <HeaderBuilder
        open={builder}
        onClose={() => setBuilder(false)}
        site={site}
        gate={gate}
        existing={Object.keys((header?.config?.headers as Record<string, string>) ?? {})}
        onAdd={(name, value) => {
          const muts = header ? gate.mutators : [...gate.mutators.filter((m) => m.handler !== 'noop'), { handler: 'header' }];
          onChange({ ...gate, mutators: muts.map((m) => (m.handler === 'header' ? { handler: 'header', config: { ...m.config, headers: { ...((m.config?.headers as Record<string, string>) ?? {}), [name]: value } } } : m)) });
          setBuilder(false);
        }}
      />
    </div>
  );
}
