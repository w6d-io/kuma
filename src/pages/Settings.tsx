import { useEffect, useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useOrgServiceMap, useSetOrgServiceBundle, useDeleteOrgServiceMapping, useAuthMethods, useSetAuthMethods, useImportHistory, useRollbackImport } from '../api/hooks';
import { I } from '../components/ui/Icons';
import { Chip, Modal, ConfirmDialog, MultiSelectPills, Switch } from '../components/ui/Primitives';
import { api } from '../api/client';
import type { BundleImportResult, AuthMethodName } from '../api/client';
import { ExportBundleModal } from '../components/ExportBundleModal';

// Shape of a bundle we can preview before importing. Counts drive the confirm
// dialog; the raw parsed object is POSTed on confirm.
interface PendingBundle {
  bundle: unknown;
  fileName: string;
  counts: { services: number; groups: number; roles: number; routeMaps: number; oathkeeperRules: number; orgServiceMap: number };
}

// Section picker for import — mirrors ExportBundleModal. Keeping ALL selected is
// a full 1:1 restore (prunes anything not in the file); deselecting switches to
// a selective override/add that removes nothing outside the chosen sections.
// Auth methods surfaced as toggles. Order = display order. Methods needing a
// config block in kratos.yml (webauthn/passkey/oidc) render locked until
// configured — jinbe rejects enabling them anyway, this just explains why.
const AUTH_METHODS: { id: AuthMethodName; label: string; hint: string; needsConfig?: boolean }[] = [
  { id: 'password',      label: 'Password',           hint: 'Classic email + password sign-in.' },
  { id: 'code',          label: 'One-time code',      hint: 'Email codes for sign-in, recovery and verification.' },
  { id: 'passkey',       label: 'Passkeys',           hint: 'WebAuthn discoverable credentials (Face ID, security keys).', needsConfig: true },
  { id: 'webauthn',      label: 'Security keys (legacy WebAuthn)', hint: 'Second-factor WebAuthn.', needsConfig: true },
  { id: 'oidc',          label: 'Social sign-in (OIDC)', hint: 'Google, GitHub… requires providers in kratos.yml.', needsConfig: true },
  { id: 'totp',          label: 'Authenticator app (TOTP)', hint: 'Time-based codes as a second factor.' },
  { id: 'lookup_secret', label: 'Backup codes',       hint: 'One-time recovery codes.' },
];

const IMPORT_SECTIONS: { id: keyof PendingBundle['counts']; label: string }[] = [
  { id: 'services', label: 'Services' },
  { id: 'groups', label: 'Groups' },
  { id: 'roles', label: 'Roles' },
  { id: 'routeMaps', label: 'Route maps' },
  { id: 'oathkeeperRules', label: 'Oathkeeper rules' },
  { id: 'orgServiceMap', label: 'Org → service map' },
];

export function SettingsPage() {
  const { state, pushToast, refetch } = useApp();
  const authDomain = state.meta.authDomain || (window as any).__AUTH_DOMAIN__ || '';
  const accountUrl = authDomain
    ? `https://${authDomain}/settings?return_to=${encodeURIComponent(window.location.href)}`
    : null;

  const fileRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const { data: importHistory } = useImportHistory();
  const rollbackImport = useRollbackImport();
  const [confirmRollback, setConfirmRollback] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BundleImportResult | null>(null);
  const [pending, setPending] = useState<PendingBundle | null>(null);
  const [importSections, setImportSections] = useState<string[]>([]);

  // ─── Kratos auth-method toggles (hot-reload; hidden when jinbe lacks KRATOS_CONFIG_PATH) ───
  const { data: authConfig, error: authMethodsError } = useAuthMethods();
  const setAuthMethods = useSetAuthMethods();
  const authMethods = authConfig?.methods;
  const registrationEnabled = authConfig?.registration.enabled ?? true;
  const authMethodsAvailable = !!authConfig && (authMethodsError as any)?.status !== 501;

  // First-factor methods — at least one must stay enabled or everyone is locked out.
  const firstFactorCount = authMethods
    ? [authMethods.password.enabled, !!authMethods.code.passwordlessEnabled && authMethods.code.enabled, authMethods.passkey.enabled, authMethods.oidc.enabled].filter(Boolean).length
    : 0;

  function toggleAuthMethod(id: AuthMethodName, patch: { enabled?: boolean; passwordlessEnabled?: boolean }) {
    const disablingFirstFactor =
      (id === 'password' && patch.enabled === false) ||
      (id === 'passkey' && patch.enabled === false) ||
      (id === 'oidc' && patch.enabled === false) ||
      (id === 'code' && (patch.enabled === false || patch.passwordlessEnabled === false) && !!authMethods?.code.passwordlessEnabled);
    if (disablingFirstFactor && firstFactorCount <= 1) {
      pushToast('At least one sign-in method must stay enabled', { err: true, sub: 'Enable another first-factor method before disabling this one.' });
      return;
    }
    setAuthMethods.mutate(
      { [id]: patch },
      {
        onSuccess: () => pushToast('Authentication methods updated', { sub: 'Kratos hot-reloads — live on the next login flow.' }),
        onError: (e: Error) => pushToast(e.message || 'Failed to update auth methods', { err: true }),
      },
    );
  }

  function toggleRegistration(enabled: boolean) {
    setAuthMethods.mutate(
      { registration: { enabled } },
      {
        onSuccess: () => pushToast(
          enabled ? 'Self-registration enabled' : 'Self-registration disabled',
          { sub: enabled ? 'Anyone can create an account on the login page.' : 'Accounts are now created only from Users → create (with invite email).' },
        ),
        onError: (e: Error) => pushToast(e.message || 'Failed to update registration', { err: true }),
      },
    );
  }

  // ─── Org → Service bundle map (cached Query hook, PERF-4; optimistic PUT) ───
  const { data: fetchedMappings, isLoading: mapLoading } = useOrgServiceMap();
  const setBundle = useSetOrgServiceBundle();
  const deleteMapping = useDeleteOrgServiceMapping();
  const mappings: Record<string, string[]> = fetchedMappings ?? {};
  const [newOrgId, setNewOrgId] = useState('');
  const [newServices, setNewServices] = useState<string[]>([]);
  const [confirmOrg, setConfirmOrg] = useState<string | null>(null);
  const mapSaving = setBundle.isPending;

  // Seed the editor from the org's current bundle whenever the target org id
  // changes (e.g. clicking "Edit" on a row), so a save is a deliberate REPLACE
  // — never an accidental clobber that narrows an existing bundle to a single
  // freshly-picked service. Keyed on `newOrgId` only so a background refetch
  // never resets an in-progress edit.
  useEffect(() => {
    const key = newOrgId.trim();
    setNewServices(key && mappings[key] ? [...mappings[key]] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newOrgId]);

  const toggleService = (svc: string) =>
    setNewServices(prev => (prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]));

  function handleSetBundle() {
    const orgId = newOrgId.trim();
    if (!orgId || newServices.length === 0) return;
    setBundle.mutate(
      { organizationId: orgId, services: newServices },
      {
        onSuccess: () => {
          setNewOrgId('');
          setNewServices([]);
          pushToast('Bundle saved', { sub: `${orgId.slice(0, 8)}… → ${newServices.length} service${newServices.length === 1 ? '' : 's'}` });
        },
        onError: (e: Error) => pushToast(e.message || 'Failed to save bundle', { err: true }),
      },
    );
  }

  function handleDeleteMapping(orgId: string) {
    deleteMapping.mutate(orgId, {
      onSuccess: () => pushToast('Bundle removed'),
      onError: (e: Error) => pushToast(e.message || 'Failed to remove bundle', { err: true }),
    });
  }

  // ─── Bundle export/import ───
  // Export goes through ExportBundleModal (choose-what-to-export). Import stays inline below.

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
      const counts = {
        services:        Array.isArray(rbac.services) ? rbac.services.length : Object.keys(rbac.services ?? {}).length,
        groups:          Object.keys(rbac.groups ?? {}).length,
        roles:           Object.keys(rbac.roles ?? {}).length,
        routeMaps:       Object.keys(rbac.routeMaps ?? {}).length,
        oathkeeperRules: Array.isArray(rbac.oathkeeperRules) ? rbac.oathkeeperRules.length : 0,
        orgServiceMap:   Object.keys(rbac.orgServiceMap ?? {}).length,
      };
      setPending({ bundle, fileName, counts });
      // Default to a full restore: every section available in the file is selected.
      setImportSections(IMPORT_SECTIONS.filter(s => s.id !== 'orgServiceMap' || counts.orgServiceMap > 0).map(s => s.id));
    } catch (err: any) {
      pushToast(err.message || 'Could not read bundle file', { err: true, sub: 'Not valid JSON?' });
    }
  }

  // Sections offered for THIS file — orgServiceMap only when the file carries one.
  const availableSections = pending
    ? IMPORT_SECTIONS.filter(s => s.id !== 'orgServiceMap' || pending.counts.orgServiceMap > 0)
    : [];
  // Keeping every available section selected = full 1:1 restore (send no sections
  // param so the backend prunes); any deselection = selective override/add.
  const isFullRestore = pending != null && importSections.length === availableSections.length;

  async function confirmImport() {
    if (!pending || importSections.length === 0) return;
    setImporting(true);
    try {
      const res = await api.importBundle(pending.bundle, isFullRestore ? undefined : importSections);
      setImportResult(res.imported);
      const r = res.imported.rbac;
      pushToast(isFullRestore ? 'Bundle restored' : 'Sections imported', {
        sub: isFullRestore
          ? `${r.services} services, ${r.groups} groups, ${r.roles} roles`
          : `${importSections.length} section${importSections.length === 1 ? '' : 's'} applied`,
      });
      refetch();
    } catch (e: any) {
      // Validation rejections carry the failing rules — surface WHICH ones so
      // the operator can fix the bundle instead of guessing.
      const failures: { id: string; reason: string }[] | undefined = e?.details?.failures;
      pushToast(e.message || 'Import failed', {
        err: true,
        sub: failures?.length ? failures.slice(0, 3).map(f => `${f.id}: ${f.reason}`).join(' · ') : undefined,
      });
    } finally {
      setImporting(false);
      setPending(null);
    }
  }

  function doRollback(id: string) {
    rollbackImport.mutate(id, {
      onSuccess: () => { pushToast('Configuration rolled back', { sub: 'A pre-rollback snapshot of the replaced state was kept.' }); refetch(); },
      onError: (e: Error) => pushToast(e.message || 'Rollback failed', { err: true }),
    });
  }

  const serviceNames = state.services.map(s => s.name).filter(n => n !== 'global');
  const mapEntries = Object.entries(mappings);
  const editingExisting = !!(newOrgId.trim() && mappings[newOrgId.trim()]);

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

      {/* ─── Authentication methods (Kratos self-service, hot-reload) ─── */}
      {authMethodsAvailable && authMethods && (
        <div className="panel" style={{ marginBottom: 14, padding: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Authentication methods</div>
          <div className="small muted" style={{ marginBottom: 14 }}>
            Enable or disable how users sign in. Changes hot-reload into Kratos — live on the next login flow, no restart.
          </div>
          {/* Self-registration master switch — off = accounts are admin-created only. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0 12px', borderBottom: '2px solid var(--line)', marginBottom: 6 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 13 }}>
                Self-registration
                {!registrationEnabled && <Chip tone="warn" mono={false}>admin-only accounts</Chip>}
              </div>
              <div className="small muted">
                {registrationEnabled
                  ? 'Anyone can create an account from the login page.'
                  : 'The public sign-up page is disabled — create accounts from Users → create (sends an invite email).'}
              </div>
            </div>
            <Switch on={registrationEnabled} onChange={toggleRegistration} />
          </div>
          {AUTH_METHODS.map(m => {
            const st = authMethods[m.id];
            const locked = !!m.needsConfig && !st.configured;
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>
                    {m.label}
                    {locked && <span className="small muted" style={{ marginLeft: 8 }}>requires config in kratos.yml</span>}
                  </div>
                  <div className="small muted">{m.hint}</div>
                  {m.id === 'code' && st.enabled && (
                    <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <input
                        type="checkbox"
                        checked={!!st.passwordlessEnabled}
                        disabled={setAuthMethods.isPending}
                        onChange={e => toggleAuthMethod('code', { passwordlessEnabled: e.target.checked })}
                      />
                      Allow passwordless sign-in with a code (first factor)
                    </label>
                  )}
                </div>
                {locked
                  ? <span className="small muted">off</span>
                  : <Switch on={st.enabled} onChange={v => toggleAuthMethod(m.id, { enabled: v })} />}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Org → Service bundle map ─── */}
      <div className="panel" style={{ marginBottom: 14, padding: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Organization → Service bundle</div>
        <div className="small muted" style={{ marginBottom: 14 }}>
          Bundles a set of RBAC services to each organization UUID so org-scoped endpoints resolve permissions correctly. Saving replaces an org's entire bundle.
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
                    <th style={{ padding: '6px 8px', fontWeight: 500, color: 'var(--ink-2)' }}>Services</th>
                    <th style={{ padding: '6px 8px', width: 96 }} />
                  </tr>
                </thead>
                <tbody>
                  {mapEntries.map(([orgId, svcs]) => (
                    <tr key={orgId} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td className="mono" style={{ padding: '6px 8px', verticalAlign: 'top' }}>{orgId}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {svcs.length === 0
                          ? <span className="small muted">— none —</span>
                          : <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{svcs.map(s => <Chip key={s}>{s}</Chip>)}</span>}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                        <button className="btn ghost sm" onClick={() => setNewOrgId(orgId)} title="Edit bundle">Edit</button>
                        <button className="btn ghost sm" onClick={() => setConfirmOrg(orgId)} title="Remove bundle">
                          {I.trash}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="text"
                placeholder="Organization UUID"
                value={newOrgId}
                onChange={e => setNewOrgId(e.target.value)}
                style={{ maxWidth: 360 }}
              />
              <div>
                <div className="input-label">Services{editingExisting ? ' · replaces current bundle' : ''}</div>
                <MultiSelectPills
                  options={serviceNames}
                  selected={newServices}
                  onToggle={toggleService}
                  empty="No services defined yet."
                />
              </div>
              <div>
                <button
                  className="btn primary"
                  onClick={handleSetBundle}
                  disabled={mapSaving || !newOrgId.trim() || newServices.length === 0}
                >
                  {mapSaving ? 'Saving…' : (editingExisting ? 'Replace bundle' : 'Save bundle')}
                </button>
              </div>
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
          <button className="btn" onClick={() => setExportOpen(true)}>
            {I.download} Export bundle
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

        {/* ─── Import history — automatic pre-import snapshots, one-click reroll ─── */}
        {(importHistory?.length ?? 0) > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4 }}>Import history</div>
            <div className="small muted" style={{ marginBottom: 8 }}>
              A snapshot is taken automatically before every import, restore or rollback. Rolling back re-applies the snapshot as a full restore (and keeps a snapshot of what it replaces).
            </div>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px', fontWeight: 500, color: 'var(--ink-2)' }}>When</th>
                  <th style={{ padding: '6px 8px', fontWeight: 500, color: 'var(--ink-2)' }}>Taken before</th>
                  <th style={{ padding: '6px 8px', fontWeight: 500, color: 'var(--ink-2)' }}>By</th>
                  <th style={{ padding: '6px 8px', fontWeight: 500, color: 'var(--ink-2)' }}>Contents</th>
                  <th style={{ padding: '6px 8px', width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {importHistory!.map(h => (
                  <tr key={h.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{new Date(h.takenAt).toLocaleString()}</td>
                    <td style={{ padding: '6px 8px' }}><Chip>{h.reason.replace('pre-', '')}</Chip></td>
                    <td style={{ padding: '6px 8px' }} className="mono">{h.actor || '—'}</td>
                    <td style={{ padding: '6px 8px' }} className="small muted">
                      {h.counts.services} svc · {h.counts.groups} groups · {h.counts.roles} roles · {h.counts.oathkeeperRules} rules
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      <button className="btn ghost sm" disabled={rollbackImport.isPending} onClick={() => setConfirmRollback(h.id)}>
                        Roll back
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm before import (UX-8) — pick which sections to apply. */}
      <Modal
        open={!!pending}
        onClose={() => { if (!importing) setPending(null); }}
        eyebrow="POST /admin/rbac/bundle/import"
        title="Import RBAC bundle?"
        footer={
          <>
            <button className="btn" onClick={() => setPending(null)} disabled={importing}>Cancel</button>
            <button className="btn primary" onClick={confirmImport} disabled={importing || importSections.length === 0}>
              {importing
                ? 'Importing…'
                : isFullRestore
                  ? 'Restore full config'
                  : `Import ${importSections.length} section${importSections.length === 1 ? '' : 's'}`}
            </button>
          </>
        }
      >
        {pending && (
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              className="panel"
              style={{ padding: 10, borderColor: isFullRestore ? 'var(--warn, #d97706)' : 'var(--line)', color: isFullRestore ? 'var(--warn, #d97706)' : 'var(--ink-2)' }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                {isFullRestore ? 'This replaces your entire RBAC configuration' : 'Selective import — nothing is removed'}
              </div>
              <div className="small">
                {isFullRestore
                  ? <>Every section is applied from <span className="mono">{pending.fileName}</span> and anything not in the file (extra services, groups, rules) is removed. This cannot be undone.</>
                  : <>Only the checked sections are overwritten or added from <span className="mono">{pending.fileName}</span>. Unchecked sections, and anything not in the file, are left untouched.</>}
              </div>
            </div>
            <div>
              <div className="small muted" style={{ marginBottom: 4 }}>Choose what to import</div>
              <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  disabled={importing}
                  checked={importSections.length === availableSections.length}
                  ref={(el) => { if (el) el.indeterminate = importSections.length > 0 && importSections.length < availableSections.length; }}
                  onChange={(e) => setImportSections(e.target.checked ? availableSections.map(s => s.id) : [])}
                />
                Select all (full restore)
              </label>
              {availableSections.map((s) => (
                <label key={s.id} className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <input
                    type="checkbox"
                    disabled={importing}
                    checked={importSections.includes(s.id)}
                    onChange={(e) => setImportSections((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                  />
                  <span style={{ flex: 1 }}>{s.label}</span>
                  <span className="mono muted" style={{ fontSize: 11 }}>{pending.counts[s.id]}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmRollback}
        title="Roll back RBAC configuration?"
        danger
        confirmLabel="Roll back"
        body={<>The entire RBAC configuration (services, groups, roles, route maps, Oathkeeper rules) is replaced by this snapshot. A snapshot of the current state is kept, so you can roll forward again.</>}
        onCancel={() => setConfirmRollback(null)}
        onConfirm={() => { if (confirmRollback) doRollback(confirmRollback); setConfirmRollback(null); }}
      />

      <ConfirmDialog
        open={!!confirmOrg}
        title="Remove organization bundle?"
        danger
        confirmLabel="Remove bundle"
        body={<>Org admins for <span className="mono">{confirmOrg?.slice(0, 8)}…</span> will lose the ability to manage its users, and delegated group assignment will stop working for that organization.</>}
        onCancel={() => setConfirmOrg(null)}
        onConfirm={() => { if (confirmOrg) handleDeleteMapping(confirmOrg); setConfirmOrg(null); }}
      />

      <ExportBundleModal open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}
