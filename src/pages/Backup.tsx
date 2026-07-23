import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession } from '../api/hooks';
import { api, type BackupList } from '../api/client';
import { I } from '../components/ui/Icons';
import { Chip, ConfirmDialog } from '../components/ui/Primitives';
import { ExportBundleModal } from '../components/ExportBundleModal';

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
      <div className="page-head">
        <h1>Backup</h1>
        <div className="sub">Snapshot, restore and disaster-recovery for your RBAC configuration.</div>
      </div>
      <div className="panel" style={{ padding: 20, maxWidth: 720 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', color: 'var(--warn)' }}>{I.alert}</span>
          <h3 style={{ margin: 0 }}>Backup isn't set up on this deployment</h3>
        </div>
        <p className="small muted" style={{ lineHeight: 1.6 }}>
          Scheduled S3 backups (and in-app restore + first-init recovery) are off. To enable, set in the auth Helm values:
        </p>
        <pre style={{ background: 'var(--surface-2, #f5f5fa)', border: '1px solid var(--line)', borderRadius: 8, padding: 12, fontSize: 12.5, overflowX: 'auto' }}>{`backup:
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
      eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/auth-backup-role`}</pre>
        <p className="small muted" style={{ lineHeight: 1.6 }}>
          The IAM role needs <span className="mono">s3:PutObject</span> (backup), plus{' '}
          <span className="mono">s3:GetObject</span> + <span className="mono">s3:ListBucket</span> for in-app restore.
          Manual export/import is still available under <b>Settings</b>.
        </p>
      </div>
    </>
  );
}

// ─── Enabled: full backup UX ──────────────────────────────────────────────────
function BackupEnabled() {
  const { pushToast, refetch } = useApp();
  const { data: session } = useSession();
  const isSuperAdmin = (session?.roles || []).includes('super_admin');

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
  const gate = isSuperAdmin ? undefined : 'Requires super-admin';

  return (
    <>
      <div className="page-head">
        <h1>Backup</h1>
        <div className="sub">Snapshot, restore and disaster-recovery for your RBAC configuration.</div>
      </div>

      {/* status + actions */}
      <div className="panel mb-12" style={{ padding: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <Chip tone="info">S3 backup on</Chip>
          {list?.bucket && <Chip>{list.bucket}/{list.prefix}</Chip>}
          {list?.region && <Chip>{list.region}</Chip>}
          <span className="small muted" style={{ marginLeft: 'auto' }}>
            {latest ? `Latest: ${fmtDate(latest.lastModified)}` : 'No backups yet'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={doBackupNow} disabled={busy || !isSuperAdmin} title={gate}>
            <span style={{ width: 13, height: 13, display: 'inline-grid', placeItems: 'center', marginRight: 6 }}>{I.sync}</span>
            Back up now
          </button>
          <button className="btn" onClick={() => latest && setConfirmKey(latest.key)} disabled={busy || !latest || !isSuperAdmin} title={gate}>
            Restore latest
          </button>
          <button className="btn" onClick={() => setExportOpen(true)} disabled={busy || !isSuperAdmin} title={gate}>
            <span style={{ width: 13, height: 13, display: 'inline-grid', placeItems: 'center', marginRight: 6 }}>{I.download}</span>
            Export…
          </button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={onFile} />
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy || !isSuperAdmin} title={gate}>
            <span style={{ width: 13, height: 13, display: 'inline-grid', placeItems: 'center', marginRight: 6 }}>{I.upload}</span>
            Restore from file
          </button>
          <button className="btn ghost sm" onClick={load} disabled={loading} style={{ marginLeft: 'auto' }}>Refresh</button>
        </div>
        {!isSuperAdmin && <p className="small muted" style={{ marginTop: 10 }}>Restore and export require super-admin.</p>}
      </div>

      {/* snapshots */}
      <div className="panel">
        <div className="panel-head"><div><h3>Snapshots</h3></div></div>
        <table className="table">
          <thead><tr><th>When</th><th>Size</th><th className="mono">Key</th><th style={{ width: 90 }}></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4}><span className="small muted">Loading…</span></td></tr>}
            {!loading && backups.length === 0 && <tr><td colSpan={4}><span className="small muted">No backups yet — the scheduled job runs daily, or use “Back up now”.</span></td></tr>}
            {backups.map((b, i) => (
              <tr key={b.key}>
                <td>{fmtDate(b.lastModified)} {i === 0 && <Chip tone="info">latest</Chip>}</td>
                <td className="mono">{fmtBytes(b.size)}</td>
                <td className="mono small" style={{ wordBreak: 'break-all' }}>{b.key}</td>
                <td>
                  <button className="btn ghost sm" onClick={() => setConfirmKey(b.key)} disabled={busy || !isSuperAdmin} title={gate}>Restore</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
