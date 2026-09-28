import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Callout, Card, CodeView, Field, I, Segmented, Textarea, Timeline } from '../../../components/ui';
import { AdvancedDisclosure } from '../../../components/ui/Primitives';
import { sitesApi, checksOf, useInvalidateSite, useSitesPlatform, useSiteStatus, notAvailable } from '../../../api/sites';
import { checkCounts, riskLine, summarizeArtefact } from '../../../lib/sites/diffWords';
import { applyFinished, derivedStages, fromProgress } from '../../../lib/sites/stages';
import { summarySentence } from '../../../lib/sites/templates';
import type { ApplyResult, Check } from '../../../lib/sites/types';
import type { SiteEditor } from '../useSiteEditor';
import type { Go } from '../SiteDetail';
import { CheckList, RiskBadge } from '../parts';
import { checkLines } from '../../../lib/sites/format';
import { describeSiteError, publishAction, useSiteAction } from '../useAction';
import { useApp } from '../../../contexts/AppContext';
import { stepUpAndResume, useResume } from '../../../lib/resume';

/**
 * Review → Apply → Verify (site-ux.md §9). In words first, then the checks and the risk, then the
 * artefacts that change. Apply saves the draft as a version, then applies it: permissions first,
 * then the Site object — and the timeline follows the operator as far as the server lets it see.
 *
 * Saving and publishing are two calls, and only the second needs a recent second factor. A version
 * saved but refused at publish is said as such ("v17 saved, not live yet") with its own Publish, and
 * after the step-up the publish of that version runs again by itself, once.
 */

export function ReviewTab({ ed, canApply, go, query = {} }: { ed: SiteEditor; canApply: boolean; go: Go; query?: Record<string, string> }) {
  const site = ed.site;
  const platform = useSitesPlatform();
  const invalidate = useInvalidateSite();
  const { run, busy } = useSiteAction();
  const { pushToast } = useApp();
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'words' | 'raw'>('words');
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  // `version`: saved, and refused at publish — the draft is gone into it, only the publish is left.
  const [failure, setFailure] = useState<{ message: string; checks: Check[]; version?: number } | null>(null);
  const [resumed, setResumed] = useState<number | null>(null);
  const siteKey = site ? JSON.stringify(site) : '';
  const diff = useQuery({ queryKey: ['sites', 'diff', ed.name, siteKey], queryFn: () => sitesApi.diff(ed.name, site!), enabled: !!site && !result, retry: false });
  const status = useSiteStatus(ed.name, { poll: !!result });
  const progress = useQuery({
    queryKey: ['sites', 'apply', ed.name, result?.applyId],
    queryFn: () => sitesApi.applyProgress(ed.name, result!.applyId),
    enabled: !!result, retry: false,
    refetchInterval: (q) => (q.state.error || (q.state.data && applyFinished(q.state.data)) ? false : 1000),
  });
  // An edit clears a refusal; a version saved and not published stays said until it is.
  useEffect(() => { setFailure((f) => (f?.version != null ? f : null)); }, [siteKey]);

  // The latest saved version when it is not what the gateway serves, and nothing newer is drafted.
  const d = ed.detail.data;
  const notLive = d && !ed.hasDraft && d.applied?.version !== d.version ? d.version : null;

  // Back from the step-up a refused publish sent the operator to: publish that version, once, if
  // it is still the latest saved one and still not live. Anything else is said, not guessed at.
  useResume<{ version: number }>(canApply ? publishAction(ed.name) : null, !!d, ({ version }) => {
    if (d && d.version === version && d.applied?.version !== version) {
      setResumed(version);
      void publish(version);
    } else if (d?.applied?.version !== version) {
      pushToast(`v${version} was not published`, { err: true, sub: `Somebody saved v${d?.version} since. Review it and publish again.`, ttl: 8000 });
    }
  });

  if (!site && !result) return <Callout tone="warning" icon={I.alert}>This draft is incomplete; finish it before review.</Callout>;

  const production = !!platform.data?.production;
  const first = !ed.detail.data?.applied;
  const preview = ed.preview.state === 'ok' ? ed.preview.preview : null;
  const checks = preview?.checks ?? [];
  const { errors, warnings } = checkCounts(checks);
  const risk = diff.data?.risk ?? preview?.risk;
  const blocked = errors > 0 || ed.preview.state !== 'ok' || (production && !note.trim());

  async function publish(version: number) {
    setApplying(true);
    setFailure(null);
    try {
      const out = await sitesApi.apply(ed.name, version);
      setResult(out);
      invalidate(ed.name);
    } catch (err) {
      if ((err as { code?: string }).code === 'reauth_required' && stepUpAndResume(publishAction(ed.name), { version })) {
        pushToast('Confirm it’s you', { err: true, sub: `v${version} is saved but not live yet. Taking you to prove your second factor; back here it is published by itself.`, ttl: 4000 });
      }
      setFailure({ message: describeSiteError(err), checks: checksOf(err), version });
      invalidate(ed.name);
    } finally {
      setApplying(false);
      setResumed(null);
    }
  }

  async function apply() {
    if (!site) return;
    setApplying(true);
    setFailure(null);
    // No autosave may write the draft back after the save deletes it.
    await ed.settle();
    let saved: { version: number };
    try {
      saved = await sitesApi.save(ed.name, site, { note: note || undefined, etag: ed.detail.data?.etag });
    } catch (err) {
      setFailure({ message: describeSiteError(err), checks: checksOf(err) });
      invalidate(ed.name);
      setApplying(false);
      return;
    }
    // Saved: the draft is that version now, whatever the publish answers.
    ed.reset();
    invalidate(ed.name);
    await publish(saved.version);
  }

  const views = result
    ? progress.data ? fromProgress(progress.data) : derivedStages({ applying: false, applied: true, status: status.data, statusUnavailable: !!status.error && notAvailable(status.error) })
    : derivedStages({ applying, applied: false, failure: failure?.message });

  return (
    <div className="stack gap-16">
      {production && <Callout tone="danger" icon={I.alert} title="PRODUCTION · changes are live">High-risk changes may need a second super admin; a note is required.</Callout>}
      {query.imported && !result && <ImportedCallout counts={query.imported} onDismiss={() => go('review')} />}

      <Card title={first ? `Go live with ${site?.displayName ?? ed.name}` : `Review changes to ${site?.displayName ?? ed.name}`} sub={first ? 'First version' : `Draft based on v${ed.detail.data?.version}`}>
        {site && <p className="m-0">{summarySentence(site)}</p>}
        {diff.data?.words.length ? <ul className="site-list mt-8">{diff.data.words.map((w) => <li key={w}>{w}</li>)}</ul> : null}
      </Card>

      {!result && (
        <Card title="Checks" sub={ed.preview.state === 'ok' ? `${errors === 0 ? '✓' : '✗'} ${errors} blocking · ${warnings} warning${warnings === 1 ? '' : 's'}` : undefined}>
          {ed.preview.state === 'running' || ed.preview.state === 'idle' ? <CheckList lines={[{ level: 'pending', text: 'Rendering and checking against every live rule…' }]} />
            : ed.preview.state === 'unavailable' ? <Callout tone="danger" icon={I.alert}>{ed.preview.message}</Callout>
            : ed.preview.state === 'invalid' ? <Callout tone="danger" icon={I.alert} title="The draft is not a valid site yet">{ed.preview.message}</Callout>
            : checks.length === 0 ? <CheckList lines={[{ level: 'ok', text: 'All checks passed: patterns compile, no overlap with live rules, no route ties, groups exist, address is in a zone.' }]} />
            : <CheckList lines={checkLines(checks)} />}
          {risk && <div className="row gap-8 items-center mt-12"><RiskBadge level={risk.level} /><span className="small">{diff.data?.words.length ? 'Why: the changes listed at the top.' : riskLine(risk)}</span></div>}
        </Card>
      )}

      {!result && (
        <Card title="What will change" actions={<Segmented label="Show" value={mode} onChange={setMode} options={[{ value: 'words', label: 'In words' }, { value: 'raw', label: 'Raw JSON' }]} />}>
          {diff.error ? <Callout tone="warning" icon={I.alert}>{describeSiteError(diff.error)}</Callout> : !diff.data ? <p className="small muted m-0">Comparing with what is live…</p>
            : diff.data.artefacts.length === 0 ? <p className="small m-0">Nothing the gateway or the policy engine sees changes.</p>
            : mode === 'words' ? (
              <div className="stack gap-4">
                {diff.data.artefacts.map(summarizeArtefact).filter((s) => s.items.length > 0).map((s) => {
                  const a = { kind: s.kind };
                  return (
                    <AdvancedDisclosure key={a.kind} label={s.label} note={s.line}>
                      <ul className="site-diff-items">
                        {s.items.map((it, i) => <li key={i} className={`site-diff-${it.sign === '+' ? 'add' : it.sign === '−' ? 'del' : 'chg'}`}><span aria-hidden="true" className="mono">{it.sign}</span> <span className="mono small">{it.text}</span></li>)}
                      </ul>
                    </AdvancedDisclosure>
                  );
                })}
                <p className="small muted m-0">Address / ingress and sign-in: {site?.exposure?.mode === 'vanity' ? 'an Ingress from the operator’s fixed template' : 'no change (the zone’s wildcard serves it)'}.</p>
              </div>
            ) : diff.data.artefacts.map((a) => <CodeView key={a.kind} title={a.kind} language="json" maxHeight="md" code={JSON.stringify({ before: a.before, after: a.after }, null, 2)} />)}
        </Card>
      )}

      {resumed != null && <Callout tone="success" icon={I.check} title="Second factor confirmed">Publishing v{resumed}, which was saved before the check.</Callout>}

      {!result && !applying && !failure && notLive != null && (
        <Callout tone="warning" icon={I.alert} title={`v${notLive} saved, not live yet`}
          actions={canApply && <Button size="sm" variant="primary" onClick={() => void publish(notLive)}>Publish v{notLive}</Button>}>
          <div className="small">The gateway serves {d?.applied ? `v${d.applied.version}` : 'nothing for this site yet'}. Publishing makes v{notLive} live.</div>
        </Callout>
      )}

      {(applying || result || failure) && (
        <Card title={result ? `Applying ${site?.displayName ?? ed.name} v${result.version}` : 'Apply'} sub={result ? `Site ${result.site} · ${result.rules.length} rule${result.rules.length === 1 ? '' : 's'}${platform.data?.rulesLoadExpectedSec ? ` · rules usually load in ~${platform.data.rulesLoadExpectedSec} s here` : ''}` : undefined}>
          <div aria-live="polite">
            <Timeline items={views.map((s) => ({ id: s.id, label: s.label, state: s.state, meta: s.meta, detail: s.detail }))} />
          </div>
          {failure?.checks.length ? <CheckList className="mt-8" lines={checkLines(failure.checks)} /> : null}
          {failure?.version != null && (
            <Callout tone="warning" icon={I.alert} title={`v${failure.version} saved, not live yet`} className="mt-12"
              actions={canApply && <Button size="sm" variant="primary" loading={applying} onClick={() => void publish(failure.version!)}>Publish v{failure.version}</Button>}>
              <div className="small">The gateway still serves {d?.applied ? `v${d.applied.version}` : 'nothing for this site'}. {failure.message}</div>
            </Callout>
          )}
          {result && (
            <div className="row gap-8 mt-12 wrap">
              <span className="small muted">You can leave this page.</span>
              <Button size="sm" onClick={() => go('routes', { test: 'GET /' })}>Test a URL</Button>
              <Button size="sm" onClick={() => go('status')}>Show conditions</Button>
              {result.version > 1 && canApply && (
                <Button size="sm" variant="danger" loading={busy === 'Rollback'} onClick={async () => {
                  const out = await run('Rollback', () => sitesApi.rollback(ed.name, result.version - 1), `Rolled back to v${result.version - 1}`);
                  if (out) { setResult(out); invalidate(ed.name); }
                }}>Roll back to v{result.version - 1}</Button>
              )}
            </div>
          )}
        </Card>
      )}

      {!result && (
        <Card>
          <Field label="Note for history" hint={production ? 'Required on production — changes are recorded with a reason.' : 'Optional. Shown in History.'} required={production}>
            <Textarea rows={2} value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} placeholder="Add reports endpoints" />
          </Field>
          <div className="row gap-8 justify-end mt-12 wrap">
            <Button onClick={() => void ed.saveNow()} loading={ed.saving === 'saving'}>Save draft</Button>
            {!canApply && (
              <Button variant="primary" loading={busy === 'Request'} onClick={() => void run('Request', () => sitesApi.requestApply(ed.name, { version: ed.detail.data?.version ?? 0, note: note || undefined }), 'Sent to a super admin for review')}>Request apply</Button>
            )}
            {canApply && (
              notLive != null ? (
                <Button variant={production ? 'danger' : 'primary'} loading={applying} onClick={() => void publish(notLive)}>
                  Publish v{notLive}
                </Button>
              ) : (
                <Button variant={production ? 'danger' : 'primary'} kbd="⌘↵" disabled={blocked} loading={applying} onClick={() => void apply()}>
                  {production ? 'Apply to production' : first ? 'Go live' : 'Apply changes'}
                </Button>
              )
            )}
          </div>
          {canApply && blocked && ed.preview.state === 'ok' && (
            <p className="small text-danger mt-8 mb-0">{errors > 0 ? `${errors} blocking check${errors === 1 ? '' : 's'} above must be fixed first.` : 'Add a note first.'}</p>
          )}
        </Card>
      )}
    </div>
  );
}

/**
 * Back from an OpenAPI import (`?imported=added.changed.removed`): what it wrote, and that it is in
 * the draft only — nothing is live until it is published here.
 */
function ImportedCallout({ counts, onDismiss }: { counts: string; onDismiss: () => void }) {
  const [added, changed, removed] = counts.split('.').map((n) => Number(n) || 0);
  const total = added + changed + removed;
  const parts = [added && `${added} added`, changed && `${changed} changed`, removed && `${removed} refused (gone from the spec)`].filter(Boolean).join(', ');
  return counts === 'none' || total === 0
    ? <Callout tone="info" icon={I.info} actions={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}>The import changed no route: the draft already matches the spec.</Callout>
    : (
      <Callout tone="success" icon={I.check} title={`Imported ${total} route${total === 1 ? '' : 's'} into the draft`} actions={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}>
        {parts}. Nothing is live yet: review the changes below, then publish.
      </Callout>
    );
}
