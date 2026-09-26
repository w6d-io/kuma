import type { ApplyProgress, SiteK8sStatus, StageState } from './types';

/**
 * The Apply timeline (site-ux.md §9.2). When jinbe streams stages (`GET …/applies/:id` + SSE) they
 * are shown as they come. Until that endpoint exists, the timeline is derived: the apply call itself
 * proves Saved + Permissions published + Site written; the Site's status (when served) proves the
 * operator and the gateway; otherwise the gateway stage says honestly that it cannot be observed.
 */

// jinbe's stage ids, in order (S-3). A zone site reports ingress and certificate as skipped.
export const STAGES: Array<{ id: string; label: string }> = [
  { id: 'saved', label: 'Saved' },
  { id: 'permissions', label: 'Permissions published' },
  { id: 'accepted', label: 'Site accepted' },
  { id: 'rules-synced', label: 'Gateway rules written' },
  { id: 'rules-loaded', label: 'Gateway rules loaded' },
  { id: 'ingress', label: 'Address' },
  { id: 'certificate', label: 'HTTPS' },
  { id: 'verified', label: 'Verified' },
];

/** The apply's failure codes (S-3) in words (site-ux.md §10.7). */
export const APPLY_CODE: Record<string, string> = {
  site_invalid: 'The site operator refused this version. Nothing was changed on the gateway.',
  rules_not_loaded: 'The gateway didn’t load the new rules in time, so the previous version was restored. Visitors weren’t affected.',
  rollback_failed: 'The gateway didn’t take the new rules and going back failed too — check Status now.',
  not_ready: 'The site is not ready yet; the operator is still working on it.',
};

export interface StageView { id: string; label: string; state: 'pending' | 'running' | 'done' | 'failed'; detail?: string; meta?: string }

const toView = (s: StageState): StageView['state'] => (s === 'skipped' ? 'done' : s);

function duration(a?: string, b?: string): string | undefined {
  if (!a || !b) return undefined;
  const ms = Date.parse(b) - Date.parse(a);
  return Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(1)} s` : undefined;
}

/** Stages as jinbe streams them, in the canonical order, unknown ids appended. */
export function fromProgress(p: ApplyProgress): StageView[] {
  const known = STAGES.map(({ id, label }) => {
    const s = p.stages.find((x) => x.id === id);
    if (!s) return null;
    return { id, label: s.label ?? label, state: toView(s.state), detail: s.state === 'skipped' ? (s.detail ?? 'not needed') : s.detail, meta: duration(s.startedAt, s.endedAt) };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  const extra = p.stages.filter((s) => !STAGES.some((k) => k.id === s.id)).map((s) => ({ id: s.id, label: s.label ?? s.id, state: toView(s.state), detail: s.detail }));
  const out: StageView[] = [...known, ...extra];
  if (p.state === 'failed' || p.state === 'rolled-back') {
    out.push({ id: 'outcome', label: p.state === 'rolled-back' ? 'Rolled back' : 'Did not go live', state: 'failed', detail: [p.code && APPLY_CODE[p.code], p.message].filter(Boolean).join(' ') || undefined });
  }
  return out;
}

const cond = (st: SiteK8sStatus, type: string) => st.conditions.find((c) => c.type === type);

/**
 * Derived from what can be observed: `applied` (the apply call returned) and the Site status when
 * the server has it. `failure` is the apply error, if any.
 */
export function derivedStages(o: { applying: boolean; applied: boolean; failure?: string; status?: SiteK8sStatus | null; statusUnavailable?: boolean }): StageView[] {
  const views: StageView[] = [];
  if (o.failure) {
    views.push({ id: 'saved', label: 'Saved', state: 'done' });
    views.push({ id: 'permissions', label: 'Apply', state: 'failed', detail: o.failure });
    return views;
  }
  const first: StageView['state'] = o.applied ? 'done' : o.applying ? 'running' : 'pending';
  views.push({ id: 'saved', label: 'Saved', state: first === 'pending' ? 'pending' : 'done' });
  views.push({ id: 'permissions', label: 'Permissions published', state: first, detail: first === 'done' ? 'routes, roles, groups, org map → policy engine' : undefined });
  if (!o.applied) {
    views.push({ id: 'accepted', label: 'Site accepted', state: 'pending' }, { id: 'rules', label: 'Gateway rules', state: 'pending' });
    return views;
  }
  const st = o.status;
  if (!st) {
    views.push({
      id: 'accepted', label: 'Site written', state: 'done',
      detail: o.statusUnavailable ? 'The Site object was written. This server does not report the operator’s progress yet.' : 'Waiting for the operator…',
    });
    views.push({ id: 'rules', label: 'Gateway rules', state: o.statusUnavailable ? 'done' : 'running', detail: o.statusUnavailable ? 'Not observable here yet — test a URL to confirm.' : undefined });
    return views;
  }
  const validated = cond(st, 'Validated');
  const accepted = st.observedGeneration >= st.generation && validated?.status === 'True';
  const refused = validated?.status === 'False';
  views.push({
    id: 'accepted', label: 'Site accepted',
    state: refused ? 'failed' : accepted ? 'done' : 'running',
    detail: refused ? `The operator refused this version (${validated?.reason ?? 'invalid'}): ${validated?.message ?? ''}. Nothing was changed on the gateway.` : `generation ${st.observedGeneration} / ${st.generation}`,
  });
  const rules = st.children.filter((c) => c.kind === 'Rule');
  const loaded = rules.every((r) => (r.loadedOn ?? []).every((p) => p.loaded) && (!r.expectedHash || r.specHash === r.expectedHash));
  const synced = cond(st, 'RulesLoaded') ?? cond(st, 'RulesSynced');
  views.push({
    id: 'rules', label: 'Gateway rules',
    state: !accepted ? 'pending' : synced?.status === 'False' && synced.reason !== 'Progressing' ? 'failed' : loaded && synced?.status === 'True' ? 'done' : 'running',
    detail: `${rules.length} rule${rules.length === 1 ? '' : 's'}${synced?.message ? ` · ${synced.message}` : ''}`,
  });
  const ingress = cond(st, 'IngressReady');
  if (ingress) views.push({ id: 'address', label: 'Address', state: ingress.status === 'True' ? 'done' : 'running', detail: ingress.message ?? ingress.reason });
  const cert = cond(st, 'CertificateReady');
  if (cert) views.push({ id: 'https', label: 'HTTPS', state: cert.status === 'True' ? 'done' : 'running', detail: cert.reason === 'NotRequired' ? 'covered by the zone’s wildcard certificate' : cert.message ?? cert.reason });
  return views;
}

export const settled = (views: StageView[]) => views.every((v) => v.state === 'done' || v.state === 'failed');

/** Whether an apply record is finished (its own state when jinbe sends one). */
export const applyFinished = (p: ApplyProgress) => (p.state ? p.state !== 'running' : settled(fromProgress(p)));
