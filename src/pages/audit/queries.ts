import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auditApi, auditErrorKind, type AuditEventV1, type AuditExportJob, type AuditQuery, type ExportFormat } from '../../api/audit';
import { LIVE_POLL_MS, liveExpired, mergeLive, parseTailMessage } from '../../lib/audit/live';
import { toServerFilters } from '../../lib/audit/filters';
import { fromServer, readLocalViews, writeLocalViews, addLocalView, DEFAULT_VIEWS, type SavedView } from '../../lib/audit/savedViews';
import { isTerminal, pollDelay } from '../../lib/audit/exportJob';

/**
 * The Audit tab's queries. The range is resolved once per filter change, so the cache key is stable
 * while the page is open; Refresh (or Live) is how a reader sees what happened since.
 */
const noRetryOn = (n: number, err: unknown) => {
  const kind = auditErrorKind(err);
  return kind !== 'not-available' && kind !== 'out-of-scope' && kind !== 'range' && n < 1;
};

export function useAuditEventPages(q: AuditQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['audit', 'log', 'events', q],
    queryFn: ({ pageParam }) => auditApi.events(q, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    retry: noRetryOn,
    staleTime: 60_000,
  });
}

export function useAuditFacets(q: AuditQuery, enabled = true) {
  return useQuery({ queryKey: ['audit', 'log', 'facets', q], queryFn: () => auditApi.facets(q), enabled, retry: noRetryOn, staleTime: 60_000 });
}

/** The histogram's series: the last `window` in scope (jinbe filters it by org only). None for a custom range. */
export function useAuditHistogram(window: string | null, org: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['audit', 'log', 'summary', window, org],
    queryFn: () => auditApi.summary(window as string, org),
    enabled: enabled && !!window,
    retry: noRetryOn,
    staleTime: 60_000,
  });
}

export function useAuditEventDetail(id: string | null, ts?: string) {
  return useQuery({
    queryKey: ['audit', 'log', 'event', id, ts],
    queryFn: () => auditApi.event(id as string, ts),
    enabled: !!id,
    retry: noRetryOn,
    staleTime: 5 * 60_000,
  });
}

export function useUserTimeline(userId: string, range: { from: string; to: string }) {
  return useInfiniteQuery({
    queryKey: ['audit', 'log', 'user', userId, range],
    queryFn: ({ pageParam }) => auditApi.userTimeline(userId, range, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: noRetryOn,
    staleTime: 60_000,
  });
}

/**
 * Saved views: defaults + the reader's own. From jinbe when it has saved-queries; kept in this
 * browser while it does not (the router's 404), so the feature works before the backend does.
 */
export function useSavedViews() {
  const qc = useQueryClient();
  const server = useQuery({ queryKey: ['audit', 'log', 'saved'], queryFn: auditApi.savedQueries, retry: noRetryOn, staleTime: 5 * 60_000 });
  const local = !server.isSuccess;
  const [localViews, setLocalViews] = useState<SavedView[]>(readLocalViews);
  const views: SavedView[] = [...DEFAULT_VIEWS, ...(local ? localViews : (server.data ?? []).map(fromServer))];

  const save = useMutation({
    mutationFn: async ({ name, params, shared, orgId }: { name: string; params: Record<string, string>; shared: boolean; orgId?: string }) => {
      if (!local) return fromServer(await auditApi.saveQuery({ name, filters: toServerFilters(params), shared: shared && !!orgId, orgId: shared ? orgId : undefined }));
      const next = addLocalView(localViews, name, params);
      setLocalViews(next);
      writeLocalViews(next);
      return next[next.length - 1];
    },
    onSuccess: () => { if (!local) qc.invalidateQueries({ queryKey: ['audit', 'log', 'saved'] }); },
  });

  const remove = useMutation({
    mutationFn: async (v: SavedView) => {
      if (v.origin === 'server') return auditApi.deleteQuery(v.id);
      const next = localViews.filter((x) => x.id !== v.id);
      setLocalViews(next);
      writeLocalViews(next);
    },
    onSuccess: () => { if (!local) qc.invalidateQueries({ queryKey: ['audit', 'log', 'saved'] }); },
  });

  return { views, local, save, remove };
}

export type LiveMode = 'off' | 'sse' | 'poll' | 'stopped';

/**
 * The live tail: SSE on `/audit/tail` when jinbe serves it, polling `/audit/events` from the newest
 * event seen otherwise. Stops itself after 15 minutes (jinbe's cap) and says so.
 */
export function useLiveTail(q: Omit<AuditQuery, 'from' | 'to'>, on: boolean) {
  const [events, setEvents] = useState<AuditEventV1[]>([]);
  const [mode, setMode] = useState<LiveMode>('off');
  const startedAt = useRef(0);
  const qKey = JSON.stringify(q);

  useEffect(() => {
    if (!on) { setMode((m) => (m === 'stopped' ? m : 'off')); return; }
    const query = JSON.parse(qKey) as Omit<AuditQuery, 'from' | 'to'>;
    startedAt.current = Date.now();
    setEvents([]);
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let since = new Date().toISOString();

    const stop = () => {
      es?.close();
      if (timer) clearTimeout(timer);
      cancelled = true;
      setMode('stopped');
    };
    const push = (batch: AuditEventV1[]) => {
      if (!batch.length) return;
      setEvents((cur) => mergeLive(cur, batch));
      const newest = batch.reduce((a, e) => (e.ts > a ? e.ts : a), since);
      since = newest;
    };
    const poll = async () => {
      if (cancelled) return;
      if (liveExpired(startedAt.current)) { stop(); return; }
      try {
        const page = await auditApi.events({ ...query, from: since, to: new Date().toISOString() }, null, 200);
        push(page.events);
      } catch { /* the next tick tries again; the page shows its own error for the list */ }
      if (!cancelled) timer = setTimeout(poll, LIVE_POLL_MS);
    };
    const startPolling = () => { es?.close(); es = null; setMode('poll'); void poll(); };

    if (typeof EventSource === 'undefined') startPolling();
    else {
      let opened = false;
      es = new EventSource(auditApi.tailUrl(query), { withCredentials: true });
      es.onopen = () => { opened = true; setMode('sse'); };
      // jinbe names its events: `audit` carries one event, `end` says the 15-minute cap was reached.
      es.addEventListener('audit', (m) => push(parseTailMessage((m as MessageEvent).data)));
      es.addEventListener('end', stop);
      es.onmessage = (m) => push(parseTailMessage(m.data));
      // Never opened: no tail endpoint (or refused) — poll instead. Dropped after opening: jinbe's
      // 15-minute cap or a restart; the browser's own retry would open a second tail, so stop.
      es.onerror = () => { if (!opened) startPolling(); else stop(); };
      timer = setTimeout(function check() {
        if (liveExpired(startedAt.current)) stop();
        else timer = setTimeout(check, 30_000);
      }, 30_000);
    }
    return () => { cancelled = true; es?.close(); if (timer) clearTimeout(timer); };
  }, [on, qKey]);

  const reset = useCallback(() => { setEvents([]); setMode('off'); }, []);
  return { events, mode, reset };
}

/** An async export: start it, poll it until it is done or failed. */
export function useExportJob() {
  const [job, setJob] = useState<AuditExportJob | null>(null);
  const [error, setError] = useState<unknown>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const start = useCallback(async (body: { from: string; to: string; filters: Omit<AuditQuery, 'from' | 'to'>; format: ExportFormat }) => {
    setError(null);
    setJob({ id: '', status: 'queued' });
    try {
      const { id } = await auditApi.startExport(body);
      let attempt = 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, pollDelay(attempt++)));
        if (!alive.current) return null;
        const j = await auditApi.exportJob(id);
        setJob(j);
        if (isTerminal(j.status)) return j;
      }
    } catch (err) {
      setError(err);
      setJob(null);
      return null;
    }
  }, []);

  return { job, error, start, reset: () => { setJob(null); setError(null); } };
}
