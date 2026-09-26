import { useEffect, useRef, useState } from 'react';
import { Segmented } from '../../../components/ui';
import { API_BASE } from '../../../api/client';

/**
 * A live sketch of the sign-in pages with this site's branding (site-ux.md §11.1). Drawn here, from
 * the draft, so it follows every keystroke; the real login-ui preview (iframe with a draft token)
 * replaces it when login-ui serves one. The accent is set as a CSS variable on the frame — the one
 * colour in the console that comes from data rather than the tokens.
 */

type State = 'signin' | 'step' | 'setup' | 'denied';

export function LoginPreview({ name, welcome, accent, helpUrl, logo, site }: {
  name: string; welcome?: string; accent?: string; helpUrl?: string; logo?: string; site: string;
}) {
  const [state, setState] = useState<State>('signin');
  const [logoOk, setLogoOk] = useState(true);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    if (accent) el.style.setProperty('--site-accent', accent); else el.style.removeProperty('--site-accent');
  }, [accent]);
  useEffect(() => setLogoOk(true), [logo]);

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
      <div ref={frame} className="site-login-preview" aria-label="Sign-in page preview">
        <div className="site-login-brand">
          {logo && logoOk
            ? <img src={`${API_BASE}/public/sites/${encodeURIComponent(site)}/logo`} alt="" className="site-login-logo" onError={() => setLogoOk(false)} />
            : <span className="site-login-logo placeholder" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
          <span className="fw-semibold">{name}</span>
        </div>
        <div className="fw-medium">{title}</div>
        {body && <div className="small">{body}</div>}
        {state === 'signin' && <div className="site-login-field" aria-hidden="true">email</div>}
        <div className="site-login-cta" aria-hidden="true">{cta}</div>
        {state === 'signin' && <div className="small muted">or · Passkey · Google</div>}
        <div className="site-login-foot small muted">
          <span>Platform sign-in · Stairling account</span>
          {helpUrl && <span>Need help? ↗</span>}
        </div>
      </div>
    </div>
  );
}
