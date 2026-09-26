import type { ReactNode } from 'react';
import { Badge, ButtonBase, Callout, CodeView, EmptyState, I, Spinner, cx } from '../../components/ui';
import type { BadgeTone } from '../../components/ui';
import { notAvailable } from '../../api/sites';
import { describeApiError } from '../../lib/apiError';
import { HTTP_METHODS, type Access, type HttpMethod, type RiskLevel, type SiteStatus } from '../../lib/sites/types';
import { toggleMethod } from '../../lib/sites/paths';
import { accessWord, type CheckLevel } from '../../lib/sites/format';
import { gatewayHref, kindOfHandler } from '../../lib/gateway/logic';

/** Pieces every Sites screen shares: status, checks, methods, access, locked handlers, gaps. */

const STATUS: Record<SiteStatus, { tone: BadgeTone; icon: ReactNode; word: string }> = {
  live: { tone: 'success', icon: I.check, word: 'Live' },
  applying: { tone: 'info', icon: I.sync, word: 'Applying' },
  attention: { tone: 'warning', icon: I.alert, word: 'Needs attention' },
  draft: { tone: 'neutral', icon: I.edit, word: 'Draft' },
  paused: { tone: 'neutral', icon: I.clock, word: 'Paused' },
  platform: { tone: 'accent', icon: I.lock, word: 'System site' },
  legacy: { tone: 'warning', icon: I.box, word: 'Legacy' },
};

export function StatusBadge({ status }: { status: SiteStatus }) {
  const s = STATUS[status] ?? STATUS.draft;
  return <Badge tone={s.tone} icon={s.icon} mono={false}>{s.word}</Badge>;
}

const RISK_TONE: Record<RiskLevel, BadgeTone> = { low: 'success', medium: 'warning', high: 'danger' };
export function RiskBadge({ level }: { level: RiskLevel }) {
  return <Badge tone={RISK_TONE[level]} icon={level === 'low' ? I.check : I.alert} mono={false}>{level === 'low' ? 'Low risk' : level === 'medium' ? 'Medium risk' : 'High risk'}</Badge>;
}

export type CheckLine = { level: CheckLevel; text: ReactNode; action?: ReactNode };

const GLYPH: Record<CheckLine['level'], { icon: ReactNode; label: string }> = {
  ok: { icon: I.check, label: 'passed' },
  warn: { icon: I.alert, label: 'warning' },
  error: { icon: I.close, label: 'blocking' },
  pending: { icon: <Spinner />, label: 'checking' },
  info: { icon: I.info, label: 'note' },
};

/** ✓ / ⚠ / ✗ / ◌ lines — host check, probe, Review checks, Verify. A live region, announced once settled. */
export function CheckList({ lines, live = true, className }: { lines: CheckLine[]; live?: boolean; className?: string }) {
  if (lines.length === 0) return null;
  return (
    <ul className={cx('site-checks', className)} aria-live={live ? 'polite' : undefined}>
      {lines.map((l, i) => (
        <li key={i} className={cx('site-check', l.level)}>
          <span className="site-check-ico" role="img" aria-label={GLYPH[l.level].label}>{GLYPH[l.level].icon}</span>
          <span className="site-check-text">{l.text}</span>
          {l.action && <span className="site-check-action">{l.action}</span>}
        </li>
      ))}
    </ul>
  );
}


/** Methods as a toggle group (keys 1–7 when the group has focus, §10.8). */
export function MethodChips({ value, onChange, label = 'Methods', disabled }: {
  value: HttpMethod[]; onChange: (v: HttpMethod[]) => void; label?: string; disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="pills site-methods"
      onKeyDown={(e) => {
        const n = Number(e.key);
        if (n >= 1 && n <= HTTP_METHODS.length && !disabled) { e.preventDefault(); onChange(toggleMethod(value, HTTP_METHODS[n - 1])); }
      }}
    >
      {HTTP_METHODS.map((m) => (
        <ButtonBase key={m} className={cx('pill', 'mono', value.includes(m) && 'on')} aria-pressed={value.includes(m)} disabled={disabled} onClick={() => onChange(toggleMethod(value, m))}>
          {m}
        </ButtonBase>
      ))}
    </div>
  );
}

export function AccessBadge({ access }: { access: Access }) {
  const tone: BadgeTone = access.kind === 'public' ? 'warning' : access.kind === 'deny' ? 'danger' : access.kind === 'permission' ? 'accent' : 'neutral';
  return <Badge tone={tone} mono={access.kind === 'permission'}>{accessWord(access)}</Badge>;
}

// The chart values that switch a handler on (site-ux.md §7.2 locked card).
const ENABLE_SNIPPET: Record<string, string> = {
  jwt: 'oathkeeper.oathkeeper.config.authenticators.jwt:\n  enabled: true\n  config: { jwks_urls: [http://auth-hydra-public:4444/.well-known/jwks.json] }',
  anonymous: 'oathkeeper.oathkeeper.config.authenticators.anonymous:\n  enabled: true\n  config: { subject: anonymous }',
  oauth2_client_credentials: 'oathkeeper.oathkeeper.config.authenticators.oauth2_client_credentials:\n  enabled: true\n  config: { token_url: http://auth-hydra-public:4444/oauth2/token }',
  cookie: 'oathkeeper.oathkeeper.config.mutators.cookie:\n  enabled: true',
  id_token: 'oathkeeper.oathkeeper.config.mutators.id_token:\n  enabled: true\n  config: { issuer_url: …, jwks_url: file:///etc/secrets/jwks.json }',
  www_authenticate: 'oathkeeper.oathkeeper.config.errors.handlers.www_authenticate:\n  enabled: true',
  remote: 'oathkeeper.oathkeeper.config.authorizers.remote:\n  enabled: true   # jinbe must also accept the remote authorizer',
};
const ALTERNATIVE: Record<string, string> = {
  jwt: 'OAuth2 tokens (introspection) work with the same tokens.',
  oauth2_client_credentials: 'OAuth2 tokens (introspection) for machine callers.',
  anonymous: 'a Public route on a separate gate.',
};

/** A handler the gateway does not run: why, what it takes, the snippet, and the nearest alternative. */
export function LockedCallout({ handler }: { handler: string }) {
  const snippet = ENABLE_SNIPPET[handler] ?? `oathkeeper.oathkeeper.config.<kind>.${handler}:\n  enabled: true`;
  return (
    <Callout tone="neutral" icon={I.lock} title={`${handler} isn't enabled on this gateway`}>
      <p className="m-0">The gateway only runs the methods switched on in its platform config. A platform admin can switch it on in Gateway handlers (the gateway restarts one pod at a time); the equivalent chart values are below.</p>
      <CodeView code={snippet} title="values.yaml" language="yaml" className="mt-8" />
      {ALTERNATIVE[handler] && <p className="mt-8 mb-0 small">Until then you can use {ALTERNATIVE[handler]}</p>}
      {kindOfHandler(handler) && (
        <p className="mt-8 mb-0"><a href={gatewayHref(kindOfHandler(handler), handler)}>Enable in Gateway handlers {I.arrowOut}</a> — preview, apply and a rolling restart, from kuma.</p>
      )}
    </Callout>
  );
}

/** What a missing §14.2 endpoint looks like: said, not broken. */
export function NotAvailable({ what, compact = true }: { what: string; compact?: boolean }) {
  return (
    <EmptyState compact={compact} icon={I.clock} title="Not available yet">
      This server does not serve {what} yet. It is being built; nothing is wrong with this site.
    </EmptyState>
  );
}

/** One query's error, as a callout — "not available yet" for the router's 404. */
export function QueryError({ error, what }: { error: unknown; what: string }) {
  if (notAvailable(error)) return <NotAvailable what={what} />;
  const v = describeApiError(error);
  return <Callout tone="danger" icon={I.alert} title={v.title}>{v.detail}</Callout>;
}
