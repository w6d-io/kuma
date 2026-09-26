import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Callout, Card, Checkbox, Field, I, Input, RadioGroup } from '../../../components/ui';
import { sitesApi, notAvailable } from '../../../api/sites';
import { accentProblem, helpUrlProblem, logoProblem, welcomeProblem } from '../../../lib/sites/validate';
import { displayPath } from '../../../lib/sites/paths';
import type { Site, SiteLogin } from '../../../lib/sites/types';
import type { SiteEditor } from '../useSiteEditor';
import { CheckList, type CheckLine } from '../parts';
import { LoginPreview } from './LoginPreview';

/**
 * Login (site-ux.md §11): what is shared by every site on the cookie domain (said, not editable),
 * and the two per-site choices of the first release — required second factor and branding of the
 * sign-in pages — with a live preview. People reach the site only as the route model allows.
 */

const DEFAULT_LOGIN: SiteLogin = { twoFactor: { scope: 'none', clients: 'exempt' }, reach: 'granted' };

export function LoginTab({ ed, readOnly }: { ed: SiteEditor; readOnly: boolean }) {
  const site = ed.site;
  const readiness = useQuery({ queryKey: ['sites', 'login-readiness', ed.name], queryFn: () => sitesApi.loginReadiness(ed.name), retry: false, enabled: !!site });
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  if (!site) return <Callout tone="warning" icon={I.alert}>This draft is incomplete.</Callout>;

  const login = site.login ?? DEFAULT_LOGIN;
  const branding = login.branding ?? {};
  const setLogin = (fn: (l: SiteLogin) => SiteLogin) => ed.update((s: Site) => ({ ...s, login: fn(s.login ?? DEFAULT_LOGIN) }));
  const setBranding = (patch: Partial<NonNullable<SiteLogin['branding']>>) => setLogin((l) => {
    const next = { ...(l.branding ?? {}), ...patch };
    for (const k of Object.keys(next) as Array<keyof typeof next>) if (!next[k]) delete next[k];
    return { ...l, branding: Object.keys(next).length ? next : undefined };
  });
  const tf = login.twoFactor;
  const routes = site.routes.items;
  const accent = branding.accent ? accentProblem(branding.accent) : null;

  const readyLines: CheckLine[] = [];
  if (tf.scope !== 'none' || (tf.routes?.length ?? 0) > 0) {
    if (readiness.data) {
      const r = readiness.data;
      readyLines.push({ level: r.without2fa.length ? 'warn' : 'ok', text: `${r.with2fa} of ${r.withAccess} people with access have 2FA set up.${r.without2fa.length ? ` ${r.without2fa.length} will be asked to set it up first.` : ''}` });
    } else if (notAvailable(readiness.error)) {
      readyLines.push({ level: 'info', text: 'How many people already have 2FA is not available on this server yet.' });
    }
  }

  async function upload(file: File) {
    const problem = logoProblem(file);
    if (problem) { setLogoError(problem); return; }
    setLogoError(null);
    setUploading(true);
    try {
      const out = await sitesApi.uploadLogo(ed.name, file);
      setBranding({ logo: out.logo });
    } catch (err) {
      setLogoError(notAvailable(err) ? 'Logo upload is not available on this server yet.' : (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="stack gap-16">
      <Callout tone="neutral" icon={I.users} title="Shared by every site on this domain">
        One account and one sign-in page for every site here — that’s what lets people move between sites without signing in again. Sign-in methods, sign-up, recovery, session length and the bot check are platform settings (Settings → Sign-in). Each site can ask for a second step and show its own name and logo.
      </Callout>

      <Card title="Two-factor sign-in" sub="Applies to everyone, super admins included.">
        <div className="stack gap-12">
          <RadioGroup<'none' | 'writes' | 'all' | 'routes'> label="Two-factor sign-in" name="tf-scope" value={tf.scope} disabled={readOnly} onChange={(scope) => setLogin((l) => ({ ...l, twoFactor: { ...l.twoFactor, scope } }))} options={[
            { value: 'none', label: 'Not required' },
            { value: 'writes', label: 'Required for changes', hint: 'POST · PUT · PATCH · DELETE need 2FA; reading doesn’t' },
            { value: 'all', label: 'Required for everything', hint: 'every signed-in route needs 2FA' },
            { value: 'routes', label: 'Only on chosen routes', hint: 'pick them below' },
          ]} />
          {tf.scope !== 'all' && routes.length > 0 && (
            <fieldset className="site-fieldset">
              <legend className="small fw-medium">{tf.scope === 'routes' ? 'Required on these routes' : 'Also required on these routes'}</legend>
              <div className="site-route-picks">
                {routes.map((r) => (
                  <Checkbox key={r.id} disabled={readOnly} label={<span className="mono small">{r.methods.join(' ')} {displayPath(r.path)}</span>} checked={!!tf.routes?.includes(r.id)} onChange={(on) => setLogin((l) => {
                    const cur = l.twoFactor.routes ?? [];
                    const next = on ? [...cur, r.id] : cur.filter((x) => x !== r.id);
                    return { ...l, twoFactor: { ...l.twoFactor, routes: next.length ? next : undefined } };
                  })} />
                ))}
              </div>
            </fieldset>
          )}
          <RadioGroup<'exempt' | 'refused'> label="API tokens from OAuth2 clients" name="tf-clients" value={tf.clients} disabled={readOnly} onChange={(clients) => setLogin((l) => ({ ...l, twoFactor: { ...l.twoFactor, clients } }))} options={[
            { value: 'exempt', label: 'OAuth2 clients are exempt', hint: 'machines can’t do 2FA' },
            { value: 'refused', label: 'OAuth2 clients are refused' },
          ]} />
          <p className="small m-0">What people see: “{branding.name || site.displayName} needs a second step” → they confirm with their app or passkey, or set one up first, then land back where they were.</p>
          <CheckList lines={readyLines} />
        </div>
      </Card>

      <Card title="Sign-in pages show" sub="Cosmetic only — never an access decision. The platform sign-in address stays visible (anti-phishing).">
        <div className="site-login-grid">
          <div className="stack gap-12">
            <Field label="Name" hint="Defaults to the display name.">
              <Input value={branding.name ?? ''} placeholder={site.displayName} maxLength={80} disabled={readOnly} onChange={(e) => setBranding({ name: e.target.value })} />
            </Field>
            <Field label="Logo" hint="PNG or WebP, 256 KB at most, square, at least 128 px. SVG is refused." error={logoError ?? undefined}>
              <div className="row gap-8 items-center">
                <span className="small">{branding.logo ? <span className="mono">{branding.logo}</span> : 'none'}</span>
                {!readOnly && <>
                  <input ref={fileRef} type="file" accept="image/png,image/webp" className="sr-only" aria-label="Logo file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
                  <Button size="sm" icon={I.upload} loading={uploading} onClick={() => fileRef.current?.click()}>{branding.logo ? 'Replace' : 'Upload'}</Button>
                  {branding.logo && <Button size="sm" variant="ghost" onClick={async () => {
                    try { await sitesApi.deleteLogo(ed.name); } catch (err) { if (!notAvailable(err)) { setLogoError((err as Error).message); return; } }
                    setBranding({ logo: undefined });
                  }}>Remove</Button>}
                </>}
              </div>
            </Field>
            <Field
              label="Accent"
              hint={accent && !accent.problem ? `Contrast ${accent.light.toFixed(1)}:1 on light, ${accent.dark.toFixed(1)}:1 on dark ✓` : 'A #rrggbb colour with 4.5:1 contrast on light and dark.'}
              error={accent?.problem ?? undefined}
            >
              <Input mono value={branding.accent ?? ''} placeholder="#rrggbb" maxLength={7} disabled={readOnly} onChange={(e) => setBranding({ accent: e.target.value.trim() })} />
            </Field>
            <Field label="Welcome" hint="80 characters at most, plain text." error={branding.welcome ? welcomeProblem(branding.welcome) ?? undefined : undefined}>
              <Input value={branding.welcome ?? ''} placeholder={`Sign in to continue to ${branding.name || site.displayName}`} disabled={readOnly} onChange={(e) => setBranding({ welcome: e.target.value })} />
            </Field>
            <Field label="Help link" hint="Optional, https:// only." error={helpUrlProblem(branding.helpUrl ?? '') ?? undefined}>
              <Input mono value={branding.helpUrl ?? ''} placeholder={`https://${site.address.host}/help`} disabled={readOnly} onChange={(e) => setBranding({ helpUrl: e.target.value.trim() })} />
            </Field>
          </div>
          <LoginPreview name={branding.name || site.displayName} welcome={branding.welcome} accent={accent && !accent.problem ? branding.accent : undefined} helpUrl={branding.helpUrl} logo={branding.logo} site={site.name} />
        </div>
      </Card>

      <Card title="Who can reach it after signing up">
        <RadioGroup<'granted' | 'any-account'> label="Who can reach it after signing up" name="reach" value={login.reach} disabled={readOnly} onChange={(reach) => setLogin((l) => ({ ...l, reach }))} options={[
          { value: 'granted', label: 'Only people given access (groups / org grants)' },
          { value: 'any-account', label: 'Anyone with an account', hint: 'routes marked Signed-in are open to every account' },
        ]} />
        <Field label="After sign-out send people to" className="mt-12" hint="Must be an allowed return address of the sign-in service." error={login.postLogoutUrl && !/^https:\/\//.test(login.postLogoutUrl) ? 'An https:// address.' : undefined}>
          <Input mono value={login.postLogoutUrl ?? ''} placeholder={`https://${site.address.host}/`} disabled={readOnly} onChange={(e) => setLogin((l) => ({ ...l, postLogoutUrl: e.target.value.trim() || undefined }))} />
        </Field>
      </Card>
      <p className="small muted">Per-site 2FA and branding are stored with the site; publishing them to the policy engine and the sign-in pages ships with the login release (S-4).</p>
    </div>
  );
}
