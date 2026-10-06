import { useApp } from '../contexts/AppContext';
import { useAuthMethods, useSetAuthMethods, useSession } from '../api/hooks';
import { holds } from '../policy/model';
import { I, Badge, Callout, Card, Checkbox, PageHeader, Switch } from '../components/ui';
import { stepUpOnRefusal } from '../lib/resume';
import type { AuthMethodName } from '../api/client';
import { ZonesSettings } from '../components/ZonesSettings';
import { SecondFactorSettings } from '../components/SecondFactorSettings';
import { SignInProtectionSettings } from '../components/SignInProtectionSettings';
import { McpSettings } from '../components/McpSettings';
import { OwnSecondFactor } from '../components/OwnSecondFactor';

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

export function SettingsPage() {
  const { pushToast } = useApp();
  // Each admin section asks only with the permission jinbe checks for it: a viewer (no
  // settings:read or zones:read since the role trim) got a page of 403s. Backup & restore has its own page.
  const { data: session } = useSession();
  const settingsRead = holds(session, 'settings:read');
  const zonesRead = holds(session, 'zones:read');
  const authDomain = (window as any).__AUTH_DOMAIN__ || '';
  const accountUrl = authDomain
    ? `https://${authDomain}/settings?return_to=${encodeURIComponent(window.location.href)}`
    : null;

  // ─── Kratos auth-method toggles (hot-reload; hidden when jinbe lacks KRATOS_CONFIG_PATH) ───
  const { data: authConfig, error: authMethodsError } = useAuthMethods({ enabled: settingsRead });
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
        onError: (e: Error) => {
          if (stepUpOnRefusal(e, pushToast, { redo: 'Change the sign-in method again: nothing was changed before the check.' })) return;
          pushToast(e.message || 'Failed to update auth methods', { err: true });
        },
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
        onError: (e: Error) => {
          if (stepUpOnRefusal(e, pushToast, { redo: `${enabled ? 'Enable' : 'Disable'} self-registration again: nothing was changed before the check.` })) return;
          pushToast(e.message || 'Failed to update registration', { err: true });
        },
      },
    );
  }

  return (
    <>
      <PageHeader title="Admin settings" sub="Admin operations." />
      <div className="stack gap-16">

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

      <OwnSecondFactor />

      {!settingsRead && !zonesRead && (
        <Callout tone="neutral" icon={I.lock} title="Nothing to administer here for your access">
          <div className="small">Your own account and two-step sign-in are above. The platform settings and zones need roles you don’t hold.</div>
        </Callout>
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
                      size="sm"
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

      {settingsRead && <SecondFactorSettings />}

      {settingsRead && <SignInProtectionSettings />}

      {settingsRead && <McpSettings />}

      {zonesRead && <ZonesSettings />}

      </div>
    </>
  );
}
