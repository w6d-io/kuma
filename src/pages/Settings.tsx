import { useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { api } from '../api/client';
import type { BundleImportResult } from '../api/client';

export function SettingsPage() {
  const { state, pushToast, refetch } = useApp();
  const authDomain = state.meta.authDomain || (window as any).__AUTH_DOMAIN__ || '';
  const accountUrl = authDomain
    ? `https://${authDomain}/settings?return_to=${encodeURIComponent(window.location.href)}`
    : null;

  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BundleImportResult | null>(null);

  async function handleExport() {
    setExporting(true);
    try {
      await api.exportBundle();
      pushToast('Bundle exported', { sub: 'JSON file downloaded' });
    } catch (e: any) {
      pushToast(e.message || 'Export failed', { err: true });
    } finally {
      setExporting(false);
    }
  }

  function handleImportClick() {
    fileRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      if (!bundle?.version || !bundle?.rbac) {
        pushToast('Invalid bundle file', { err: true, sub: 'Missing version or rbac fields' });
        return;
      }
      const res = await api.importBundle(bundle);
      setImportResult(res.imported);
      const r = res.imported.rbac;
      pushToast('Bundle imported', { sub: `${r.services} services, ${r.groups} groups, ${r.roles} roles` });
      refetch();
    } catch (e: any) {
      pushToast(e.message || 'Import failed', { err: true });
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin settings</h1>
          <div className="sub">Admin operations.</div>
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

      <div className="panel" style={{ marginBottom: 14, padding: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>RBAC bundle</div>
        <div className="small muted" style={{ marginBottom: 14 }}>
          Export or import a full snapshot of RBAC configuration (services, groups, roles, route maps, Oathkeeper rules).
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={handleExport} disabled={exporting}>
            {I.download} {exporting ? 'Exporting…' : 'Export bundle'}
          </button>
          <button className="btn" onClick={handleImportClick} disabled={importing}>
            {I.upload} {importing ? 'Importing…' : 'Import bundle'}
          </button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileSelected} />
        </div>

        {importResult && (
          <div style={{ marginTop: 14, fontSize: 12, color: "var(--ink-2)" }}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Import summary</div>
            <div>{importResult.rbac.services} services, {importResult.rbac.groups} groups, {importResult.rbac.roles} roles, {importResult.rbac.routeMaps} route maps, {importResult.rbac.oathkeeperRules} Oathkeeper rules</div>
          </div>
        )}
      </div>
    </>
  );
}
