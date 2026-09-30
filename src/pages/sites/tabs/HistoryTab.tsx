import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, ConfirmDialog, DiffView, EmptyState, Field, I, Input, Segmented, Select, SkeletonRows, Table, Th } from '../../../components/ui';
import { sitesApi, useVersions, useInvalidateSite } from '../../../api/sites';
import type { Finding, Site } from '../../../lib/sites/types';
import { FindingsDialog } from '../Findings';
import type { SiteEditor } from '../useSiteEditor';
import type { Go } from '../SiteDetail';
import { QueryError } from '../parts';
import { timeAgo } from '../../../lib/sites/format';
import { useSiteAction } from '../useAction';
import { useResume } from '../../../lib/resume';

/**
 * History (site-ux.md §10.1): every saved version, who and why, which one is live; compare any two
 * (`?v=8&compare=6`) and roll back to any — a rollback is a new version with the old content,
 * applied through the same path as any change. A version newer than the live one is not a roll
 * back: the latest saved one is published as it is, an older unpublished one the rollback way.
 */

/** `acknowledge`: the finding codes accepted in the findings dialog, kept across the step-up. */
type Pick = { to: number; note: string; live: number | null; acknowledge?: string[] };

const LABELS: Record<string, string> = {
  displayName: 'Display name', address: 'Address', upstream: 'Runs at', exposure: 'Exposure', gates: 'Gates', routes: 'Routes',
  roles: 'Roles', groups: 'Groups', orgs: 'Organizations', login: 'Login', state: 'State', description: 'Description',
};

function sections(s: Site | undefined): Record<string, unknown> {
  if (!s) return {};
  const { name: _n, ...rest } = s;
  void _n;
  return rest;
}

export function HistoryTab({ ed, readOnly, query, go }: { ed: SiteEditor; readOnly: boolean; query: Record<string, string>; go: Go }) {
  const versions = useVersions(ed.name);
  const invalidate = useInvalidateSite();
  const { run, busy } = useSiteAction();
  const [filter, setFilter] = useState<'all' | 'rollback'>('all');
  const [target, setTarget] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [held, setHeld] = useState<{ findings: Finding[]; pick: Pick } | null>(null);
  const list = [...(versions.data ?? [])].reverse();
  const live = ed.detail.data?.applied?.version;
  const latest = ed.detail.data?.version;
  // Newer than what is live (or nothing is live yet): publishing it, not rolling back.
  const ahead = (x: number) => live == null || x > live;
  const direct = target !== null && target === latest && ahead(target);
  const v = Number(query.v) || undefined;
  const compare = Number(query.compare) || (v && v > 1 ? v - 1 : undefined);
  const a = useQuery({ queryKey: ['sites', 'version', ed.name, v], queryFn: () => sitesApi.version(ed.name, v!), enabled: !!v });
  const b = useQuery({ queryKey: ['sites', 'version', ed.name, compare], queryFn: () => sitesApi.version(ed.name, compare!), enabled: !!compare && compare !== v });

  async function restore(pick: Pick) {
    const { to, note: why, acknowledge } = pick;
    const publishing = to === latest && ahead(to);
    const after = { resume: `site-history:${ed.name}`, data: { to, note: why, live: live ?? null, acknowledge } satisfies Pick };
    const out = publishing
      ? await run('Publish', () => sitesApi.apply(ed.name, to, acknowledge), `v${to} is being published`, after, (findings) => setHeld({ findings, pick }))
      : await run(ahead(to) ? 'Publish' : 'Rollback', () => sitesApi.rollback(ed.name, to, why || undefined), ahead(to) ? `v${to}’s content is being published as a new version` : `Rolled back: v${to}’s content is live as a new version`, after);
    setTarget(null);
    if (out) { ed.reset(); invalidate(ed.name); go('status'); }
  }

  // Back from the step-up: the same publish or rollback, once, if what is live has not moved since.
  useResume<Pick>(readOnly ? null : `site-history:${ed.name}`, !!ed.detail.data, (p) => {
    if ((live ?? null) === p.live) void restore(p);
  });

  if (versions.error) return <QueryError error={versions.error} what="version history" />;
  if (!versions.isLoading && list.length === 0) {
    return <EmptyState icon={I.clock} title={ed.neverSaved ? 'Not applied yet' : 'No versions yet'}>This becomes version 1 when it goes live. Every change you apply shows up here and can be undone.</EmptyState>;
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(versions.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${ed.name}-history.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="stack gap-16">
      <Card pad="none" title={`History · ${ed.current?.displayName ?? ed.name}`} actions={<>
        <Segmented label="Filter history" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'rollback', label: 'Rollbacks' }]} />
        <Button size="sm" variant="ghost" icon={I.download} onClick={exportJson}>Export JSON</Button>
      </>}>
        <Table aria-label="Versions">
          <thead><tr><Th>Version</Th><Th>When</Th><Th>Who</Th><Th>Note</Th><Th /></tr></thead>
          <tbody>
            {versions.isLoading && <SkeletonRows cols={5} rows={3} />}
            {list.filter((x) => filter === 'all' || x.kind === 'rollback').map((x) => (
              <tr key={x.v}>
                <td className="tabular"><span className="mono">v{x.v}</span> {x.v === live && <Badge tone="success" mono={false} icon={I.dot}>live</Badge>} {x.kind === 'rollback' && <Badge tone="info" mono={false}>rollback</Badge>}</td>
                <td className="small" title={x.at}>{timeAgo(x.at)}</td>
                <td className="small">{x.by}</td>
                <td className="small">{x.note ?? ''}</td>
                <td className="row gap-4 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => go('history', { v: String(x.v), compare: x.v > 1 ? String(x.v - 1) : undefined })}>Diff</Button>
                  {!readOnly && x.v !== live && (ahead(x.v)
                    ? <Button size="sm" onClick={() => { setTarget(x.v); setNote(x.v === latest ? '' : `publish the content of version ${x.v}`); }}>Publish this version</Button>
                    : <Button size="sm" onClick={() => { setTarget(x.v); setNote(`rollback to version ${x.v}`); }}>Roll back to this</Button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {v && (
        <Card title={`v${v} compared with ${compare && compare !== v ? `v${compare}` : 'nothing (first version)'}`} actions={
          <Field label="Compare with" inline>
            <Select size="sm" value={String(compare ?? '')} onChange={(e) => go('history', { v: String(v), compare: e.target.value || undefined })}>
              {list.filter((x) => x.v !== v).map((x) => <option key={x.v} value={x.v}>v{x.v}</option>)}
            </Select>
          </Field>
        }>
          {a.error ? <QueryError error={a.error} what="that version" /> : (
            <DiffView before={sections(compare && compare !== v ? b.data?.site : undefined)} after={sections(a.data?.site)} labels={LABELS} />
          )}
        </Card>
      )}

      <ConfirmDialog
        open={target !== null}
        title={target !== null && ahead(target) ? `Publish v${target}?` : `Roll back to v${target}?`}
        body={<>
          <p className="mt-0">
            {direct
              ? <>This makes v{target} live{live != null ? <> in place of v{live}</> : null}, through the same checks and timeline as any change. Needs a recent second factor.</>
              : target !== null && ahead(target)
                ? <>v{target} was saved but never published. This saves its content as a new version and publishes it, through the same checks and timeline as any change. Needs a recent second factor.</>
                : <>This saves the content of v{target} as a new version and applies it, through the same checks and timeline as any change. Needs a recent second factor.</>}
          </p>
          {!direct && <Field label="Note for history"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} /></Field>}
        </>}
        confirmLabel={target !== null && ahead(target) ? 'Publish' : 'Roll back'}
        danger={!(target !== null && ahead(target))}
        busy={busy === 'Rollback' || busy === 'Publish'}
        onCancel={() => setTarget(null)}
        onConfirm={() => restore({ to: target!, note, live: live ?? null })}
      />
      <FindingsDialog
        findings={held?.findings ?? null}
        what={held ? `v${held.pick.to}` : ''}
        onClose={() => setHeld(null)}
        onRetry={async (acknowledge) => { const pick = held!.pick; setHeld(null); await restore({ ...pick, acknowledge }); }}
      />
    </div>
  );
}
