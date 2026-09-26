import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useMyOrganizationNames } from '../api/hooks';
import { MAX_ENTRIES, type AuditQuery, type AuditScope } from '../api/audit';
import { Button, Callout, Card, EmptyState, I, Input, PageHeader } from '../components/ui';
import { useApp } from '../contexts/AppContext';
import {
  EMPTY_FILTERS, PRESET_LABEL, activeCount, clearFilters, filtersFromParams, filtersToParams, toQuery, zoomTo, type AuditFilters,
} from '../lib/audit/filters';
import { parseEventHash } from '../lib/audit/format';
import { summaryWindow } from '../lib/audit/histogram';
import { mergeLive } from '../lib/audit/live';
import { formatHash, parseHash } from '../lib/route';
import { AuditExportDialog } from './audit/AuditExportDialog';
import { AuditFacets } from './audit/AuditFacets';
import { AuditHistogram } from './audit/AuditHistogram';
import { AuditError, AuditEvents, AuditLoading } from './audit/AuditTimeline';
import { AuditToolbar, SavedViewsBar } from './audit/AuditToolbar';
import { AuditEventPage } from './audit/AuditEventPage';
import { useAuditEventPages, useAuditFacets, useAuditHistogram, useLiveTail, useSavedViews } from './audit/queries';

/** The live tail follows the same facets; its range is "from now on". */
function withoutRange(q: AuditQuery): Omit<AuditQuery, 'from' | 'to'> {
  const rest: Partial<AuditQuery> = { ...q };
  delete rest.from;
  delete rest.to;
  return rest;
}
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });

/**
 * Audit (AUD-11): who did what, when — server-paged from the Loki-backed audit API.
 *
 * Facets and the histogram cover the whole selected range; rows come a page at a time. The address
 * holds the filters (`#/audit?range=7d&result=denied`), so any view can be pasted or saved, and
 * `#/audit/event/<id>` opens one event on its own.
 */
export function AuditPage() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const eventRef = parseEventHash(hash);
  if (eventRef) return <AuditEventPage id={eventRef.id} ts={eventRef.ts} />;
  return <AuditTimelinePage />;
}

function AuditTimelinePage() {
  const { setPage, auditFocus, setAuditFocus } = useApp();
  const qc = useQueryClient();
  const [filters, setFiltersRaw] = useState<AuditFilters>(() => filtersFromParams(parseHash(window.location.hash).query));
  // The range is resolved when the filters change, not on every render, so the cache key holds still.
  const [now, setNow] = useState(() => Date.now());
  const [scope, setScope] = useState<AuditScope | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [q, setQ] = useState(filters.q ?? '');

  const setFilters = useCallback((f: AuditFilters) => {
    setFiltersRaw(f);
    setNow(Date.now());
    setOpenId(null);
    history.replaceState(null, '', `#${formatHash('audit', null, filtersToParams(f))}`);
  }, []);

  // The Overview's "Signals" card lands here asking for the high-risk slice.
  useEffect(() => {
    if (!auditFocus) return;
    if (auditFocus.tab === 'signals') setFilters({ ...EMPTY_FILTERS, severity: 'high' });
    setAuditFocus(null);
  }, [auditFocus, setAuditFocus, setFilters]);

  const query = useMemo(() => toQuery(filters, scope, now), [filters, scope, now]);
  const eventsQ = useAuditEventPages(query);
  const facetsQ = useAuditFacets(query, eventsQ.isSuccess);
  const summaryQ = useAuditHistogram(summaryWindow(filters.range), query.org, eventsQ.isSuccess);
  const saved = useSavedViews();

  const firstPage = eventsQ.data?.pages[0];
  useEffect(() => { if (firstPage?.scope) setScope(firstPage.scope); }, [firstPage?.scope]);
  const platform = scope?.platform ?? false;

  const orgNamesQ = useMyOrganizationNames().data;
  const orgNames = useMemo(() => orgNamesQ ?? {}, [orgNamesQ]);
  const allOrgs = useQuery({ queryKey: ['all-orgs'], queryFn: () => api.allOrganizations(), enabled: platform, staleTime: 5 * 60_000 });
  const orgList = useMemo(() => (allOrgs.data?.organizations ?? []).map((o) => ({ id: o.id, name: o.name })), [allOrgs.data]);
  const orgName = useCallback((id: string) => orgList.find((o) => o.id === id)?.name ?? orgNames[id] ?? id, [orgList, orgNames]);

  const tail = useLiveTail(withoutRange(query), live);
  useEffect(() => { if (tail.mode === 'stopped') setLive(false); }, [tail.mode]);

  const loaded = useMemo(() => eventsQ.data?.pages.flatMap((p) => p.events) ?? [], [eventsQ.data]);
  const events = useMemo(() => (tail.events.length ? mergeLive(loaded, tail.events, loaded.length + tail.events.length) : loaded), [loaded, tail.events]);
  const truncated = eventsQ.data?.pages.some((p) => p.truncated) ?? false;
  const range = firstPage?.range ?? { from: query.from, to: query.to };

  const scopeText = !scope ? '' : platform
    ? (filters.org ? orgName(filters.org) : 'all organisations')
    : scope.orgs.map(orgName).join(', ') || 'your organisation';

  // A shared view belongs to one organisation: the one on screen, or an org admin's own.
  const shareOrg = platform ? filters.org : scope?.orgs.length === 1 ? scope.orgs[0] : undefined;
  const refresh = () => { setNow(Date.now()); void qc.invalidateQueries({ queryKey: ['audit', 'log'] }); };
  const openUser = (id: string) => setFilters({ ...clearFilters(filters), actor: id });
  const applySearch = () => setFilters({ ...filters, q: q.trim() || undefined });

  return (
    <>
      <PageHeader
        title="Audit"
        sub={<>
          Who did what, when{scope && <> · scope: <span className="fw-medium">{scopeText}</span></>}
          {scope && !platform && <span className="muted"> (you&rsquo;re an org admin — you see {scope.orgs.length > 1 ? 'these organisations' : 'this organisation'} only)</span>}
        </>}
        actions={<>
          <Button icon={I.shield} onClick={() => setPage('accessreview')}>Access review</Button>
        </>}
      />

      <AuditToolbar filters={filters} onChange={setFilters} platform={platform} orgs={orgList}
        live={tail.mode} onLive={setLive} onRefresh={refresh} onExport={() => setExporting(true)} />

      <div className="audit-layout">
        <aside aria-label="Filters">
          <AuditFacets facets={facetsQ.data} filters={filters} onChange={setFilters} platform={platform} orgName={orgName} />
        </aside>

        <div className="audit-main">
          <div className="audit-searchbar">
            <form className="audit-search" onSubmit={(e) => { e.preventDefault(); applySearch(); }}>
              <Input size="sm" leading={I.search} placeholder="Search target, reason…" maxLength={64} value={q} aria-label="Search"
                onChange={(e) => setQ(e.target.value)} onBlur={() => { if ((filters.q ?? '') !== q.trim()) applySearch(); }} />
            </form>
            <SavedViewsBar views={saved.views} filters={filters} onApply={(f) => { setQ(f.q ?? ''); setFilters(f); }}
              onSave={(name, shared) => saved.save.mutateAsync({ name, params: filtersToParams(filters), shared, orgId: shareOrg })}
              onDelete={(v) => saved.remove.mutate(v)} local={saved.local} canShare={!!shareOrg} />
          </div>

          <Card pad="sm" className="audit-histo-card">
            <div className="row justify-between gap-8 wrap">
              <span className="small muted">All events in {query.org ? orgName(query.org) : 'scope'} · {filters.range === 'custom' ? 'no histogram for a custom range' : PRESET_LABEL[filters.range]}</span>
              {summaryQ.data && <span className="mono small">{summaryQ.data.total.toLocaleString()} events</span>}
              {!summaryQ.data && facetsQ.data?.total != null && <span className="mono small">{facetsQ.data.total.toLocaleString()} matching</span>}
            </div>
            <AuditHistogram summary={summaryQ.data} loading={summaryQ.isLoading && eventsQ.isSuccess}
              onZoom={(t, ms) => setFilters(zoomTo(filters, t, ms))} />
          </Card>

          {tail.mode === 'sse' || tail.mode === 'poll' ? (
            <div className="audit-live small" role="status"><span className="audit-live-dot" aria-hidden="true" /> Live{tail.mode === 'poll' ? ' (checking every 10 s)' : ''} · {tail.events.length} new</div>
          ) : tail.mode === 'stopped' ? (
            <Callout tone="neutral" icon={I.clock} actions={<Button size="sm" onClick={() => { tail.reset(); setLive(true); }}>Resume</Button>}>
              Live view stopped after 15 min.
            </Callout>
          ) : null}

          {truncated && (
            <Callout tone="warning" icon={I.info}>
              Showing the newest {MAX_ENTRIES.toLocaleString('en-US').replace(',', ' ')} of more events in this range. Narrow the range or export for the full set.
            </Callout>
          )}

          <Card pad="none" className="audit-list">
            {eventsQ.isError ? (
              <div className="p-12"><AuditError error={eventsQ.error} onRetry={() => eventsQ.refetch()} /></div>
            ) : eventsQ.isLoading ? <AuditLoading /> : events.length === 0 ? (
              <EmptyState compact icon={I.audit} title="No events"
                action={<div className="row gap-8 wrap justify-center">
                  {activeCount(filters) > 0 && <Button size="sm" onClick={() => { setQ(''); setFilters(clearFilters(filters)); }}>Clear filters</Button>}
                  {filters.range !== '30d' && <Button size="sm" onClick={() => setFilters({ ...filters, range: '30d', from: undefined, to: undefined })}>Widen to 30 days</Button>}
                </div>}>
                No events in {scopeText || 'scope'} between {fmtDay(range.from)} and {fmtDay(range.to)} matching these filters.
              </EmptyState>
            ) : (
              <AuditEvents events={events} openId={openId} platform={platform} orgName={orgName} onOpenUser={openUser}
                onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))} />
            )}
          </Card>

          {eventsQ.hasNextPage && (
            <div className="row justify-center mt-12">
              <Button variant="ghost" icon={I.caret} loading={eventsQ.isFetchingNextPage} onClick={() => void eventsQ.fetchNextPage()}>Load older</Button>
            </div>
          )}
          {eventsQ.isSuccess && (
            <div className="small muted mt-12 text-center">
              {events.length.toLocaleString()} loaded{eventsQ.hasNextPage ? ' · more available' : ''}{firstPage?.queryMs != null ? ` · ${firstPage.queryMs} ms` : ''} · read-only
            </div>
          )}
        </div>
      </div>

      <AuditExportDialog open={exporting} onClose={() => setExporting(false)} query={query}
        rangeLabel={`${fmtDay(range.from)} – ${fmtDay(range.to)}${activeCount(filters) ? ` · ${activeCount(filters)} filter${activeCount(filters) > 1 ? 's' : ''}` : ''}`} />
    </>
  );
}

