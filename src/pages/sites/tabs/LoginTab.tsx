import { Callout, Card, Checkbox, Field, FormGrid, I, Input, RadioGroup } from '../../../components/ui';
import { helpUrlProblem, welcomeProblem } from '../../../lib/sites/validate';
import { displayPath } from '../../../lib/sites/paths';
import type { SiteEditor } from '../useSiteEditor';
import { BrandFields } from './BrandFields';
import { useBrand } from './brand';
import { LoginPreview } from './LoginPreview';

/**
 * Login (site-ux.md §11): what is shared by every site on the cookie domain (said, not editable),
 * and the two per-site choices of the first release — required second factor and branding of the
 * sign-in pages — with a live preview. People reach the site only as the route model allows. The
 * brand fields are the same editor as on Settings (BrandFields); welcome and help link are sign-in
 * only, so they live here alone.
 */

export function LoginTab({ ed, readOnly }: { ed: SiteEditor; readOnly: boolean }) {
  const site = ed.site;
  const { login, branding, setLogin, setBranding, shown } = useBrand(ed);
  if (!site) return <Callout tone="warning" icon={I.alert}>This draft is incomplete.</Callout>;

  const tf = login.twoFactor;
  const routes = site.routes.items;

  return (
    <div className="stack gap-16">
      <Callout tone="neutral" icon={I.users} title="Shared by every site on this domain">
        One account and one sign-in page for every site here — that’s what lets people move between sites without signing in again. Sign-in methods, sign-up, recovery, session length and the bot check are platform settings (Settings → Sign-in). Each site can ask for a second step and show its own name and logo.
      </Callout>

      <Card title="Two-factor sign-in" sub="Applies to everyone, whatever their groups.">
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
          <p className="small m-0">What people see: “{shown.name} needs a second step” → they confirm with their app or passkey, or set one up first, then land back where they were.</p>
        </div>
      </Card>

      <Card title="Sign-in pages show" sub="Cosmetic only — never an access decision. The platform sign-in address stays visible (anti-phishing).">
        <div className="site-login-grid">
          <FormGrid>
            <BrandFields ed={ed} readOnly={readOnly} />
            <Field label="Welcome" hint="80 characters at most, plain text." error={branding.welcome ? welcomeProblem(branding.welcome) ?? undefined : undefined}>
              <Input value={branding.welcome ?? ''} placeholder={`Sign in to continue to ${shown.name}`} disabled={readOnly} onChange={(e) => setBranding({ welcome: e.target.value })} />
            </Field>
            <Field label="Help link" hint="Optional, https:// only." error={helpUrlProblem(branding.helpUrl ?? '') ?? undefined}>
              <Input mono value={branding.helpUrl ?? ''} placeholder={`https://${site.address.host}/help`} disabled={readOnly} onChange={(e) => setBranding({ helpUrl: e.target.value.trim() })} />
            </Field>
          </FormGrid>
          <LoginPreview name={shown.name} welcome={branding.welcome} accent={shown.accent} accentText={shown.accentText} helpUrl={branding.helpUrl} logo={branding.logo} site={site.name} />
        </div>
      </Card>

      <Card title="Who can reach it after signing up">
        <RadioGroup<'granted' | 'any-account'> label="Who can reach it after signing up" name="reach" value={login.reach} disabled={readOnly} onChange={(reach) => setLogin((l) => ({ ...l, reach }))} options={[
          { value: 'granted', label: 'Only people given access (groups / org grants)' },
          { value: 'any-account', label: 'Anyone with an account', hint: 'routes marked Signed-in are open to every account' },
        ]} />
        <Field label="After sign-out send people to" className="mt-16" hint="Must be an allowed return address of the sign-in service." error={login.postLogoutUrl && !/^https:\/\//.test(login.postLogoutUrl) ? 'An https:// address.' : undefined}>
          <Input mono value={login.postLogoutUrl ?? ''} placeholder={`https://${site.address.host}/`} disabled={readOnly} onChange={(e) => setLogin((l) => ({ ...l, postLogoutUrl: e.target.value.trim() || undefined }))} />
        </Field>
      </Card>
      <p className="small muted">Per-site 2FA and branding are stored with the site; publishing them to the policy engine and the sign-in pages ships with the login release (S-4).</p>
    </div>
  );
}
