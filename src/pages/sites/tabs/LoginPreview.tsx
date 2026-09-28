import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Segmented } from '../../../components/ui';
import { API_BASE } from '../../../api/client';

/**
 * A live sketch of the sign-in pages with this site's branding (site-ux.md §11.1). Drawn here, from
 * the draft, so it follows every keystroke; the real login-ui preview (iframe with a draft token)
 * replaces it when login-ui serves one. The accent is set as a CSS variable on the frame — the one
 * colour in the console that comes from data rather than the tokens. BrandPreview is the small
 * version Settings shows beside the brand fields: the mark and a button, nothing else.
 */

/**
 * The preview surface, with the site's accent (when it passes) as `--site-accent` and the label
 * colour login-ui puts on it (white or ink) as `--site-accent-text`.
 */
function Frame({ accent, accentText, label, children }: { accent?: string; accentText?: string; label: string; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    for (const [k, v] of [['--site-accent', accent], ['--site-accent-text', accentText]] as const) {
      if (v) el.style.setProperty(k, v); else el.style.removeProperty(k);
    }
  }, [accent, accentText]);
  return <div ref={frame} className="site-login-preview" aria-label={label}>{children}</div>;
}

/** The logo (or its initial on the accent when there is none, or it does not load) and the name. */
function BrandMark({ name, logo, site }: { name: string; logo?: string; site: string }) {
  const [logoOk, setLogoOk] = useState(true);
  useEffect(() => setLogoOk(true), [logo]);
  return (
    <div className="site-login-brand">
      {logo && logoOk
        ? <img src={`${API_BASE}/public/sites/${encodeURIComponent(site)}/logo`} alt="" className="site-login-logo" onError={() => setLogoOk(false)} />
        : <span className="site-login-logo placeholder" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
      <span className="fw-semibold">{name}</span>
    </div>
  );
}

export function BrandPreview({ name, accent, accentText, logo, site }: { name: string; accent?: string; accentText?: string; logo?: string; site: string }) {
  return (
    <Frame accent={accent} accentText={accentText} label="Brand preview">
      <BrandMark name={name} logo={logo} site={site} />
      <div className="small">Sign in to continue to {name}</div>
      <div className="site-login-cta" aria-hidden="true">Continue</div>
    </Frame>
  );
}

type State = 'signin' | 'step' | 'setup' | 'denied';

export function LoginPreview({ name, welcome, accent, accentText, helpUrl, logo, site }: {
  name: string; welcome?: string; accent?: string; accentText?: string; helpUrl?: string; logo?: string; site: string;
}) {
  const [state, setState] = useState<State>('signin');

  const title = state === 'signin' ? welcome || `Sign in to continue to ${name}`
    : state === 'step' ? `${name} needs a second step.`
    : state === 'setup' ? `Set up two-factor sign-in to use ${name}.`
    : `You don’t have access to ${name} yet.`;
  const body = state === 'signin' ? null
    : state === 'step' ? 'Confirm it’s you with your authenticator app or passkey.'
    : state === 'setup' ? 'It takes a minute and protects your account on every site.'
    : 'Ask your administrator. Signed in as nina@acme.example.';
  const cta = state === 'signin' ? 'Continue' : state === 'step' ? 'Use my passkey' : state === 'setup' ? 'Set it up' : 'Switch account';

  return (
    <div className="stack gap-8">
      <Segmented label="Preview page" value={state} onChange={setState} options={[
        { value: 'signin', label: 'Sign in' }, { value: 'step', label: '2FA step' }, { value: 'setup', label: 'Set up 2FA' }, { value: 'denied', label: 'No access' },
      ]} />
      <Frame accent={accent} accentText={accentText} label="Sign-in page preview">
        <BrandMark name={name} logo={logo} site={site} />
        <div className="fw-medium">{title}</div>
        {body && <div className="small">{body}</div>}
        {state === 'signin' && <div className="site-login-field" aria-hidden="true">email</div>}
        <div className="site-login-cta" aria-hidden="true">{cta}</div>
        {state === 'signin' && <div className="small muted">or · Passkey · Google</div>}
        <div className="site-login-foot small muted">
          <span>Platform sign-in · example account</span>
          {helpUrl && <span>Need help? ↗</span>}
        </div>
      </Frame>
    </div>
  );
}
