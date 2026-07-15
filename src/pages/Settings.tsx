import { useEffect, useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { Modal } from '../components/ui/Primitives';
import { api } from '../api/client';
import type { BundleImportResult } from '../api/client';

// Shape of a bundle we can preview before importing. Counts drive the confirm
// dialog; the raw parsed object is POSTed on confirm.
interface PendingBundle {
  bundle: unknown;
  fileName: string;
  counts: { services: number; groups: number; roles: number; routeMaps: number; oathkeeperRules: number };
}

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
  const [pending, setPending] = useState<PendingBundle | null>(null);

  // ─── Org → Service map ───
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [mapLoading, setMapLoading] = useState(true);
  const [newOrgId, setNewOrgId] = useState('');
  const [newService, setNewService] = useState('');
  const [mapSaving, setMapSaving] = useState(false);

  useEffect(() => {
    api.getOrgServiceMap()
      .then(setMappings)
      .catch(() => {})
      .finally(() => setMapLoading(false));
  }, []);

  async function handleAddMapping() {
    const orgId = newOrgId.trim();
    const svc = newService.trim();
    if (!orgId || !svc) return;
    setMapSaving(true);
    try {
      await api.setOrgServiceMapping(orgId, svc);
      setMappings(m => ({ ...m, [orgId]: svc }));
      setNewOrgId('');
      setNewService('');
      pushToast('Mapping saved', { sub: `${orgId.slice(0, 8)}… → ${svc}` });
    } catch (e: any) {
      pushToast(e.message || 'Failed to save mapping', { err: true });
    } finally {
      setMapSaving(false);
    }
  }

  async function handleDeleteMapping(orgId: string) {
    try {
      await api.deleteOrgServiceMapping(orgId);
      setMappings(m => {
        const next = { ...m };
        delete next[orgId];
        return next;
      });
      pushToast('Mapping removed');
    } catch (e: any) {
      pushToast(e.message || 'Failed to remove mapping', { err: true });
    }
  }

  // ─── Bundle export/import ───
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

  // Parse + validate the selected file and open a confirm dialog. Import is a
  // full-snapshot overwrite of RBAC config, so it must never fire on file
  // selection alone (UX-8) — the user confirms after seeing what it contains.
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileName = file.name;
    e.target.value = '';
    setImportResult(null);
    try {
      const bundle: any = JSON.parse(await file.text());
      if (!bundle?.version || !bundle?.rbac) {
        pushToast('Invalid bundle file', { err: true, sub: 'Missing version or rbac fields' });
        return;
      }
      const rbac = bundle.rbac;
      setPending({
        bundle,
        fileName,
        counts: {
          services:        Array.isArray(rbac.services) ? rbac.services.length : Object.keys(rbac.services ?? {}).length,
          groups:          Object.keys(rbac.groups ?? {}).length,
          roles:           Object.keys(rbac.roles ?? {}).length,
          routeMaps:       Object.keys(rbac.routeMaps ?? {}).length,
          oathkeeperRules: Array.isArray(rbac.oathkeeperRules) ? rbac.oathkeeperRules.length : 0,
        },
      });
    } catch (err: any) {
      pushToast(err.message || 'Could not read bundle file', { err: true, sub: 'Not valid JSON?' });
    }
  }

  async function confirmImport() {
    if (!pending) return;
    setImporting(true);
    try {
      const res = await api.importBundle(pending.bundle);
      setImportResult(res.imported);
      const r = res.imported.rbac;
      pushToast('Bundle imported', { sub: `${r.services} services, ${r.groups} groups, ${r.roles} roles` });
      refetch();
    } catch (e: any) {
      pushToast(e.message || 'Import failed', { err: true });
    } finally {
      setImporting(false);
      setPending(null);
    }
  }

  const serviceNames = state.services.map(s => s.name).filter(n => n !== 'global');
  const mapEntries = Object.entries(mappings);

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

      {/* ─── Org → Service map ─── */}
      <div className="panel" style={{ marginBottom: 14, padding: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Organization → Service mapping</div>
        <div className="small muted" style={{ marginBottom: 14 }}>
          Maps organization UUIDs to RBAC service names so org-scoped endpoints resolve permissions correctly.
        </div>

        {mapLoading ? (
          <div className="small muted">Loading…</div>
        ) : (
          <>
            {mapEntries.length > 0 && (
              <table style={{ width: '100%', fontSize: 12, marginBottom: 14, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px', fontWeight: 500, color: 'var(--ink-2)' }}>Organization ID</th>
                    <th style={{ padding: '6px 8px', fontWeight: 500, color: 'var(--ink-2)' }}>Service</th>
                    <th style={{ padding: '6px 8px', width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {mapEntries.map(([orgId, svc]) => (
                    <tr key={orgId} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td className="mono" style={{ padding: '6px 8px' }}>{orgId}</td>
                      <td className="mono" style={{ padding: '6px 8px', fontWeight: 500 }}>{svc}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <button className="btn ghost sm" onClick={() => handleDeleteMapping(orgId)} title="Remove mapping">
                          {I.trash}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Organization UUID"
                value={newOrgId}
                onChange={e => setNewOrgId(e.target.value)}
                style={{ flex: '1 1 280px', minWidth: 200 }}
              />
              <select
                value={newService}
                onChange={e => setNewService(e.target.value)}
                style={{ flex: '0 1 180px', minWidth: 140 }}
              >
                <option value="">Select service…</option>
                {serviceNames.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <button
                className="btn primary"
                onClick={handleAddMapping}
                disabled={mapSaving || !newOrgId.trim() || !newService}
              >
                {mapSaving ? 'Saving…' : 'Add mapping'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ─── RBAC bundle ─── */}
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

      {/* Confirm before a full-snapshot overwrite (UX-8). */}
      <Modal
        open={!!pending}
        onClose={() => { if (!importing) setPending(null); }}
        eyebrow="POST /admin/rbac/bundle/import"
        title="Import RBAC bundle?"
        footer={
          <>
            <button className="btn" onClick={() => setPending(null)} disabled={importing}>Cancel</button>
            <button className="btn primary" onClick={confirmImport} disabled={importing}>
              {importing ? 'Importing…' : 'Overwrite RBAC config'}
            </button>
          </>
        }
      >
        {pending && (
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="panel" style={{ padding: 10, borderColor: 'var(--warn, #d97706)', color: 'var(--warn, #d97706)' }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>This replaces your RBAC configuration</div>
              <div className="small">Services, groups, roles, route maps and Oathkeeper rules will be overwritten from <span className="mono">{pending.fileName}</span>. This cannot be undone.</div>
            </div>
            <div>
              <div className="small muted" style={{ marginBottom: 4 }}>Bundle contents</div>
              <div className="mono" style={{ fontSize: 12 }}>
                {pending.counts.services} services · {pending.counts.groups} groups · {pending.counts.roles} role sets · {pending.counts.routeMaps} route maps · {pending.counts.oathkeeperRules} Oathkeeper rules
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
