import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession } from '../api/hooks';
import { api, type BackupList } from '../api/client';
import { I, Badge, Button, Card, CodeView, ConfirmDialog, EmptyRow, LoadingRows, PageHeader, Table } from '../components/ui';
import { ExportBundleModal } from '../components/ExportBundleModal';
import { PRIVILEGED_MUTATION, permits } from '../policy/model';

// Deploy-time flag (envsubst → window.__BACKUP_ENABLED__). A stable module
// constant — the conditional render in BackupPage never flips at runtime, so
// BackupEnabled's hooks stay unconditional.
const backupEnabled = (window as any).__BACKUP_ENABLED__ === 'true';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDate(s: string | null): string {
  return s ? new Date(s).toLocaleString() : '—';
}

export function BackupPage() {
  return backupEnabled ? <BackupEnabled /> : <BackupDisabled />;
}

// ─── Disabled: setup requirement ──────────────────────────────────────────────
function BackupDisabled() {
  return (
    <>
      <PageHeader title="Backup" sub="Snapshot, restore and disaster-recovery for your RBAC configuration." />
      <Card pad="md" className="maxw-lg">
        <div className="row gap-8 mb-8">
          <span className="icon-lg text-warning">{I.alert}</span>
          <h3 className="m-0">Backup isn't set up on this deployment</h3>
        </div>
        <p className="small muted leading-relaxed">
          Scheduled S3 backups (and in-app restore + first-init recovery) are off. To enable, set in the auth Helm values:
        </p>
        <CodeView title="values.yaml" language="yaml" code={`backup:
  enabled: true
  s3:
    bucket: your-auth-backup-bucket
    region: eu-west-3
  serviceAccount:
    annotations:
      eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/auth-backup-role
jinbe:
  serviceAccount:
    annotations:
      eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/auth-backup-role`} />
        <p className="small muted leading-relaxed">
          The IAM role needs <span className="mono">s3:PutObject</span> (backup), plus{' '}
          <span className="mono">s3:GetObject</span> + <span className="mono">s3:ListBucket</span> for in-app restore.
          Manual export/import is still available under <b>Settings</b>.
        </p>
      </Card>
    </>
  );
}

// ─── Enabled: full backup UX ──────────────────────────────────────────────────
function BackupEnabled() {
  const { pushToast, refetch } = useApp();
  const { data: session } = useSession();
  // The permission the restore checks. A role name this model does not define greyed it for all.
  const mayRestore = permits(session?.permissions, PRIVILEGED_MUTATION);

  const [list, setList] = useState<BackupList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ bundle: unknown; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await api.listBackups());
    } catch (e: any) {
      pushToast(e.message || 'Could not list backups', { err: true });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);
  useEffect(() => { load(); }, [load]);

  async function doBackupNow() {
    setBusy(true);
    try {
      const r = await api.backupNow();
      pushToast('Backup created', { sub: r.key });
      await load();
    } catch (e: any) {
      pushToast(e.message || 'Backup failed', { err: true });
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(key: string) {
    setBusy(true);
    try {
      const r = await api.restoreBackup(key);
      const c = r.imported.rbac;
      pushToast('Restored from backup', { sub: `${c.services} services · ${c.groups} groups · ${c.roles} roles` });
      refetch();
    } catch (e: any) {
      pushToast(e.message || 'Restore failed', { err: true });
    } finally {
      setBusy(false);
      setConfirmKey(null);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name;
    e.target.value = '';
    try {
      const bundle: any = JSON.parse(await file.text());
      if (!bundle?.version || !bundle?.rbac) {
        pushToast('Invalid bundle file', { err: true, sub: 'Missing version or rbac fields' });
        return;
      }
      setPendingFile({ bundle, name });
    } catch (err: any) {
      pushToast(err.message || 'Could not read bundle file', { err: true, sub: 'Not valid JSON?' });
    }
  }
  async function confirmFileRestore() {
    if (!pendingFile) return;
    setBusy(true);
    try {
      const r = await api.importBundle(pendingFile.bundle);
      const c = r.imported.rbac;
      pushToast('Restored from file', { sub: `${c.services} services · ${c.groups} groups` });
      refetch();
      await load();
    } catch (e: any) {
      pushToast(e.message || 'Restore failed', { err: true });
    } finally {
      setBusy(false);
      setPendingFile(null);
    }
  }

  const backups = list?.backups ?? [];
  const latest = backups[0];
  const gate = mayRestore ? undefined : 'Needs admin.membership:write';

  return (
    <>
      <PageHeader title="Backup" sub="Snapshot, restore and disaster-recovery for your RBAC configuration." />

      {/* status + actions */}
      <Card pad="md" className="mb-12">
        <div className="row wrap gap-8 mb-12">
          <Badge tone="info">S3 backup on</Badge>
          {list?.bucket && <Badge>{list.bucket}/{list.prefix}</Badge>}
          {list?.region && <Badge>{list.region}</Badge>}
          <span className="small muted ml-auto">
            {latest ? `Latest: ${fmtDate(latest.lastModified)}` : 'No backups yet'}
          </span>
        </div>
        <div className="row wrap gap-8">
          <Button variant="primary" icon={I.sync} onClick={doBackupNow} disabled={busy || !mayRestore} title={gate}>
            Back up now
          </Button>
          <Button onClick={() => latest && setConfirmKey(latest.key)} disabled={busy || !latest || !mayRestore} title={gate}>
            Restore latest
          </Button>
          <Button icon={I.download} onClick={() => setExportOpen(true)} disabled={busy || !mayRestore} title={gate}>
            Export…
          </Button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={onFile} />
          <Button icon={I.upload} onClick={() => fileRef.current?.click()} disabled={busy || !mayRestore} title={gate}>
            Restore from file
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={load} disabled={loading}>Refresh</Button>
        </div>
        {!mayRestore && <p className="small muted mt-12">Restore and export need admin.membership:write.</p>}
      </Card>

      {/* snapshots */}
      <Card title="Snapshots" pad="none">
        <Table>
          <thead><tr><th>When</th><th>Size</th><th className="mono">Key</th><th /></tr></thead>
          <tbody>
            {loading && <LoadingRows rows={4} cols={4} />}
            {!loading && backups.length === 0 && <EmptyRow colSpan={4}>No backups yet — the scheduled job runs daily, or use “Back up now”.</EmptyRow>}
            {backups.map((b, i) => (
              <tr key={b.key}>
                <td>{fmtDate(b.lastModified)} {i === 0 && <Badge tone="info">latest</Badge>}</td>
                <td className="mono">{fmtBytes(b.size)}</td>
                <td className="mono small break-all">{b.key}</td>
                <td className="shrink">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmKey(b.key)} disabled={busy || !mayRestore} title={gate}>Restore</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* snapshot restore confirm */}
      <ConfirmDialog
        open={!!confirmKey}
        title="Restore this backup?"
        danger
        confirmLabel="Restore (full replace)"
        blastRadius={<>This replaces ALL current RBAC config (services, groups, roles, route maps, Oathkeeper rules) with the snapshot, then refreshes OPA. Current config not in the snapshot is removed.</>}
        body={<>Restoring <span className="mono">{confirmKey}</span>.</>}
        requireText="RESTORE"
        busy={busy}
        onConfirm={() => confirmKey && doRestore(confirmKey)}
        onCancel={() => setConfirmKey(null)}
      />

      {/* file restore confirm */}
      <ConfirmDialog
        open={!!pendingFile}
        title="Restore from this file?"
        danger
        confirmLabel="Restore (full replace)"
        blastRadius={<>This replaces ALL current RBAC config with the uploaded bundle and refreshes OPA.</>}
        body={<>Uploaded <span className="mono">{pendingFile?.name}</span>.</>}
        requireText="RESTORE"
        busy={busy}
        onConfirm={confirmFileRestore}
        onCancel={() => setPendingFile(null)}
      />

      {/* export select-all modal (shared with Settings) */}
      <ExportBundleModal open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}
