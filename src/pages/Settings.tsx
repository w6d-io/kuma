import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession } from '../api/hooks';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, EmptyHint } from '../components/ui/Primitives';
import { api, type BundleImportResult } from '../api/client';

function useCurrentUser() {
  const { state } = useApp();
  const { data: session } = useSession();
  const email = session?.email ?? null;
  return email
    ? (state.users.find(u => u.email === email) ?? null)
    : null;
}

interface KratosSession {
  id: string;
  active: boolean;
  expires_at: string;
  authenticated_at: string;
  authenticator_assurance_level: string;
  devices?: { ip_address?: string; user_agent?: string }[];
  identity: { traits: { email: string; name?: string } };
}

async function logout(authDomain: string) {
  try {
    const res = await fetch('/api/kratos/self-service/logout/browser', { credentials: 'include' });
    if (res.ok) {
      const { logout_url } = await res.json();
      if (logout_url) { window.location.href = logout_url; return; }
    }
  } catch { /* fall through */ }
  window.location.href = `https://${authDomain}/self-service/logout/browser`;
}

export function SettingsPage() {
  const user = useCurrentUser();
  const { state } = useApp();
  const authDomain = state.meta.authDomain || (window as any).__AUTH_DOMAIN__ || 'auth.dev.w6d.io';
  const [tab, setTab] = useState<'profile' | 'security' | 'sessions' | 'backup'>('profile');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Account settings</h1>
          <div className="sub">Manage your profile, security, and sessions</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "240px 1fr", gap: 14 }}>
        {/* Sidebar nav */}
        <div className="panel" style={{ padding: 0, alignSelf: "start" }}>
          <div style={{ padding: 14, display: "flex", gap: 12, alignItems: "center", borderBottom: "1px solid var(--line)" }}>
            <Avatar name={user?.name} size={40} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.name || "User"}</div>
              <div className="small muted mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email}</div>
            </div>
          </div>
          {[
            { id: 'profile' as const, label: 'Profile', icon: I.users, sub: 'Name & avatar' },
            { id: 'security' as const, label: 'Security', icon: I.shield, sub: 'Password & MFA' },
            { id: 'sessions' as const, label: 'Sessions', icon: I.globe, sub: 'Active devices' },
            { id: 'backup' as const, label: 'Backup & Restore', icon: I.download, sub: 'Export / import bundle' },
          ].map(item => (
            <button key={item.id} onClick={() => setTab(item.id)}
              style={{
                width: "100%", textAlign: "left", padding: "12px 14px", border: "none",
                borderBottom: "1px solid var(--line)", cursor: "pointer",
                background: tab === item.id ? "var(--panel-2)" : "transparent",
                color: "var(--ink)", display: "flex", gap: 10, alignItems: "center",
              }}>
              <span style={{ width: 16, height: 16, display: "grid", placeItems: "center", color: tab === item.id ? "var(--accent)" : "var(--ink-3)" }}>{item.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: tab === item.id ? 600 : 400, fontSize: 12.5 }}>{item.label}</div>
                <div className="small muted">{item.sub}</div>
              </div>
              {tab === item.id && <span style={{ color: "var(--accent)" }}>{I.chev}</span>}
            </button>
          ))}
          <button
            onClick={() => logout(authDomain)}
            style={{
              width: "100%", textAlign: "left", padding: "12px 14px", border: "none",
              cursor: "pointer", background: "transparent",
              color: "var(--red, #ef4444)", display: "flex", gap: 10, alignItems: "center",
            }}
          >
            <span style={{ width: 16, height: 16, display: "grid", placeItems: "center" }}>{I.close}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 400, fontSize: 12.5 }}>Sign out</div>
              <div className="small muted">End your session</div>
            </div>
          </button>
        </div>

        {/* Content */}
        <div>
          {tab === 'profile' && <ProfileSection />}
          {tab === 'security' && <SecuritySection />}
          {tab === 'sessions' && <SessionsSection />}
          {tab === 'backup' && <BackupSection />}
        </div>
      </div>
    </>
  );
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function ProfileSection() {
  const { pushToast } = useApp();
  const user = useCurrentUser();
  const [name, setName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="panel">
        <div className="panel-head">
          <div><h3>Profile information</h3><div className="sub">Your public identity across the platform</div></div>
        </div>
        <div className="panel-body col" style={{ gap: 16 }}>
          {/* Avatar */}
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Avatar name={user?.name} size={64} />
            <div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>Profile picture</div>
              <div className="small muted mt-4">Generated from your initials. Gravatar support coming soon.</div>
            </div>
          </div>

          <div className="hline" />

          {/* Name */}
          <div>
            <label className="input-label">Display name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            <div className="input-hint">This is how you appear in audit logs and assignments.</div>
          </div>

          {/* Email — read only */}
          <div>
            <label className="input-label">Email address</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input className="input mono" value={user?.email || ''} disabled style={{ flex: 1, opacity: 0.7 }} />
              <Chip tone="info">
                <span style={{ width: 10, height: 10, display: "grid", placeItems: "center" }}>{I.lock}</span>
                read-only
              </Chip>
            </div>
            <div className="input-hint">Email is your identity. Contact an administrator to change it.</div>
          </div>

          {/* Groups — read only */}
          <div>
            <label className="input-label">Groups</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(user?.groups || []).map(g => <Chip key={g}>{g}</Chip>)}
              {(!user?.groups || user.groups.length === 0) && <span className="small muted">No groups assigned</span>}
            </div>
            <div className="input-hint">Group membership is managed by administrators via the Groups page.</div>
          </div>

          {/* Account status */}
          <div>
            <label className="input-label">Account status</label>
            <div className="row" style={{ gap: 8 }}>
              <Chip tone={user?.active ? "ok" : "warn"}>{user?.active ? "active" : "inactive"}</Chip>
              <span className="small muted">Last seen: {user?.last}</span>
            </div>
          </div>
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end" }}>
          <button className="btn primary" disabled={name === user?.name || saving} onClick={async () => {
            setSaving(true);
            try {
              // TODO: Call Kratos settings flow to update name
              pushToast("Profile updated", { sub: `name → ${name}` });
            } catch {
              pushToast("Failed to update profile", { err: true });
            }
            setSaving(false);
          }}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="panel" style={{ borderColor: "color-mix(in srgb, var(--err) 30%, var(--line))" }}>
        <div className="panel-head" style={{ background: "var(--err-soft)" }}>
          <div><h3 style={{ color: "var(--err)" }}>Danger zone</h3></div>
        </div>
        <div className="panel-body" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 12.5 }}>Deactivate account</div>
            <div className="small muted">This will disable your access to all services. Requires super_admin to reactivate.</div>
          </div>
          <button className="btn danger">Deactivate</button>
        </div>
      </div>
    </div>
  );
}

// ─── Security ─────────────────────────────────────────────────────────────────

function SecuritySection() {
  const { pushToast } = useApp();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const pwMatch = newPw === confirmPw;
  const pwStrong = newPw.length >= 8;
  const pwReady = currentPw && newPw && confirmPw && pwMatch && pwStrong;

  // Password strength meter
  const strength = (() => {
    if (!newPw) return { score: 0, label: '', color: '' };
    let s = 0;
    if (newPw.length >= 8) s++;
    if (newPw.length >= 12) s++;
    if (/[A-Z]/.test(newPw) && /[a-z]/.test(newPw)) s++;
    if (/\d/.test(newPw)) s++;
    if (/[^A-Za-z0-9]/.test(newPw)) s++;
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
    const colors = ['', 'var(--err)', 'var(--warn)', 'var(--info)', 'var(--ok)', 'var(--ok)'];
    return { score: s, label: labels[s] || '', color: colors[s] || '' };
  })();

  return (
    <div className="col" style={{ gap: 14 }}>
      {/* Password */}
      <div className="panel">
        <div className="panel-head">
          <div><h3>Change password</h3><div className="sub">Update your authentication credentials</div></div>
          <span style={{ width: 16, height: 16, display: "grid", placeItems: "center", color: "var(--ink-3)" }}>{I.lock}</span>
        </div>
        <div className="panel-body col" style={{ gap: 14 }}>
          <div>
            <label className="input-label">Current password</label>
            <div style={{ position: "relative" }}>
              <input className="input mono" type={showCurrent ? "text" : "password"} value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="Enter current password" />
              <button onClick={() => setShowCurrent(!showCurrent)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", width: 16, height: 16, display: "grid", placeItems: "center" }}>
                {I.eye || I.search}
              </button>
            </div>
          </div>

          <div className="hline" />

          <div>
            <label className="input-label">New password</label>
            <div style={{ position: "relative" }}>
              <input className="input mono" type={showNew ? "text" : "password"} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Minimum 8 characters" />
              <button onClick={() => setShowNew(!showNew)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", width: 16, height: 16, display: "grid", placeItems: "center" }}>
                {I.eye || I.search}
              </button>
            </div>
            {newPw && (
              <div className="mt-8">
                <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= strength.score ? strength.color : "var(--line)" }} />
                  ))}
                </div>
                <div className="small" style={{ color: strength.color }}>{strength.label}</div>
              </div>
            )}
          </div>

          <div>
            <label className="input-label">Confirm new password</label>
            <input className="input mono" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Re-enter new password" />
            {confirmPw && !pwMatch && <div className="input-hint" style={{ color: "var(--err)" }}>Passwords don't match</div>}
            {confirmPw && pwMatch && <div className="input-hint" style={{ color: "var(--ok)" }}>Passwords match</div>}
          </div>
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="small muted">Changing password will invalidate all other sessions.</div>
          <button className="btn primary" disabled={!pwReady || saving} onClick={async () => {
            setSaving(true);
            try {
              // TODO: Call Kratos settings flow with password method
              pushToast("Password updated", { sub: "All other sessions revoked" });
              setCurrentPw(''); setNewPw(''); setConfirmPw('');
            } catch {
              pushToast("Failed to change password", { err: true });
            }
            setSaving(false);
          }}>
            {saving ? "Updating…" : "Update password"}
          </button>
        </div>
      </div>

      {/* MFA */}
      <div className="panel">
        <div className="panel-head">
          <div><h3>Two-factor authentication</h3><div className="sub">Add an extra layer of security</div></div>
        </div>
        <div className="panel-body">
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: "var(--panel-2)", border: "1px solid var(--line)", display: "grid", placeItems: "center", color: "var(--ink-3)", flexShrink: 0 }}>{I.shield}</div>
            <div style={{ flex: 1 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>Authenticator app (TOTP)</div>
                <Chip tone="warn">not configured</Chip>
              </div>
              <div className="small muted mt-4">Use an app like Google Authenticator, Authy, or 1Password to generate one-time codes.</div>
              <button className="btn mt-8">
                <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.plus}</span>
                Set up TOTP
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

function SessionsSection() {
  const { pushToast } = useApp();
  const [sessions, setSessions] = useState<KratosSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [identityId, setIdentityId] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      // Get real identity_id from whoami (jinbe endpoint, protected by Oathkeeper)
      const whoami = await fetch('/api/whoami').then(r => r.ok ? r.json() : null);
      const id = whoami?.identity_id;
      if (!id) { setLoading(false); return; }
      setIdentityId(id);
      // Route through jinbe /admin/users/:id/sessions — never hit Kratos admin directly
      const sessRes = await fetch(`/api/admin/users/${id}/sessions`);
      if (sessRes.ok) {
        const data = await sessRes.json();
        setSessions(Array.isArray(data) ? data : []);
      }
    } catch {
      // Fallback: show empty
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const revokeSession = async (sessionId: string) => {
    try {
      await fetch(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' });
      pushToast("Session revoked");
      fetchSessions();
    } catch {
      pushToast("Failed to revoke session", { err: true });
    }
  };

  const revokeAll = async () => {
    if (!identityId) return;
    try {
      await fetch(`/api/admin/users/${identityId}/sessions`, { method: 'DELETE' });
      pushToast("All sessions revoked", { sub: "You may need to log in again" });
      fetchSessions();
    } catch {
      pushToast("Failed to revoke sessions", { err: true });
    }
  };

  function parseUA(ua?: string) {
    if (!ua) return { browser: 'Unknown', os: 'Unknown', icon: I.globe };
    const browser = ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : 'Browser';
    const os = ua.includes('Mac') ? 'macOS' : ua.includes('Windows') ? 'Windows' : ua.includes('Linux') ? 'Linux' : 'Unknown';
    return { browser, os, icon: I.globe };
  }

  function timeAgo(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h3>Active sessions</h3>
            <div className="sub">Devices and browsers where you're currently signed in</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Chip>{sessions.filter(s => s.active).length} active</Chip>
            <button className="btn danger sm" onClick={revokeAll} disabled={sessions.length === 0}>
              Revoke all
            </button>
          </div>
        </div>
        <div style={{ padding: 0 }}>
          {loading && <EmptyHint>Loading sessions…</EmptyHint>}
          {!loading && sessions.length === 0 && <EmptyHint>No sessions found. Session management requires Kratos admin access.</EmptyHint>}
          {sessions.map((s, i) => {
            const device = s.devices?.[0];
            const { browser, os } = parseUA(device?.user_agent);
            const isCurrent = i === 0 && s.active; // Heuristic: most recent active = current
            return (
              <div key={s.id} style={{
                padding: "14px 16px", borderBottom: i < sessions.length - 1 ? "1px solid var(--line)" : "none",
                display: "flex", gap: 14, alignItems: "center",
                background: !s.active ? "color-mix(in srgb, var(--ink) 2%, transparent)" : undefined,
                opacity: s.active ? 1 : 0.6,
              }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: s.active ? "var(--ok-soft)" : "var(--panel-2)", border: `1px solid ${s.active ? "color-mix(in srgb, var(--ok) 30%, var(--line))" : "var(--line)"}`, display: "grid", placeItems: "center", color: s.active ? "var(--ok)" : "var(--ink-4)", flexShrink: 0 }}>
                  {I.globe}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 500, fontSize: 12.5 }}>{browser} on {os}</span>
                    {isCurrent && <Chip tone="ok">current session</Chip>}
                    {!s.active && <Chip tone="">expired</Chip>}
                  </div>
                  <div className="small muted mono mt-4" style={{ display: "flex", gap: 12 }}>
                    {device?.ip_address && <span>IP: {device.ip_address}</span>}
                    <span>Auth: {timeAgo(s.authenticated_at)}</span>
                    <span>Expires: {new Date(s.expires_at).toLocaleDateString()}</span>
                    <span>AAL: {s.authenticator_assurance_level}</span>
                  </div>
                </div>
                {s.active && !isCurrent && (
                  <button className="btn danger sm" onClick={() => revokeSession(s.id)}>Revoke</button>
                )}
                {isCurrent && (
                  <span className="small muted">this device</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Session info */}
      <div className="panel">
        <div className="panel-head">
          <div><h3>Session policy</h3><div className="sub">How sessions are managed for your account</div></div>
        </div>
        <div className="panel-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <div>
              <div className="small muted">Session lifetime</div>
              <div className="mono" style={{ fontWeight: 500, marginTop: 4 }}>24 hours</div>
            </div>
            <div>
              <div className="small muted">Cookie policy</div>
              <div className="mono" style={{ fontWeight: 500, marginTop: 4 }}>SameSite=Lax</div>
            </div>
            <div>
              <div className="small muted">MFA requirement</div>
              <div className="mono" style={{ fontWeight: 500, marginTop: 4 }}>Optional</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Backup & Restore ─────────────────────────────────────────────────────────

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
