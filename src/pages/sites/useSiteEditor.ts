import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { draftConflictOf, sitesApi, siteKeys, useSite, useSiteDraft, notAvailable, type SiteError } from '../../api/sites';
import { intentChanges } from '../../lib/sites/diffWords';
import type { DraftConflict, Preview, Site } from '../../lib/sites/types';

/**
 * One site being edited (site-ux.md §0.5): the saved intent, the server-side draft on top of it,
 * autosave of every edit into that draft, and the live preview (gatekit checks) of what is there.
 *
 * Nothing here reaches the gateway. A draft is per site on the server; edits land in local state at
 * once and are written 800 ms after the last one, so typing never waits on the network.
 *
 * Every autosave names the draft it started from (If-Match). When somebody else saved the draft
 * since, it is refused and the editor stops autosaving: `conflict` says who and when, and the
 * person picks `reloadDraft` (theirs) or `overwriteDraft` (mine). Never a silent overwrite.
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
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'failed' | 'conflict'>('idle');
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  // The draft etag the next autosave names: the loaded draft's, then each autosave's answer. A
  // refetch is adopted only with no edits of mine in hand — taking the etag of a draft somebody
  // else saved meanwhile would let my next autosave overwrite theirs without a word.
  const etag = useRef<string | undefined>(undefined);
  const editing = local !== null;
  useEffect(() => { if (!editing) etag.current = draftQ.data?.etag; }, [draftQ.data, editing]);
  const conflicted = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // What the screens show: local edits, else the server draft, else the saved version.
  const current: Partial<Site> | null = local ?? serverDraft ?? saved;
  const site = isComplete(current) ? current : null;
  const hasDraft = local !== null || !!serverDraft;
  const changes = useMemo(() => (hasDraft ? intentChanges(saved, current) : []), [hasDraft, saved, current]);

  // The autosave in flight, and a counter reset() bumps so an answer arriving after a save is ignored.
  const inflight = useRef<Promise<void> | null>(null);
  const generation = useRef(0);

  const flush = useCallback(async (next: Partial<Site>, ifMatch: string | undefined = etag.current) => {
    const gen = generation.current;
    setSaving('saving');
    const p = (async () => {
      try {
        const d = await sitesApi.putDraft(name, next, detail.data?.version ?? draftQ.data?.baseVersion, ifMatch);
        if (gen !== generation.current) return;
        etag.current = d.etag;
        qc.setQueryData(siteKeys.draft(name), d);
        void qc.invalidateQueries({ queryKey: siteKeys.list() });
        conflicted.current = false;
        setConflict(null);
        setSaving('saved');
        setSaveError(null);
      } catch (err) {
        if (gen !== generation.current) return;
        const c = draftConflictOf(err);
        if (c) {
          conflicted.current = true;
          setConflict(c);
          setSaving('conflict');
          return;
        }
        setSaving('failed');
        setSaveError((err as Error).message);
      }
    })();
    inflight.current = p;
    await p;
  }, [name, detail.data?.version, draftQ.data?.baseVersion, qc]);

  const update = useCallback((fn: (s: Site) => Site) => {
    setLocal((prev) => {
      const base = prev ?? serverDraft ?? saved;
      if (!isComplete(base)) return prev;
      const next = fn(base);
      clearTimeout(timer.current);
      // Held while the draft is in conflict: the next write is the person's choice, not a timer's.
      if (conflicted.current) return next;
      setSaving('pending');
      timer.current = setTimeout(() => void flush(next), AUTOSAVE_MS);
      return next;
    });
  }, [serverDraft, saved, flush]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    if (local && !conflicted.current) await flush(local);
  }, [local, flush]);

  /** The conflict settled their way: my unsaved edits are dropped, their draft is loaded. */
  const reloadDraft = useCallback(async () => {
    clearTimeout(timer.current);
    generation.current += 1;
    conflicted.current = false;
    setConflict(null);
    setLocal(null);
    setSaving('idle');
    await qc.invalidateQueries({ queryKey: siteKeys.draft(name) });
  }, [name, qc]);

  /** The conflict settled my way: my edits replace the draft they saved (If-Match: theirs). */
  const overwriteDraft = useCallback(async () => {
    if (!conflict || !local) return;
    clearTimeout(timer.current);
    await flush(local, conflict.etag || undefined);
  }, [conflict, local, flush]);

  const discard = useCallback(async () => {
    clearTimeout(timer.current);
    await sitesApi.deleteDraft(name);
    etag.current = undefined;
    conflicted.current = false;
    setConflict(null);
    setLocal(null);
    setSaving('idle');
    qc.setQueryData(siteKeys.draft(name), null);
    void qc.invalidateQueries({ queryKey: siteKeys.list() });
  }, [name, qc]);

  /**
   * Before saving a version: no autosave may land after it. Saving deletes the server draft; an
   * autosave timer firing (or a PUT still in flight) a moment later wrote it back, and the site
   * showed "Draft · unapplied changes" right after being published.
   */
  const settle = useCallback(async () => {
    clearTimeout(timer.current);
    await inflight.current?.catch(() => {});
  }, []);

  /** After a save: the saved version is the new truth; forget local edits. */
  const reset = useCallback(() => {
    generation.current += 1;
    clearTimeout(timer.current);
    etag.current = undefined;
    conflicted.current = false;
    setConflict(null);
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
    name, detail, draftQuery: draftQ, saved, current, site, hasDraft, changes, update, saveNow, discard, reset, settle,
    saving, saveError, conflict, reloadDraft, overwriteDraft, preview, system, loading, missing,
    neverSaved: !saved && !!current,
  };
}

export type SiteEditor = ReturnType<typeof useSiteEditor>;
