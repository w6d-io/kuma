import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Callout, Card, Checkbox, CodeView, EmptyState, Field, I, Input, PageHeader, SkeletonPanel, Stepper, Table, Th } from '../../components/ui';
import { sitesApi, notAvailable } from '../../api/sites';
import { goSites, sitesHref, MIGRATION_STEPS, type MigrationStep } from '../../lib/sites/route';
import type { MigrationDiff, MigrationGroup, MigrationState, ParityReport } from '../../lib/sites/types';
import { QueryError } from './parts';
import { useSitePerms } from './usePerms';
import { useSiteAction } from './useAction';

/**
 * "Migrate existing rules" (site-ux.md §20.3), super_admin, once per environment: preview the 1:1
 * conversion → parity check → dual run → cut over → done (rollback for 7 days). Every step is the
 * server's; this screen shows what it says and refuses to go on while it reports a regression.
 */

const STEP_OF: Record<MigrationState, MigrationStep> = {
  'not-started': 'preview', previewed: 'parity', 'dual-run': 'dualrun', 'cutting-over': 'cutover', 'cut-over': 'done', done: 'done', 'rolled-back': 'preview',
};

function DiffTable({ rows, regression }: { rows: MigrationDiff[]; regression?: (d: MigrationDiff) => boolean }) {
  if (rows.length === 0) return null;
  return (
    <Table aria-label="Differences">
      <thead><tr><Th>Method</Th><Th>URL</Th><Th>Before</Th><Th>After</Th></tr></thead>
      <tbody>
        {rows.slice(0, 50).map((d, i) => (
          <tr key={i}>
            <td className="mono small">{d.method}</td><td className="mono small break-all">{d.url}</td>
            <td className="small">{d.before.verdict}{d.before.rule ? ` (${d.before.rule})` : ''}</td>
            <td className="small">{d.after.verdict}{d.after.rule ? ` (${d.after.rule})` : ''}{(regression ? regression(d) : !d.fix) ? <Badge tone="danger" mono={false}>regression</Badge> : <Badge tone="info" mono={false}>fix</Badge>}{d.cause ? <span className="muted"> · {d.cause}</span> : null}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

const warnText = (w: NonNullable<MigrationGroup['warnings']>[number]) => (typeof w === 'string' ? w : w.message);
const blocks = (g: MigrationGroup) => g.kind === 'unassigned' || (g.warnings ?? []).some((w) => typeof w !== 'string' && w.level === 'block');

function GroupRow({ g, fixOn, onFix, onDrop }: { g: MigrationGroup; fixOn: boolean; onFix: (on: boolean) => void; onDrop: (ruleId: string) => void }) {
  return (
    <li className="site-migration-group">
      <div className="row gap-8 items-center wrap">
        {g.kind === 'system' && <span aria-hidden="true">{I.lock}</span>}
        <span className="fw-medium">{g.proposedSite}</span>
        <Badge tone={g.kind === 'unassigned' ? 'danger' : g.kind === 'system' ? 'accent' : 'neutral'} mono={false}>{g.kind === 'unassigned' ? 'needs a decision' : g.kind}</Badge>
        <span className="mono small muted">{g.legacyRuleIds.join(', ')}</span>
      </div>
      {g.changes?.map((c, i) => <div key={i} className="small mono">~ {c.path}: {JSON.stringify(c.before)} → {JSON.stringify(c.after)}</div>)}
      {g.warnings?.map((w, i) => (
        <div key={i} className={typeof w !== 'string' && w.level === 'block' ? 'small text-danger' : 'small text-warning'}>
          {warnText(w)}
          {typeof w !== 'string' && w.ruleId && <Button size="sm" variant="ghost" onClick={() => onDrop(w.ruleId!)}>Drop {w.ruleId}</Button>}
        </div>
      ))}
      {g.kind === 'unassigned' && g.legacyRuleIds.map((id) => <Button key={id} size="sm" variant="ghost" onClick={() => onDrop(id)}>Drop {id}</Button>)}
      {g.kind === 'site' && <Checkbox checked={fixOn} onChange={onFix} label="Also apply recommended fixes (pin the site in the decision request)" hint="Listed as behaviour changes in parity; the default is a 1:1 conversion." />}
    </li>
  );
}

export function MigrationPage({ step }: { step: MigrationStep | null }) {
  const perms = useSitePerms();
  const qc = useQueryClient();
  const { run, busy } = useSiteAction();
  const status = useQuery({ queryKey: ['sites', 'migration'], queryFn: () => sitesApi.migration(), retry: false, refetchInterval: (q) => (q.state.data?.state === 'dual-run' ? 5000 : false) });
  const dual = useQuery({ queryKey: ['sites', 'migration', 'dualrun'], queryFn: () => sitesApi.migrationDualRunStatus(), retry: false, enabled: status.data?.state === 'dual-run', refetchInterval: 5000 });
  const [plan, setPlan] = useState<MigrationGroup[] | null>(null);
  const [fixes, setFixes] = useState<Record<string, string[]>>({});
  const [decisions, setDecisions] = useState<Record<string, 'drop'>>({});
  const [parity, setParity] = useState<ParityReport | null>(null);
  const [told, setTold] = useState(false);
  const [note, setNote] = useState('Migration to Sites');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['sites', 'migration'] });

  const header = (
    <PageHeader eyebrow={<Button variant="ghost" size="sm" icon={I.caretLeft} onClick={() => goSites(sitesHref({ view: 'list' }))}>Sites</Button>} title="Migrate existing rules" sub="Move the gateway's legacy rules to sites — preview first; nothing changes until you cut over." />
  );
  if (!perms.canApply) return <div className="page-enter">{header}<Callout tone="info" icon={I.lock}>The migration is run by a super admin. Sites are read-only until it is finished.</Callout></div>;
  if (status.isLoading) return <div className="page-enter">{header}<SkeletonPanel lines={5} /></div>;
  if (status.error) {
    return (
      <div className="page-enter">{header}
        {notAvailable(status.error)
          ? <EmptyState icon={I.clock} title="The migration is not available on this server yet">When it is: 1 Preview (1:1 conversion, fixes opt-in) · 2 Parity (every probe on both rule sets; any regression blocks) · 3 Dual run (converted rules beside the live ones) · 4 Cut over (needs a second factor; rollback for 7 days) · 5 Done.</EmptyState>
          : <QueryError error={status.error} what="the migration" />}
      </div>
    );
  }
  const m = status.data!;
  const current = step ?? STEP_OF[m.state];
  const groups = plan ?? m.groups;
  const unassigned = groups.filter(blocks).length;
  const report = parity ?? m.parity ?? null;
  const regressionRows = report ? (report.regressions ?? report.differs.filter((d) => !d.fix)) : [];
  const regressions = regressionRows.length;
  const isRegression = (d: MigrationDiff) => regressionRows.includes(d) || (!report?.regressions && !d.fix);
  const preview = async (f = fixes, d = decisions) => { const out = await run('Preview', () => sitesApi.migrationPreview({ fixes: f, decisions: d })); if (out) { setPlan(out.groups); refresh(); } };
  const go = (s: MigrationStep) => goSites(sitesHref({ view: 'migrate', step: s }));

  return (
    <div className="page-enter">
      {header}
      <Stepper className="mb-16" current={current} onStep={(id) => go(id as MigrationStep)} steps={MIGRATION_STEPS.map((id, i) => ({ id, label: `${i + 1} ${{ preview: 'Preview', parity: 'Parity', dualrun: 'Dual run', cutover: 'Cut over', done: 'Done' }[id]}` }))} />

      {current === 'preview' && (
        <Card title={`${m.legacyRules} legacy rules → ${groups.filter((g) => g.kind === 'site').length} sites + ${groups.filter((g) => g.kind === 'system').length} system sites`} sub={unassigned ? `${unassigned} need a decision` : 'Default: convert 1:1 (same patterns, same handlers)'} actions={<Button size="sm" loading={busy === 'Preview'} onClick={() => void preview()}>{groups.length ? 'Preview again' : 'Preview conversion'}</Button>}>
          <ul className="site-list">{groups.map((g) => <GroupRow key={g.proposedSite + g.legacyRuleIds.join()} g={g}
            fixOn={!!fixes[g.proposedSite]?.includes('pin-app')}
            onFix={(on) => { const f = { ...fixes }; if (on) f[g.proposedSite] = ['pin-app']; else delete f[g.proposedSite]; setFixes(f); void preview(f); }}
            onDrop={(id) => { const d = { ...decisions, [id]: 'drop' as const }; setDecisions(d); void preview(fixes, d); }} />)}</ul>
          {groups.length > 0 && <CodeView title="Plan" language="json" maxHeight="sm" code={JSON.stringify(groups, null, 2)} />}
          <div className="row justify-end mt-12"><Button variant="primary" disabled={!groups.length || unassigned > 0} onClick={() => go('parity')}>Continue → Parity check</Button></div>
        </Card>
      )}

      {current === 'parity' && (
        <Card title="Parity check" sub={report ? `${report.total} probes · ${report.identical} identical · ${report.differs.length} differ · ${regressions} regressions · overlaps before ${report.overlapsBefore}, after ${report.overlapsAfter}` : 'Every route example × method × anonymous/session/token, on both rule sets, with the gateway’s own matcher.'}
          actions={<Button size="sm" loading={busy === 'Parity'} onClick={async () => { const out = await run('Parity', () => sitesApi.migrationParity()); if (out) setParity(out); }}>Run parity check</Button>}>
          {report && <DiffTable rows={[...regressionRows, ...report.differs.filter((d) => !regressionRows.includes(d))]} regression={isRegression} />}
          {regressions > 0 && <Callout tone="danger" icon={I.alert} className="mt-8">{regressions} regression{regressions === 1 ? '' : 's'} block the cut-over. Fix them in the preview.</Callout>}
          <div className="row justify-end gap-8 mt-12"><Button onClick={() => go('preview')}>← Back</Button><Button variant="primary" disabled={!report || regressions > 0} onClick={() => go('dualrun')}>Continue → Dual run</Button></div>
        </Card>
      )}

      {current === 'dualrun' && (
        <Card title="Dual run — converted rules beside the live ones" sub={dual.data ? `${dual.data.compared} real requests compared · ${dual.data.same} same · ${dual.data.differs.length} differ · ${dual.data.regressions.length} regressions` : 'Replays real request paths through both rule sets (no bodies, no credentials).'}
          actions={m.state === 'dual-run'
            ? <Button size="sm" loading={busy === 'Stop'} onClick={async () => { await run('Stop', () => sitesApi.migrationDualRun('stop')); refresh(); }}>Stop</Button>
            : <Button size="sm" loading={busy === 'Start'} onClick={async () => { await run('Start', () => sitesApi.migrationDualRun('start')); refresh(); }}>Start dual run</Button>}>
          {dual.data && <DiffTable rows={[...dual.data.regressions, ...dual.data.differs]} regression={(d) => dual.data!.regressions.includes(d)} />}
          {dual.data && <p className="small">Minimum recommended: {Math.round(dual.data.minDurationSec / 60)} min and one business-hours peak.</p>}
          <div className="row justify-end gap-8 mt-12"><Button onClick={() => go('parity')}>← Back</Button><Button variant="primary" disabled={!dual.data?.eligible} onClick={() => go('cutover')}>Continue → Cut over</Button></div>
        </Card>
      )}

      {current === 'cutover' && (
        <Card title="Cut over" sub="Site objects are created → maester writes the rules → every gateway pod loads them → the gateway switches to maester’s rules → the old sync stops. Rollback for 7 days.">
          <Checkbox checked={told} onChange={setTold} label="I’ve told the team" />
          <Field label="Note for the audit log" className="mt-8"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row justify-end gap-8 mt-12">
            <Button onClick={() => go('dualrun')}>Cancel</Button>
            <Button variant="danger" disabled={!told} loading={busy === 'Cut over'} onClick={async () => { const out = await run('Cut over', () => sitesApi.migrationCutover(note), 'Cut over: the gateway now serves the sites'); if (out) { refresh(); go('done'); } }}>Cut over now</Button>
          </div>
        </Card>
      )}

      {current === 'done' && (
        <Card title={m.state === 'done' || m.state === 'cut-over' ? 'Done' : 'Not cut over yet'}>
          {m.state === 'done' || m.state === 'cut-over'
            ? <p className="m-0">All {m.legacyRules} rules now live as sites.{m.rollbackUntil ? ` Rollback available until ${new Date(m.rollbackUntil).toLocaleDateString()}.` : ''}</p>
            : <p className="m-0">Finish the earlier steps first.</p>}
          {(m.state === 'cut-over' || m.state === 'done') && m.rollbackUntil && Date.parse(m.rollbackUntil) > Date.now() && (
            <div className="row justify-end mt-12"><Button variant="danger" loading={busy === 'Rollback'} onClick={async () => { await run('Rollback', () => sitesApi.migrationRollback(), 'The gateway reads the legacy rules again'); refresh(); }}>Roll back the migration</Button></div>
          )}
        </Card>
      )}
    </div>
  );
}
