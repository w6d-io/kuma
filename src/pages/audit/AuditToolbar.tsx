import { useState } from 'react';
import { Button, Checkbox, Dialog, Field, I, Input, Select } from '../../components/ui';
import { PRESET_LABEL, filtersFromParams, filtersToParams, rangeProblem, type AuditFilters, type RangePreset } from '../../lib/audit/filters';
import { matchView, type SavedView } from '../../lib/audit/savedViews';
import type { LiveMode } from './queries';

const toLocalInput = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Range, organisation (platform readers only), live, refresh and export. */
export function AuditToolbar({ filters, onChange, platform, orgs, live, onLive, onRefresh, onExport }: {
  filters: AuditFilters; onChange: (f: AuditFilters) => void; platform: boolean;
  orgs: { id: string; name: string }[]; live: LiveMode; onLive: (on: boolean) => void; onRefresh: () => void; onExport: () => void;
}) {
  const [from, setFrom] = useState(toLocalInput(filters.from));
  const [to, setTo] = useState(toLocalInput(filters.to));
  const custom = filters.range === 'custom';
  const problem = custom && from && to ? rangeProblem(new Date(from).toISOString(), new Date(to).toISOString()) : null;
  const liveOn = live === 'sse' || live === 'poll';

  const pickRange = (r: RangePreset) => {
    if (r !== 'custom') { onChange({ ...filters, range: r, from: undefined, to: undefined }); return; }
    const now = Date.now();
    const a = new Date(now - 86_400_000).toISOString();
    const b = new Date(now).toISOString();
    setFrom(toLocalInput(a)); setTo(toLocalInput(b));
    onChange({ ...filters, range: 'custom', from: a, to: b });
  };
  const applyCustom = () => {
    if (!from || !to || problem) return;
    onChange({ ...filters, range: 'custom', from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  };

  return (
    <div className="audit-toolbar">
      <Select size="sm" aria-label="Time range" value={filters.range} onChange={(e) => pickRange(e.target.value as RangePreset)}>
        {(Object.keys(PRESET_LABEL) as RangePreset[]).map((r) => <option key={r} value={r}>{PRESET_LABEL[r]}</option>)}
      </Select>
      {custom && (
        <form className="audit-custom" onSubmit={(e) => { e.preventDefault(); applyCustom(); }}>
          <Input size="sm" type="datetime-local" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} invalid={!!problem} />
          <span className="muted small">to</span>
          <Input size="sm" type="datetime-local" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} invalid={!!problem} />
          <Button size="sm" type="submit" disabled={!!problem}>Apply</Button>
          {problem && <span className="small text-danger audit-full">{problem}</span>}
        </form>
      )}
      {platform && orgs.length > 0 && (
        <Select size="sm" aria-label="Organisation" value={filters.org ?? ''} onChange={(e) => onChange({ ...filters, org: e.target.value || undefined })}>
          <option value="">All organisations</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      )}
      <span className="audit-toolbar-end">
        <Button size="sm" variant={liveOn ? 'primary' : 'secondary'} icon={liveOn ? I.clock : I.sync} aria-pressed={liveOn} onClick={() => onLive(!liveOn)}
          title={live === 'poll' ? 'Live (polling every 10 s)' : 'Stream new events as they happen (stops after 15 min)'}>
          {liveOn ? 'Live' : 'Go live'}
        </Button>
        <Button size="sm" icon={I.sync} iconOnly aria-label="Refresh" title="Refresh" onClick={onRefresh} />
        <Button size="sm" icon={I.download} onClick={onExport}>Export</Button>
      </span>
    </div>
  );
}

/** The saved-view picker and "Save view". Views are the filter params, so they survive a reload. */
export function SavedViewsBar({ views, filters, onApply, onSave, onDelete, local, canShare }: {
  views: SavedView[]; filters: AuditFilters; onApply: (f: AuditFilters) => void;
  onSave: (name: string, shared: boolean) => Promise<unknown>; onDelete: (v: SavedView) => void; local: boolean; canShare: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const params = filtersToParams(filters);
  const current = matchView(views, params);

  const apply = (id: string) => {
    const v = views.find((x) => x.id === id);
    if (!v) return;
    const next = filtersFromParams(v.params);
    // A view without a range keeps the one on screen.
    if (!v.params.range) Object.assign(next, { range: filters.range, from: filters.from, to: filters.to });
    onApply(next);
  };
  const save = async () => {
    setBusy(true);
    try { await onSave(name, shared); setOpen(false); setName(''); } finally { setBusy(false); }
  };

  return (
    <>
      <Select size="sm" aria-label="Saved views" value={current?.id ?? ''} onChange={(e) => apply(e.target.value)}>
        <option value="" disabled>{current ? current.name : 'Saved views…'}</option>
        <optgroup label="Suggested">{views.filter((v) => v.origin === 'default').map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</optgroup>
        {views.some((v) => v.origin !== 'default') && (
          <optgroup label="Yours">{views.filter((v) => v.origin !== 'default').map((v) => <option key={v.id} value={v.id}>{v.name}{v.shared ? ' (shared)' : ''}</option>)}</optgroup>
        )}
      </Select>
      <Button size="sm" variant="ghost" icon={I.plus} onClick={() => setOpen(true)}>Save view</Button>
      {current && current.origin !== 'default' && current.mine !== false && (
        <Button size="sm" variant="ghost" icon={I.trash} iconOnly aria-label={`Delete view ${current.name}`} title="Delete this view" onClick={() => onDelete(current)} />
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Save this view"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>Save</Button></>}>
        <div className="col gap-12">
          <Field label="Name" htmlFor="audit-view-name">
            <Input id="audit-view-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Grants this week" />
          </Field>
          {canShare && !local && <Checkbox checked={shared} onChange={setShared} label="Share with my organisation" />}
          {local && <div className="small muted">Kept in this browser until the server can store views.</div>}
        </div>
      </Dialog>
    </>
  );
}
