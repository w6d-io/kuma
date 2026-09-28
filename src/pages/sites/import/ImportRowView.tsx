import { Fragment } from 'react';
import { Badge, Button, Checkbox, I, Input, Select, cx } from '../../../components/ui';
import { Method } from '../../../components/ui/Primitives';
import type { ImportRow, ImportRowStatus } from '../../../api/siteImport';
import { accessWord } from '../../../lib/sites/format';
import { displayPath } from '../../../lib/sites/paths';
import { CHOICE_LABEL, choicesFor, needsTick, pickedAccess, rowRisk, type Choice, type RowPick, type RowState } from '../../../lib/sites/openapiImport';
import { AccessBadge, RiskBadge } from '../parts';

const STATUS: Record<ImportRowStatus, string> = {
  added: 'New', changed: 'Changed', removed: 'Gone from the spec', unchanged: 'Unchanged', pinned: 'Kept your edit',
  manual: 'Written by hand', skipped: 'Not imported', unsupported: 'Can’t import',
};

/** What the tick confirms, in the consequence's words. */
function tickLabel(kind: string | undefined, high: boolean): string {
  const what = kind === 'public' ? 'anyone may call it' : kind === 'signed-in' ? 'any signed-in account may call it' : null;
  if (what) return `Confirm: ${what}${high ? ' (high risk)' : ''}`;
  return 'Confirm this high-risk route';
}

/** The words under the decision: what is still needed, in the tone of how much it blocks. */
function StateLine({ state }: { state: RowState }) {
  if (state.kind === 'ok' || state.kind === 'confirm') return null;
  const tone = state.kind === 'blocked' ? 'text-danger' : 'text-warning';
  return <div className={cx('small', tone)}>{state.message}</div>;
}

/**
 * One operation of the spec: what it is, the route it becomes, its access and risk, and the
 * person's decision — with the confirm tick on the row itself when the row needs one.
 */
export function ImportRowView({ row, pick, state, gateLabel, selected, onSelect, onPick, open, onToggle }: {
  row: ImportRow;
  pick: RowPick | undefined;
  state: RowState;
  gateLabel: (id: string) => string;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onPick: (pick: RowPick) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const choices = choicesFor(row);
  const risk = rowRisk(row);
  const access = pickedAccess(row, pick) ?? row.route?.access;
  const tick = needsTick(row, pick);
  const name = row.operationId ?? row.op;
  const choice = pick?.choice ?? 'proposed';
  const set = (patch: Partial<RowPick>) => onPick({ choice, ...pick, ...patch });

  return (
    <Fragment>
      <tr className={cx('import-row', risk === 'high' ? 'is-high' : state.kind !== 'ok' && 'is-attention', open && 'is-open')}>
        <td className="check">
          {choices.length > 0 && <Checkbox className="bare" checked={selected} onChange={onSelect} label={<span className="sr-only">Select {name}</span>} />}
        </td>
        <td className="import-op">
          <div className="row gap-4 wrap">
            {row.method.split(',').map((m) => <Method key={m} m={m} />)}
            <span className="mono small break-anywhere">{row.specPath ?? row.current?.path ?? row.op}</span>
          </div>
          <div className="row gap-8 wrap mt-2">
            {row.operationId && <span className="small muted mono break-anywhere">{row.operationId}</span>}
            <Badge tone="plain" mono={false}>{STATUS[row.status]}</Badge>
          </div>
          {/* The Route column folds into this one on a laptop screen. */}
          {row.route && <div className="import-route-inline small muted mono break-anywhere">→ {displayPath(row.route.path)} · {row.route.access.kind === 'deny' ? 'refused' : gateLabel(row.route.gate)}</div>}
        </td>
        <td className="import-route">
          {row.route
            ? <>
                <div className="mono small break-anywhere">{displayPath(row.route.path)}{row.route.orgParam && <span className="muted"> · :{row.route.orgParam}</span>}</div>
                <div className="small muted">{row.route.access.kind === 'deny' ? 'Refused at the gateway' : gateLabel(row.route.gate)}</div>
              </>
            : <span className="small muted">{row.reasons[row.reasons.length - 1] ?? '—'}</span>}
        </td>
        <td>
          {access ? <AccessBadge access={access} /> : <span className="small muted">—</span>}
          {row.current && row.status === 'changed' && <div className="small muted">was {accessWord(row.current.access)}</div>}
          {row.suggestion?.access && choice !== 'suggested' && (
            <div className="small muted">Spec asks: {accessWord(row.suggestion.access)}</div>
          )}
        </td>
        <td>
          {risk ? <RiskBadge level={risk} /> : <span className="small muted">—</span>}
          {/* A low-risk line only restates the route's permission: said in the details, not here. */}
          {risk && risk !== 'low' && <div className="small muted import-risk-line">{row.risk.find((f) => f.level === risk)?.message}</div>}
        </td>
        <td className="import-decision">
          {choices.length > 0 ? (
            <div className="stack gap-4">
              <Select size="sm" aria-label={`Access for ${name}`} value={choice} onChange={(e) => onPick({ choice: e.target.value as Choice, permission: pick?.permission ?? (row.route?.access.kind === 'permission' ? row.route.access.permission : ''), confirm: false })}>
                {choices.map((c) => <option key={c} value={c}>{c === 'proposed' && row.route ? `${CHOICE_LABEL.proposed} (${accessWord(row.route.access)})` : CHOICE_LABEL[c]}</option>)}
              </Select>
              {choice === 'permission' && (
                <Input size="sm" mono aria-label={`Permission for ${name}`} placeholder="resource:verb" invalid={state.kind === 'invalid'} value={pick?.permission ?? ''} onChange={(e) => set({ permission: e.target.value })} />
              )}
              {tick && (
                <Checkbox
                  size="sm"
                  checked={!!pick?.confirm}
                  onChange={(v) => set({ confirm: v })}
                  label={tickLabel(access?.kind, risk === 'high')}
                />
              )}
              <StateLine state={state} />
            </div>
          ) : <span className="small muted">{row.status === 'manual' ? 'Kept' : 'Nothing to decide'}</span>}
        </td>
        <td className="actions">
          <Button size="sm" variant="ghost" iconOnly icon={open ? I.caretUp : I.caret} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} why for ${name}`} onClick={onToggle} />
        </td>
      </tr>
      {open && (
        <tr className="import-detail">
          <td />
          <td colSpan={6} className="import-detail-cell">
            <div className="grid g2 gap-16">
              <div>
                <div className="small fw-medium">Why</div>
                <ul className="import-list small">
                  {row.reasons.length ? row.reasons.map((r, i) => <li key={i}>{r}</li>) : <li className="muted">Mapped from the spec as it is.</li>}
                  {row.suggestion && <li>The spec ({row.suggestion.from}) asks for {row.suggestion.access ? accessWord(row.suggestion.access).toLowerCase() : `gate ${row.suggestion.gate}`}; offered, not applied.</li>}
                  {/* A missing tick is the checkbox's to say; anything else jinbe refused is said here. */}
                  {row.blocking && row.blocking.code !== 'risk_unconfirmed' && row.blocking.code !== 'confirmation_required' && <li className="text-danger">{row.blocking.message}</li>}
                </ul>
              </div>
              <div>
                <div className="small fw-medium">Risk</div>
                <ul className="import-list small">
                  {row.risk.length ? row.risk.map((f) => <li key={f.code}><Badge tone={f.level === 'high' ? 'danger' : f.level === 'medium' ? 'warning' : 'success'} mono={false}>{f.level}</Badge> {f.message}</li>) : <li className="muted">Nothing flagged.</li>}
                </ul>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
