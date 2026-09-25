/**
 * A Kratos session, as jinbe proxies it, reduced to what an operator decides a revoke on: when it
 * started, how, and from where.
 */
export interface KratosSession {
  id: string;
  active?: boolean;
  authenticated_at?: string;
  expires_at?: string;
  authentication_methods?: { method?: string }[];
  devices?: { ip_address?: string; user_agent?: string; location?: string }[];
}

export interface SessionRow {
  id: string;
  active: boolean;
  started?: string;
  expires?: string;
  methods: string[];
  device: string;
}

const METHOD_LABEL: Record<string, string> = {
  password: 'password',
  totp: 'authenticator app',
  webauthn: 'security key',
  passkey: 'passkey',
  lookup_secret: 'backup code',
  code: 'email code',
  link_recovery: 'recovery link',
  code_recovery: 'recovery code',
  oidc: 'single sign-on',
};

/** A user agent reduced to "Browser on OS" — enough to recognise a device, no more. */
export function describeAgent(ua: string | undefined): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /curl\//.test(ua) ? 'curl'
    : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}

export function summarizeSession(s: KratosSession): SessionRow {
  const d = s.devices?.[0];
  const where = [d?.ip_address, d?.location].filter(Boolean).join(' · ');
  return {
    id: s.id,
    active: s.active !== false,
    started: s.authenticated_at,
    expires: s.expires_at,
    methods: (s.authentication_methods ?? [])
      .map((m) => (m.method ? METHOD_LABEL[m.method] ?? m.method : ''))
      .filter(Boolean),
    device: where ? `${describeAgent(d?.user_agent)} · ${where}` : describeAgent(d?.user_agent),
  };
}
