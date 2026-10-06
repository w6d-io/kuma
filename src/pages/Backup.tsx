import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import { useImportHistory, useRollbackImport, useSession } from '../api/hooks';
import { api, type BackupList, type BundleImportResult } from '../api/client';
import { stepUpOnRefusal } from '../lib/resume';
import { I, Badge, Button, Card, ConfirmDialog, EmptyRow, LoadingRows, PageHeader, SkeletonPanel, Table } from '../components/ui';
import { holds } from '../policy/model';
import { RestoreFileDialog } from './backup/RestoreFileDialog';
import { availableSections, readSnapshot, type PendingFile, type SectionId } from './backup/snapshot';
import { BackupSetup, RestoreResult, SnapshotContents } from './backup/parts';

// Deploy-time flag (envsubst → window.__BACKUP_ENABLED__): only a fallback for an older jinbe whose
// backups call fails. jinbe's own `enabled` decides — on auth-dev the flag said off while jinbe had a
// nightly backup, and the page said "Backup isn't set up".
const deployFlag = () => (window as any).__BACKUP_ENABLED__ === 'true';

const TITLE = 'Backup & restore';
const SUB = 'One snapshot of what people configured: download it, keep it in S3, restore it, roll an import back.';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDate(s: string | null): string {
  return s ? new Date(s).toLocaleString() : '—';
}

/**
 * The one place for backups: the snapshot as a file (works with S3 off), S3 snapshots when the chart
 * turned them on, and the import history. Reading (download, list) needs policy.bundle:read; anything
 * that writes (back up now, restore, roll back) policy.bundle:write and a recent second factor.
 */
export function BackupPage() {
  const { pushToast, refetch } = useApp();
  const { data: session } = useSession();
  const mayRead = holds(session, 'policy.bundle:read');
  const mayWrite = holds(session, 'policy.bundle:write');
  const writeGate = mayWrite ? undefined : 'Needs policy.bundle:write';

  const [list, setList] = useState<BackupList | null>(null);
  // 'ok': jinbe answered; 'failed': it did not, the deploy flag decides.
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [loading, setLoading] = useState(true);
  const { data: history, refetch: refetchHistory } = useImportHistory({ enabled: mayRead });
  const rollbackImport = useRollbackImport();

  const [busy, setBusy] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [confirmRollback, setConfirmRollback] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [sections, setSections] = useState<SectionId[]>([]);
  const [last, setLast] = useState<{ title: string; result: BundleImportResult } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await api.listBackups());
      setState('ok');
    } catch (e: any) {
      setState((s) => (s === 'ok' ? s : 'failed'));
      if (deployFlag()) pushToast(e.message || 'Could not list backups', { err: true });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);
  useEffect(() => { load(); }, [load]);

  const s3 = state === 'ok' ? !!list?.enabled : deployFlag();
  const backups = list?.backups ?? [];
  const latest = backups[0];

  /** One way every restore ends: the result shown, the history and the console refreshed. */
  function restored(title: string, result: BundleImportResult) {
    setLast({ title, result });
    const failed = result.sites?.failed.length ?? 0;
    pushToast(title, { err: failed > 0, sub: failed ? `${failed} site${failed === 1 ? '' : 's'} could not be published again` : `${result.rbac.services} services · ${result.rbac.groups} groups` });
    refetch();
    refetchHistory();
  }

  async function run(what: () => Promise<void>, redo: string, failure: string) {
    setBusy(true);
    try {
      await what();
    } catch (e: any) {
      if (stepUpOnRefusal(e, pushToast, { redo })) return;
      pushToast(e.message || failure, { err: true });
    } finally {
      setBusy(false);
    }
  }

  const download = (key?: string) => run(
    async () => { await (key ? api.downloadBackup(key) : api.downloadSnapshot()); pushToast('Snapshot downloaded', { sub: key ?? 'the current configuration' }); },
    'Download again.', 'Download failed',
  );
  const backupNow = () => run(
    async () => { const r = await api.backupNow(); pushToast('Backup created', { sub: r.key }); await load(); },
    'Press Back up now again: no backup was taken before the check.', 'Backup failed',
  );
  const restoreKey = (key: string) => run(
    async () => { setConfirmKey(null); restored(`Restored from ${key}`, (await api.restoreBackup(key)).imported); },
    `Restore ${key} again: nothing was restored before the check.`, 'Restore failed',
  );
  const restoreFile = () => pendingFile && run(
    async () => {
      const full = sections.length === availableSections(pendingFile).length;
      const r = await api.importBundle(pendingFile.bundle, full ? undefined : sections);
      setPendingFile(null);
      restored(full ? `Restored from ${pendingFile.name}` : `${sections.length} section${sections.length === 1 ? '' : 's'} imported from ${pendingFile.name}`, r.imported);
    },
    'Restore from the file again: nothing was restored before the check.', 'Restore failed',
  );
  function rollback(id: string) {
    setConfirmRollback(null);
    rollbackImport.mutate(id, {
      onSuccess: (r) => restored('Rolled back', r.imported),
      onError: (e: Error) => {
        if (stepUpOnRefusal(e, pushToast, { redo: 'Roll back again: nothing was changed before the check.' })) return;
        pushToast(e.message || 'Rollback failed', { err: true });
      },
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const read = readSnapshot(await file.text(), file.name);
    if (typeof read === 'string') { pushToast('Not a snapshot file', { err: true, sub: read }); return; }
    setPendingFile(read);
    setSections(availableSections(read).map((s) => s.id));
  }

  if (state === 'loading') return <><PageHeader title={TITLE} sub={SUB} /><SkeletonPanel lines={4} /></>;

  return (
    <>
      <PageHeader title={TITLE} sub={SUB} />
      <div className="stack gap-16">
        <Card pad="md">
          <div className="row wrap gap-8 mb-12">
            {s3 ? <Badge tone="info">S3 backup on</Badge> : <Badge>S3 backup off</Badge>}
            {s3 && list?.bucket && <Badge title="Bucket">s3://{list.bucket}</Badge>}
            {s3 && list?.prefix && <Badge title="Prefix">prefix {list.prefix}</Badge>}
            {s3 && list?.region && <Badge title="Region">{list.region}</Badge>}
            {s3 && <span className="small muted ml-auto">{latest ? `Latest: ${fmtDate(latest.lastModified)}` : 'No backups yet'}</span>}
          </div>
          <div className="row wrap gap-8">
            <Button icon={I.download} onClick={() => download()} disabled={busy}>Download snapshot</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
            <Button icon={I.upload} onClick={() => fileRef.current?.click()} disabled={busy || !mayWrite} title={writeGate}>Restore from file</Button>
            {s3 && <Button variant="primary" icon={I.sync} onClick={backupNow} disabled={busy || !mayWrite} title={writeGate}>Back up now</Button>}
            {s3 && <Button variant="ghost" size="sm" className="ml-auto" onClick={load} disabled={loading}>Refresh</Button>}
          </div>
          {!mayWrite && <p className="small muted mt-12 mb-0">You can download snapshots. Backing up, restoring and rolling back need policy.bundle:write.</p>}
        </Card>

        {last && <RestoreResult title={last.title} result={last.result} onDismiss={() => setLast(null)} />}

        {s3 ? (
          <Card title="Snapshots in S3" pad="none">
            <Table>
              <thead><tr><th>When</th><th className="num">Size</th><th className="mono">Key</th><th className="actions" /></tr></thead>
              <tbody>
                {loading && <LoadingRows rows={4} cols={4} />}
                {!loading && backups.length === 0 && <EmptyRow colSpan={4}>No backups yet — jinbe backs up daily, or use “Back up now”.</EmptyRow>}
                {!loading && backups.map((b, i) => (
                  <tr key={b.key}>
                    <td>{fmtDate(b.lastModified)} {i === 0 && <Badge tone="info">latest</Badge>}</td>
                    <td className="num mono">{fmtBytes(b.size)}</td>
                    <td className="mono small break-all">{b.key}</td>
                    <td className="actions nowrap">
                      <Button variant="ghost" size="sm" icon={I.download} onClick={() => download(b.key)} disabled={busy}>Download</Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmKey(b.key)} disabled={busy || !mayWrite} title={writeGate}>Restore</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : <BackupSetup />}

        <Card title="Import history" sub="A snapshot is taken before every restore, import or rollback (the last 10). Rolling back restores it in full, and keeps a snapshot of what it replaces." pad="none">
          <Table className="compact">
            <thead><tr><th>When</th><th>Taken before</th><th>By</th><th>Contents</th><th className="actions" /></tr></thead>
            <tbody>
              {(history?.length ?? 0) === 0 && <EmptyRow colSpan={5}>Nothing restored or imported yet.</EmptyRow>}
              {history?.map((h) => (
                <tr key={h.id}>
                  <td className="nowrap">{fmtDate(h.takenAt)}</td>
                  <td><Badge>{h.reason.replace('pre-', '')}</Badge></td>
                  <td className="mono">{h.actor || 'jinbe'}</td>
                  <td className="small muted">
                    {h.counts.services} services · {h.counts.groups} groups · {h.counts.roles} roles
                    {h.counts.sites !== undefined && <> · {h.counts.sites} sites</>}
                    {h.counts.organizations !== undefined && <> · {h.counts.organizations} organizations</>}
                  </td>
                  <td className="actions">
                    <Button variant="ghost" size="sm" disabled={busy || rollbackImport.isPending || !mayWrite} title={writeGate} onClick={() => setConfirmRollback(h.id)}>Roll back</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <SnapshotContents />
      </div>

      <ConfirmDialog
        open={!!confirmKey}
        title="Restore this backup?"
        danger
        confirmLabel="Restore (full)"
        blastRadius={<>Each section of the snapshot replaces what is there now — the access model, people’s direct grants and settings; what the snapshot lacks in them is removed. Organizations in the snapshot are restored exactly; organizations created since are left untouched, never deleted. Sites that exist now are kept; sites gone since are written back. Every applied site is then published again. Accounts and gateway rules are not touched.</>}
        body={<>Restoring <span className="mono">{confirmKey}</span>. A snapshot of the current state is kept in the import history.</>}
        requireText="RESTORE"
        busy={busy}
        onConfirm={() => confirmKey && restoreKey(confirmKey)}
        onCancel={() => setConfirmKey(null)}
      />

      <ConfirmDialog
        open={!!confirmRollback}
        title="Roll back to this snapshot?"
        danger
        confirmLabel="Roll back"
        body={<>The snapshot is restored in full, as a backup would be. A snapshot of the current state is kept, so you can roll forward again.</>}
        onCancel={() => setConfirmRollback(null)}
        onConfirm={() => confirmRollback && rollback(confirmRollback)}
      />

      <RestoreFileDialog
        file={pendingFile}
        selected={sections}
        onSelect={setSections}
        busy={busy}
        onConfirm={restoreFile}
        onCancel={() => setPendingFile(null)}
      />
    </>
  );
}
