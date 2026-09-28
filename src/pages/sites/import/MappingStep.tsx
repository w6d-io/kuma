import { useMemo, useState } from 'react';
import {
  ActionBar, Button, Callout, Card, Checkbox, EmptyRow, I, Input, Pagination, Segmented, Select, Table, Th, Toolbar, ToolbarSpacer, usePagination,
} from '../../../components/ui';
import type { ImportPreview, ImportRow } from '../../../api/siteImport';
import type { Gate } from '../../../lib/sites/types';
import { checkLines } from '../../../lib/sites/format';
import {
  FILTERS, choicesFor, commitBlockers, countsLine, matchesFilter, matchesSearch, pickChanged, rowRisk, rowState, type Choice, type Filter, type Picks,
} from '../../../lib/sites/openapiImport';
import { CheckList, RiskBadge } from '../parts';
import { ImportRowView } from './ImportRowView';

/** What a bulk action may set: only choices that raise protection or leave the proposal — never a tick. */
const BULK: Array<{ value: Choice; label: string }> = [
  { value: 'proposed', label: 'As proposed' },
  { value: 'deny', label: 'Refused' },
  { value: 'skip', label: 'Don’t import' },
];

/**
 * Step 2: every operation as the route it becomes, filtered and paged (a spec may have 2 000), each
 * with its own decision. High-risk rows are confirmed one tick at a time — bulk actions can refuse
 * or skip rows, never confirm them. The commit stays off until nothing is left to settle.
 */
export function MappingStep({ preview, picks, onPicks, checked, acceptDenied, onAcceptDenied, gates, busy, error, onRecheck, onBack, onCommit }: {
  preview: ImportPreview;
  picks: Picks;
  onPicks: (next: Picks) => void;
  /** The picks the last preview was sent: a conflict jinbe found is settled only by a new check. */
  checked: Picks;
  acceptDenied: boolean;
  onAcceptDenied: (v: boolean) => void;
  gates: Gate[];
  busy: 'preview' | 'commit' | null;
  error: string | null;
  onRecheck: () => void;
  onBack: () => void;
  onCommit: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [needle, setNeedle] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [bulk, setBulk] = useState<Choice>('deny');
  const gateLabel = (id: string) => gates.find((g) => g.id === id)?.label ?? id;

  const states = useMemo(
    () => new Map(preview.rows.map((r) => [r.op, rowState(r, picks[r.op], acceptDenied, pickChanged(picks[r.op], checked[r.op]))])),
    [preview.rows, picks, acceptDenied, checked],
  );
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, preview.rows.filter((r) => matchesFilter(r, f.value, states.get(r.op)!)).length])), [preview.rows, states]);
  const shown = useMemo(() => preview.rows.filter((r) => matchesFilter(r, filter, states.get(r.op)!) && matchesSearch(r, needle)), [preview.rows, filter, needle, states]);
  const page = usePagination(shown.length, 50);
  const rows = shown.slice(page.from, page.to);
  const blockers = commitBlockers(preview, picks, acceptDenied, checked);
  const stale = preview.rows.some((r) => pickChanged(picks[r.op], checked[r.op]));

  const selectable = (r: ImportRow) => choicesFor(r).length > 0;
  const pageSelectable = rows.filter(selectable);
  const allOnPage = pageSelectable.length > 0 && pageSelectable.every((r) => selected.has(r.op));
  const toggle = (ops: string[], on: boolean) => setSelected((s) => {
    const next = new Set(s);
    for (const op of ops) {
      if (on) next.add(op);
      else next.delete(op);
    }
    return next;
  });
  const applyBulk = () => {
    const next = { ...picks };
    for (const r of preview.rows) {
      if (!selected.has(r.op) || !choicesFor(r).includes(bulk)) continue;
      if (bulk === 'proposed') delete next[r.op];
      else next[r.op] = { choice: bulk };
    }
    onPicks(next);
    setSelected(new Set());
  };

  const high = preview.rows.filter((r) => rowRisk(r) === 'high').length;
  const waiting = [
    blockers.confirm ? `${blockers.confirm} to confirm` : '',
    blockers.decide ? `${blockers.decide} to decide` : '',
    blockers.invalid ? `${blockers.invalid} to correct` : '',
    blockers.recheck ? `${blockers.recheck} to check again` : '',
    blockers.blocked ? `${blockers.blocked} refused` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="stack gap-16">
      <Card
        title={`${preview.spec.title || 'Untitled spec'} ${preview.spec.version ? `v${preview.spec.version}` : ''}`}
        sub={`${preview.spec.counts.operations} operation${preview.spec.counts.operations === 1 ? '' : 's'} · ${countsLine(preview.reimport)} · merged into the ${preview.base.from === 'draft' ? 'draft' : 'saved site as a new draft'}`}
        actions={<RiskBadge level={preview.risk.level} />}
      >
        <div className="stack gap-8">
          {preview.sameSpec && <Callout tone="info" icon={I.info}>This is the document imported last time{preview.previous?.importedBy ? ` by ${preview.previous.importedBy}` : ''}. Routes you edited since are kept.</Callout>}
          {high > 0 && (
            <Callout tone="warning" icon={I.alert} title={`${high} high-risk route${high === 1 ? '' : 's'}`}>
              Each needs its own tick before the import — public writes, admin-looking public paths, protection lowered on the spec’s word, conflicts with another site. Or refuse them.
            </Callout>
          )}
          {blockers.global.map((b) => <Callout key={b.code} tone="danger" icon={I.alert}>{b.message}</Callout>)}
          {preview.notes.map((n) => <p key={n} className="small muted m-0">{n}</p>)}
          {preview.checks.length > 0 && <CheckList lines={checkLines(preview.checks)} />}
        </div>
      </Card>

      <Card pad="none" title="Routes" sub="Open a row’s details to see why it was mapped that way.">
        <Toolbar inset label="Filter operations">
          <Segmented label="Show" value={filter} onChange={(f) => { setFilter(f); page.setPage(0); }} options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))} />
          <Input size="sm" mono leading={I.search} aria-label="Search operations" placeholder="path or operation id" value={needle} onChange={(e) => { setNeedle(e.target.value); page.setPage(0); }} />
          <ToolbarSpacer />
          <Checkbox size="sm" checked={acceptDenied} onChange={onAcceptDenied} label="Leave unmapped operations refused" />
        </Toolbar>
        {selected.size > 0 && (
          <Toolbar inset label="Selected operations" className="import-bulk">
            <span className="toolbar-note">{selected.size} selected</span>
            <Select size="sm" aria-label="Set the selected operations to" value={bulk} onChange={(e) => setBulk(e.target.value as Choice)}>
              {BULK.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </Select>
            <Button size="sm" onClick={applyBulk}>Apply to selected</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
            <ToolbarSpacer />
            <span className="toolbar-note">High-risk rows are confirmed one by one.</span>
          </Toolbar>
        )}
        <Table className="import-table" aria-label="Operations and the routes they become">
          <thead><tr>
            <Th kind="check"><Checkbox className="bare" checked={allOnPage} indeterminate={!allOnPage && pageSelectable.some((r) => selected.has(r.op))} onChange={(v) => toggle(pageSelectable.map((r) => r.op), v)} label={<span className="sr-only">Select every row on this page</span>} /></Th>
            <Th>Operation</Th><Th className="import-route">Route</Th><Th>Access</Th><Th>Risk</Th><Th>Decision</Th><Th kind="actions"><span className="sr-only">Details</span></Th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={7}>{needle ? `No operation matches “${needle}”.` : 'Nothing here.'}</EmptyRow>}
            {rows.map((r) => (
              <ImportRowView
                key={r.op}
                row={r}
                pick={picks[r.op]}
                state={states.get(r.op)!}
                gateLabel={gateLabel}
                selected={selected.has(r.op)}
                onSelect={(on) => toggle([r.op], on)}
                onPick={(p) => onPicks({ ...picks, [r.op]: p })}
                open={open === r.op}
                onToggle={() => setOpen(open === r.op ? null : r.op)}
              />
            ))}
          </tbody>
        </Table>
        {shown.length > 25 && <Pagination page={page.page} pageSize={page.pageSize} total={shown.length} onPageChange={page.setPage} onPageSizeChange={page.setPageSize} sizes={[25, 50, 100]} />}
      </Card>

      {error && <Callout tone="danger" icon={I.alert}>{error}</Callout>}
      <ActionBar
        start={<span className="small muted" aria-live="polite">{blockers.total === 0 ? 'Ready. The import writes the draft only; you review and publish it next.' : `Before importing: ${waiting}${blockers.global.length ? ' · the import-wide problems above' : ''}.`}</span>}
      >
        <Button onClick={onBack}>Back</Button>
        {(stale || blockers.blocked > 0) && <Button loading={busy === 'preview'} disabled={busy !== null} onClick={onRecheck}>Check again</Button>}
        <Button variant="primary" loading={busy === 'commit'} disabled={blockers.total > 0 || busy !== null} onClick={onCommit}>Import into draft</Button>
      </ActionBar>
    </div>
  );
}
