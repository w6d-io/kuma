import { useState, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { api, type BundleImportResult } from '../api/client';

export function SettingsPage() {
  const { state } = useApp();
  const authDomain = state.meta.authDomain || (window as any).__AUTH_DOMAIN__ || '';
  const accountUrl = authDomain
    ? `https://${authDomain}/settings?return_to=${encodeURIComponent(window.location.href)}`
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin settings</h1>
          <div className="sub">RBAC bundle import / export and other admin operations.</div>
        </div>
      </div>

      {accountUrl && (
        <div className="panel" style={{ marginBottom: 14, padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ width: 18, height: 18, display: "grid", placeItems: "center", color: "var(--ink-3)" }}>{I.users}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>Looking for your account settings?</div>
            <div className="small muted">
              Profile, password, two-factor, and session management live on the auth domain.
            </div>
          </div>
          <a className="btn" href={accountUrl}>Open account settings →</a>
        </div>
      )}

      <BackupSection />
    </>
  );
}

function BackupSection() {
  const { pushToast } = useApp();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BundleImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.exportBundle();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `auth-bundle-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast('Bundle exported');
    } catch (e: any) {
      pushToast(e.message || 'Export failed', { err: true });
    }
    setExporting(false);
  };

  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const { imported } = await api.importBundle(bundle);
      setImportResult(imported);
      pushToast('Bundle imported successfully');
    } catch (e: any) {
      pushToast(e.message || 'Import failed', { err: true });
    }
    setImporting(false);
  };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h3 style={{ margin: '0 0 4px' }}>Export bundle</h3>
        <p className="small muted" style={{ margin: '0 0 14px' }}>
          Downloads all RBAC config (services, groups, roles, routes, rules) and Kratos identities as a JSON file. Use to migrate or back up this environment.
        </p>
        <button className="btn" onClick={handleExport} disabled={exporting}>
          {I.download} {exporting ? 'Exporting…' : 'Export bundle'}
        </button>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 24 }}>
        <h3 style={{ margin: '0 0 4px' }}>Import bundle</h3>
        <p className="small muted" style={{ margin: '0 0 14px' }}>
          Restores from a previously exported bundle. RBAC data is fully replaced. Identities are upserted — existing users keep their passwords; new users are created with a temporary password and must recover their account.
        </p>
        <div className="row" style={{ gap: 10 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }}
          />
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={importing}>
            {I.download} {importing ? 'Importing…' : 'Choose bundle file'}
          </button>
        </div>

        {importResult && (
          <div className="panel" style={{ marginTop: 16, padding: 16 }}>
            <div className="small" style={{ fontWeight: 600, marginBottom: 8 }}>Import complete</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
              {([
                ['Services', importResult.rbac.services],
                ['Groups', importResult.rbac.groups],
                ['Roles', importResult.rbac.roles],
                ['Route maps', importResult.rbac.routeMaps],
                ['OAK rules', importResult.rbac.oathkeeperRules],
                ['Users created', importResult.identities.created],
                ['Users updated', importResult.identities.updated],
                ['Users skipped', importResult.identities.skipped],
              ] as [string, number][]).map(([label, val]) => (
                <div key={label} style={{ background: 'var(--panel-2)', borderRadius: 6, padding: '8px 12px' }}>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{val}</div>
                  <div className="small muted">{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 24 }}>
        <div className="small muted">
          <strong>Auto backup (Helm):</strong> set <code>backup.enabled=true</code>, <code>backup.s3.bucket</code>, and <code>backup.serviceAccount.annotations</code> (IRSA) in your values to schedule automatic S3 uploads.
        </div>
      </div>
    </div>
  );
}
