import { useState } from 'react';
import type { AuditFacets as Facets, FacetCount } from '../../api/audit';
import { Button, Checkbox, Input, Select, Skeleton } from '../../components/ui';
import { activeCount, clearFilters, toggleFacet, type AuditFilters, type FacetKey } from '../../lib/audit/filters';
import { eventPhrase, shortId } from '../../lib/audit/format';

function Group({ title, items, selected, onToggle, format, limit = 8 }: {
  title: string; items: FacetCount[] | undefined; selected: string[]; onToggle: (v: string) => void;
  format?: (k: string) => string; limit?: number;
}) {
  const [all, setAll] = useState(false);
  // A selected value stays listed even when the range has no events for it, so it can be unticked.
  const list = [...(items ?? [])];
  for (const s of selected) if (!list.some((i) => i.key === s)) list.push({ key: s, count: 0 });
  const shown = all ? list : list.slice(0, limit);
  return (
    <fieldset className="audit-facet">
      <legend className="audit-facet-title">{title}</legend>
      {items === undefined ? <Skeleton w="70%" /> : list.length === 0 ? <div className="text-xs muted">None in this range</div> : shown.map((i) => (
        <Checkbox key={i.key} checked={selected.includes(i.key)} onChange={() => onToggle(i.key)}
          label={<span className="audit-facet-row"><span className="audit-clip" title={i.key}>{format ? format(i.key) : i.key}</span><span className="mono text-xs muted">{i.count}</span></span>} />
      ))}
      {list.length > limit && <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? 'Fewer' : `All ${list.length}`}</Button>}
    </fieldset>
  );
}

/**
 * The facets, counted by jinbe over the whole selected range (not the loaded page). An org admin
 * gets no organisation facet: their scope is fixed.
 */
export function AuditFacets({ facets, filters, onChange, platform, orgName }: {
  facets: Facets | undefined; filters: AuditFilters; onChange: (f: AuditFilters) => void; platform: boolean;
  orgName: (id: string) => string;
}) {
  const [actor, setActor] = useState(filters.actor ?? '');
  const toggle = (key: FacetKey) => (v: string) => onChange(toggleFacet(filters, key, v));
  const single = (key: 'site' | 'org' | 'actor') => (v: string) => onChange({ ...filters, [key]: filters[key] === v ? undefined : v });
  const n = activeCount(filters);
  return (
    <div className="audit-facets">
      <Group title="Result" items={facets?.result} selected={filters.result} onToggle={toggle('result')} />
      <Group title="Category" items={facets?.category} selected={filters.category} onToggle={toggle('category')} />
      <Group title="Event" items={facets?.event} selected={filters.event} onToggle={toggle('event')} format={eventPhrase} />
      <fieldset className="audit-facet">
        <legend className="audit-facet-title">Actor</legend>
        <form className="row gap-4" onSubmit={(ev) => { ev.preventDefault(); onChange({ ...filters, actor: actor.trim() || undefined }); }}>
          <Input size="sm" mono placeholder="user id" value={actor} onChange={(ev) => setActor(ev.target.value)} aria-label="Actor id" />
          <Button size="sm" type="submit">Go</Button>
        </form>
        {(facets?.actor ?? []).slice(0, 5).map((i) => (
          <Checkbox key={i.key} checked={filters.actor === i.key} onChange={() => { single('actor')(i.key); setActor(filters.actor === i.key ? '' : i.key); }}
            label={<span className="audit-facet-row"><span className="mono">user · {shortId(i.key)}</span><span className="mono text-xs muted">{i.count}</span></span>} />
        ))}
      </fieldset>
      {platform && (facets?.org?.length ?? 0) > 0 && (
        <Group title="Organisation" items={facets?.org} selected={filters.org ? [filters.org] : []} onToggle={single('org')} format={orgName} />
      )}
      <Group title="Site" items={facets?.site} selected={filters.site ? [filters.site] : []} onToggle={single('site')} />
      <fieldset className="audit-facet">
        <legend className="audit-facet-title">Severity</legend>
        <Select size="sm" value={filters.severity ?? ''} aria-label="Severity" onChange={(ev) => onChange({ ...filters, severity: ev.target.value || undefined })}>
          <option value="">Any</option>
          <option value="high">High</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
        </Select>
      </fieldset>
      <Button size="sm" variant="ghost" disabled={n === 0} onClick={() => { setActor(''); onChange(clearFilters(filters)); }}>Clear all{n ? ` (${n})` : ''}</Button>
    </div>
  );
}
