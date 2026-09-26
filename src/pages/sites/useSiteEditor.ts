import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sitesApi, siteKeys, useSite, useSiteDraft, notAvailable, type SiteError } from '../../api/sites';
import { intentChanges } from '../../lib/sites/diffWords';
import type { Preview, Site } from '../../lib/sites/types';

/**
 * One site being edited (site-ux.md §0.5): the saved intent, the server-side draft on top of it,
 * autosave of every edit into that draft, and the live preview (gatekit checks) of what is there.
 *
 * Nothing here reaches the gateway. A draft is per site on the server; edits land in local state at
 * once and are written 800 ms after the last one, so typing never waits on the network.
 */

const AUTOSAVE_MS = 800;
const PREVIEW_MS = 250;

/** A draft is complete enough to preview when it carries the fields render needs. */
export function isComplete(s: Partial<Site> | null | undefined): s is Site {
  return !!s && !!s.name && !!s.address?.host && !!s.upstream?.service && Array.isArray(s.gates) && s.gates.length > 0 && !!s.routes?.catchAll && !!s.groups && Array.isArray(s.orgs) && s.roles !== undefined;
}

export type PreviewState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'ok'; preview: Preview }
  | { state: 'unavailable'; message: string }
  | { state: 'invalid'; message: string; issues?: unknown };

export function useSiteEditor(name: string) {
  const qc = useQueryClient();
  const detail = useSite(name);
  const draftQ = useSiteDraft(name);
  const saved = detail.data?.site ?? null;
  const serverDraft = draftQ.data?.site as Partial<Site> | undefined;

  const [local, setLocal] = useState<Partial<Site> | null>(null);
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'failed'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // What the screens show: local edits, else the server draft, else the saved version.
  const current: Partial<Site> | null = local ?? serverDraft ?? saved;
  const site = isComplete(current) ? current : null;
  const hasDraft = local !== null || !!serverDraft;
  const changes = useMemo(() => (hasDraft ? intentChanges(saved, current) : []), [hasDraft, saved, current]);

  const flush = useCallback(async (next: Partial<Site>) => {
    setSaving('saving');
    try {
      const d = await sitesApi.putDraft(name, next, detail.data?.version ?? draftQ.data?.baseVersion);
      qc.setQueryData(siteKeys.draft(name), d);
      void qc.invalidateQueries({ queryKey: siteKeys.list() });
      setSaving('saved');
      setSaveError(null);
    } catch (err) {
      setSaving('failed');
      setSaveError((err as Error).message);
    }
  }, [name, detail.data?.version, draftQ.data?.baseVersion, qc]);

  const update = useCallback((fn: (s: Site) => Site) => {
    setLocal((prev) => {
      const base = prev ?? serverDraft ?? saved;
      if (!isComplete(base)) return prev;
      const next = fn(base);
      clearTimeout(timer.current);
      setSaving('pending');
      timer.current = setTimeout(() => void flush(next), AUTOSAVE_MS);
      return next;
    });
  }, [serverDraft, saved, flush]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    if (local) await flush(local);
  }, [local, flush]);

  const discard = useCallback(async () => {
    clearTimeout(timer.current);
    await sitesApi.deleteDraft(name);
    setLocal(null);
    setSaving('idle');
    qc.setQueryData(siteKeys.draft(name), null);
    void qc.invalidateQueries({ queryKey: siteKeys.list() });
  }, [name, qc]);

  /** After an apply: the saved version is the new truth; forget local edits. */
  const reset = useCallback(() => {
    clearTimeout(timer.current);
    setLocal(null);
    setSaving('idle');
  }, []);

  // ── preview ─────────────────────────────────────────────────
  const [preview, setPreview] = useState<PreviewState>({ state: 'idle' });
  const previewKey = site ? JSON.stringify(site) : '';
  useEffect(() => {
    if (!site) { setPreview({ state: 'idle' }); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setPreview((p) => (p.state === 'ok' ? p : { state: 'running' }));
      try {
        const out = await sitesApi.preview(site);
        if (!cancelled) setPreview({ state: 'ok', preview: out });
      } catch (err) {
        if (cancelled) return;
        const e = err as SiteError;
        if (e.status === 503 || notAvailable(err)) setPreview({ state: 'unavailable', message: e.status === 503 ? 'Checks are unavailable (gatekit did not answer), so nothing can be applied right now. Nothing was changed.' : 'This server has no preview yet.' });
        else setPreview({ state: 'invalid', message: e.message, issues: e.details?.issues });
      }
    }, PREVIEW_MS);
    return () => { cancelled = true; clearTimeout(t); };
    // previewKey stands for `site` by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const system = !!detail.data?.system;
  const loading = detail.isLoading || draftQ.isLoading;
  // A site that only exists as a draft (plugged, never saved) has no detail: 404 not_found.
  const missing = !loading && !current && ((detail.error as SiteError | null)?.status === 404);

  return {
    name, detail, draftQuery: draftQ, saved, current, site, hasDraft, changes, update, saveNow, discard, reset,
    saving, saveError, preview, system, loading, missing,
    neverSaved: !saved && !!current,
  };
}

export type SiteEditor = ReturnType<typeof useSiteEditor>;
