import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Callout, Field, I, Textarea, Timeline } from '../../components/ui';
import { gatewayApi, gatewayKeys, useRollout } from '../../api/gateway';
import { notAvailable } from '../../api/sites';
import type { GatewayPreview, HandlerChange, Rollout } from '../../lib/gateway/types';
import type { AdaptedState } from '../../lib/gateway/adapt';
import { CheckList, RiskBadge } from '../sites/parts';
import { describeSiteError, useSiteAction } from '../sites/useAction';

/**
 * Preview → apply → rolling restart → rollback, for a gateway change. The preview says what moves,
 * how risky it is, what refuses it (a handler still used by sites) and what restarts; apply writes
 * the config and starts a rollout the timeline follows pod by pod.
 */

function RolloutView({ rollout, onRollback, busy, canRollback }: { rollout: Rollout; onRollback: () => void; busy: boolean; canRollback: boolean }) {
  const items = rollout.stages.map((s) => ({ id: s.id, label: s.label ?? s.id, state: s.state === 'skipped' ? 'done' as const : s.state, detail: s.detail }));
  return (
    <div className="stack gap-12">
      <p className="m-0 small">Version {rollout.version}{rollout.previousVersion ? ` (was ${rollout.previousVersion})` : ''} · {rollout.state === 'running' ? 'rolling out…' : rollout.state}{rollout.message ? ` · ${rollout.message}` : ''}</p>
      <div aria-live="polite"><Timeline items={items} /></div>
      {rollout.pods?.length ? (
        <ul className="site-list small" aria-label="Pods">
          {rollout.pods.map((p) => <li key={p.name}><span className="mono">{p.name}</span> · {p.component} · {p.ready ? '✓ ready' : '◌ starting'}{p.version ? ` · v${p.version}` : ''}</li>)}
        </ul>
      ) : null}
      {canRollback && rollout.state !== 'running' && (
        <div className="row gap-8 items-center">
          {rollout.state === 'failed' && <span className="small text-danger">The new config did not come up everywhere.</span>}
          <Button variant="danger" size="sm" loading={busy} onClick={onRollback}>Roll back to the previous config</Button>
        </div>
      )}
    </div>
  );
}

export function ChangeReview({ changes, state, onDone, canApply }: { changes: HandlerChange[]; state: AdaptedState | undefined; onDone: () => void; canApply: boolean }) {
  const qc = useQueryClient();
  const { run, busy } = useSiteAction();
  const [preview, setPreview] = useState<GatewayPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [started, setStarted] = useState(false);
  const rollout = useRollout(started);
  const key = JSON.stringify(changes);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    if (!state) return;
    gatewayApi.preview(state, changes).then((p) => { if (!cancelled) setPreview(p); }).catch((err) => {
      if (!cancelled) setError(notAvailable(err) ? 'The gateway preview is not available on this server yet.' : describeSiteError(err));
    });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const production = !!state?.production;
  const blocked = (preview?.blocked.length ?? 0) > 0 || (preview?.checks.some((c) => c.level === 'error') ?? false);

  async function apply() {
    if (!state) return;
    const out = await run('Apply', () => gatewayApi.apply(state, changes, note || undefined), state.managed === false ? 'Gateway config adopted and applied — rolling out' : 'Gateway change applied — rolling out');
    if (out) {
      setStarted(true);
      void qc.invalidateQueries({ queryKey: gatewayKeys.rollout });
      void qc.invalidateQueries({ queryKey: gatewayKeys.state });
    }
  }
  async function rollback() {
    const out = await run('Rollback', () => gatewayApi.rollback(note || undefined), 'Rolling back to the previous config');
    if (out) void qc.invalidateQueries({ queryKey: gatewayKeys.rollout });
  }

  if (started) {
    return (
      <div className="stack gap-12">
        <h3 className="m-0 text-md">Rolling restart</h3>
        {rollout.data ? <RolloutView rollout={rollout.data} onRollback={rollback} busy={busy === 'Rollback'} canRollback={canApply} />
          : rollout.error ? <Callout tone="info" icon={I.clock}>{notAvailable(rollout.error) ? 'The rollout is not observable on this server yet. The change was accepted.' : describeSiteError(rollout.error)}</Callout>
          : <CheckList lines={[{ level: 'pending', text: 'Waiting for the rollout to start…' }]} />}
        <div className="row justify-end"><Button onClick={onDone}>Close</Button></div>
      </div>
    );
  }

  return (
    <div className="stack gap-12">
      <h3 className="m-0 text-md">Review the gateway change</h3>
      {production && <Callout tone="danger" icon={I.alert} title="PRODUCTION">The change reaches every site on this gateway. A note is required.</Callout>}
      {state?.managed === false && <Callout tone="info" icon={I.info} title="First change from kuma">The live gateway config is not managed yet ({state.source ?? 'chart'}). Applying adopts it as it is, plus this change.</Callout>}
      {error && <Callout tone="warning" icon={I.alert}>{error}</Callout>}
      {!preview && !error && <CheckList lines={[{ level: 'pending', text: 'Checking the change against the gateway and every site…' }]} />}
      {preview && (
        <>
          <div className="row gap-8 items-center wrap"><RiskBadge level={preview.risk.level} /><span className="small">{preview.risk.flags.map((f) => f.message).join('; ') || 'No flags.'}</span></div>
          {preview.blocked.map((b) => (
            <Callout key={`${b.kind}/${b.name}`} tone="danger" icon={I.lock} title={`${b.name} is still in use`}>
              {b.message ?? 'Move the gates that use it to another method first'}{b.sites.length ? <>: {b.sites.map((s, i) => <span key={s}>{i > 0 && ', '}<a href={`#/sites/${encodeURIComponent(s)}/gates`}>{s}</a></span>)}</> : null}.
            </Callout>
          ))}
          <CheckList lines={preview.checks.map((c) => ({ level: c.level === 'error' ? 'error' : 'warn', text: c.message }))} />
          <ul className="site-diff-items" aria-label="What changes">
            {preview.changes.flatMap((c) => (c.fields.length ? c.fields : [{ path: '(enabled)', before: undefined, after: undefined }]).map((f, i) => (
              <li key={`${c.kind}/${c.name}/${f.path}/${i}`} className="site-diff-chg"><span className="mono small">{c.name} · {f.path}: {JSON.stringify(f.before) ?? '—'} → {JSON.stringify(f.after) ?? '—'}</span></li>
            )))}
          </ul>
          <p className="small m-0">{preview.restart.message ?? `Restarts: ${preview.restart.components.join(', ') || 'nothing'}`}{preview.restart.expectedSec ? ` · about ${preview.restart.expectedSec} s, one pod at a time` : ''}. Requests keep being served during a rolling restart.</p>
        </>
      )}
      <Field label="Note for history" required={production}><Textarea rows={2} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="row justify-end gap-8">
        <Button onClick={onDone}>Cancel</Button>
        {canApply && (
          <Button variant={production ? 'danger' : 'primary'} disabled={!preview || blocked || (production && !note.trim()) || !state} loading={busy === 'Apply'} onClick={() => void apply()}>
            {production ? 'Apply to production' : 'Apply and restart'}
          </Button>
        )}
      </div>
    </div>
  );
}
