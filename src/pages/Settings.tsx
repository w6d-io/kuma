import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';

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
    </>
  );
}
