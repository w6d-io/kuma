import { useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useAuthMethods, useSetAuthMethods, useImportHistory, useRollbackImport } from '../api/hooks';
import { I, Badge, Button, Callout, Card, Checkbox, ConfirmDialog, Dialog, PageHeader, Switch, Table } from '../components/ui';
import { api } from '../api/client';
import type { BundleImportResult, AuthMethodName } from '../api/client';
import { ExportBundleModal } from '../components/ExportBundleModal';
import { OrgSitesSettings } from '../components/OrgSitesSettings';

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


  return (
    <>
      <PageHeader title="Admin settings" sub="Admin operations." />

      {accountUrl && (
        <Card pad="md">
          <div className="row gap-12">
            <span className="icon-lg muted">{I.users}</span>
            <div className="flex-1 min-w-0">
              <div className="fw-medium text-base">Looking for your account settings?</div>
              <div className="small muted">
                Profile, password, two-factor, and session management live on the auth domain.
              </div>
            </div>
            <a className="btn" href={accountUrl}>Open account settings →</a>
          </div>
        </Card>
      )}

      {/* ─── Authentication methods (Kratos self-service, hot-reload) ─── */}
      {authMethodsAvailable && authMethods && (
        <Card
          title="Authentication methods"
          sub="Enable or disable how users sign in. Changes hot-reload into Kratos — live on the next login flow, no restart."
        >
          {/* Self-registration master switch — off = accounts are admin-created only. */}
          <div className="settings-row master">
            <div className="flex-1 min-w-0">
              <div className="fw-medium text-base">
                Self-registration
                {!registrationEnabled && <Badge tone="warning" mono={false}>admin-only accounts</Badge>}
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
              <div key={m.id} className="settings-row">
                <div className="flex-1 min-w-0">
                  <div className="fw-medium text-base">
                    {m.label}
                    {locked && <span className="small muted ml-8">requires config in kratos.yml</span>}
                  </div>
                  <div className="small muted">{m.hint}</div>
                  {m.id === 'code' && st.enabled && (
                    <Checkbox
                      className="settings-sub-option"
                      checked={!!st.passwordlessEnabled}
                      disabled={setAuthMethods.isPending}
                      onChange={v => toggleAuthMethod('code', { passwordlessEnabled: v })}
                      label="Allow passwordless sign-in with a code (first factor)"
                    />
                  )}
                </div>
                {locked
                  ? <span className="small muted">off</span>
                  : <Switch on={st.enabled} onChange={v => toggleAuthMethod(m.id, { enabled: v })} />}
              </div>
            );
          })}
        </Card>
      )}

      <OrgSitesSettings />

      {/* ─── RBAC bundle ─── */}
      <Card
        title="RBAC bundle"
        sub="Export or import a full snapshot of RBAC configuration (services, groups, roles, route maps, Oathkeeper rules)."
      >
        <div className="row wrap gap-8">
          <Button icon={I.download} onClick={() => setExportOpen(true)}>
            Export bundle
          </Button>
          <Button icon={I.upload} onClick={handleImportClick} disabled={importing}>
            {importing ? 'Importing…' : 'Import bundle'}
          </Button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFileSelected} />
        </div>

        {importResult && (
          <div className="mt-12 text-sm text-muted">
            <div className="fw-medium mb-4">Import summary</div>
            <div>{importResult.rbac.services} services, {importResult.rbac.groups} groups, {importResult.rbac.roles} roles, {importResult.rbac.routeMaps} route maps, {importResult.rbac.oathkeeperRules} Oathkeeper rules</div>
          </div>
        )}

        {/* ─── Import history — automatic pre-import snapshots, one-click reroll ─── */}
        {(importHistory?.length ?? 0) > 0 && (
          <div className="mt-16">
            <div className="fw-medium text-base mb-4">Import history</div>
            <div className="small muted mb-8">
              A snapshot is taken automatically before every import, restore or rollback. Rolling back re-applies the snapshot as a full restore (and keeps a snapshot of what it replaces).
            </div>
            <Table className="compact">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Taken before</th>
                  <th>By</th>
                  <th>Contents</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {importHistory!.map(h => (
                  <tr key={h.id}>
                    <td className="nowrap">{new Date(h.takenAt).toLocaleString()}</td>
                    <td><Badge>{h.reason.replace('pre-', '')}</Badge></td>
                    <td className="mono">{h.actor || '—'}</td>
                    <td className="small muted">
                      {h.counts.services} svc · {h.counts.groups} groups · {h.counts.roles} roles · {h.counts.oathkeeperRules} rules
                    </td>
                    <td className="shrink align-right">
                      <Button variant="ghost" size="sm" disabled={rollbackImport.isPending} onClick={() => setConfirmRollback(h.id)}>
                        Roll back
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      {/* Confirm before import (UX-8) — pick which sections to apply. */}
      <Dialog
        open={!!pending}
        onClose={() => { if (!importing) setPending(null); }}
        eyebrow="Settings"
        title="Import RBAC bundle?"
        footer={
          <>
            <Button onClick={() => setPending(null)} disabled={importing}>Cancel</Button>
            <Button variant="primary" onClick={confirmImport} disabled={importing || importSections.length === 0}>
              {importing
                ? 'Importing…'
                : isFullRestore
                  ? 'Restore full config'
                  : `Import ${importSections.length} section${importSections.length === 1 ? '' : 's'}`}
            </Button>
          </>
        }
      >
        {pending && (
          <div className="col gap-12 text-base">
            <Callout
              tone={isFullRestore ? 'warning' : 'neutral'}
              icon={I.alert}
              title={isFullRestore ? 'This replaces your entire RBAC configuration' : 'Selective import — nothing is removed'}
            >
              <div className="small">
                {isFullRestore
                  ? <>Every section is applied from <span className="mono">{pending.fileName}</span> and anything not in the file (extra services, groups, rules) is removed. This cannot be undone.</>
                  : <>Only the checked sections are overwritten or added from <span className="mono">{pending.fileName}</span>. Unchecked sections, and anything not in the file, are left untouched.</>}
              </div>
            </Callout>
            <div>
              <div className="small muted mb-4">Choose what to import</div>
              <Checkbox
                className="settings-check all"
                disabled={importing}
                checked={importSections.length === availableSections.length}
                indeterminate={importSections.length > 0 && importSections.length < availableSections.length}
                onChange={(on) => setImportSections(on ? availableSections.map(s => s.id) : [])}
                label="Select all (full restore)"
              />
              {availableSections.map((s) => (
                <Checkbox
                  key={s.id}
                  className="settings-check"
                  disabled={importing}
                  checked={importSections.includes(s.id)}
                  onChange={(on) => setImportSections((cur) => (on ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                  label={
                    <span className="row justify-between">
                      <span>{s.label}</span>
                      <span className="mono muted text-xs">{pending.counts[s.id]}</span>
                    </span>
                  }
                />
              ))}
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!confirmRollback}
        title="Roll back RBAC configuration?"
        danger
        confirmLabel="Roll back"
        body={<>The entire RBAC configuration (services, groups, roles, route maps, Oathkeeper rules) is replaced by this snapshot. A snapshot of the current state is kept, so you can roll forward again.</>}
        onCancel={() => setConfirmRollback(null)}
        onConfirm={() => { if (confirmRollback) doRollback(confirmRollback); setConfirmRollback(null); }}
      />

      <ExportBundleModal open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}
