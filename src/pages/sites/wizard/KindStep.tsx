import { useState } from 'react';
import { Button, ButtonBase, Checkbox, Drawer, I, cx } from '../../../components/ui';
import { TEMPLATES, buildSite, type TemplateId } from '../../../lib/sites/templates';
import { displayPath } from '../../../lib/sites/paths';
import type { WizardState } from '../../../lib/sites/wizard';
import { AccessBadge, LockedCallout } from '../parts';

/**
 * Step 2 — Kind (site-ux.md §4.2): pick a template; see the gates and routes it makes. Templates
 * that need a handler the gateway does not run are listed locked, each leading to the change it
 * needs.
 */

const LOCKED: Array<{ label: string; handler: string; why: string }> = [
  { label: 'API with JWT', handler: 'jwt', why: 'needs the jwt sign-in method enabled on the gateway' },
  { label: 'Machine-to-machine with client id + secret', handler: 'oauth2_client_credentials', why: 'needs oauth2_client_credentials' },
  { label: 'Optional sign-in', handler: 'anonymous', why: 'needs the anonymous sign-in method' },
];

export function KindStep({ s, patch }: { s: WizardState; patch: (p: Partial<WizardState>) => void }) {
  const [locked, setLocked] = useState<string | null>(null);
  const t = TEMPLATES.find((x) => x.id === s.template)!;
  const preview = buildSite(s.template, { name: s.name, displayName: s.displayName, host: `${s.label}.${s.zone}`, pathPrefix: s.pathPrefix || undefined, service: s.service, namespace: s.namespace, port: Number(s.port) }, { shellPublic: s.shellPublic });

  return (
    <div className="stack gap-16">
      <h2 className="text-lg m-0">What is {s.displayName || s.name}?</h2>
      <div role="radiogroup" aria-label="Kind of site" className="site-choices">
        {TEMPLATES.map((x) => (
          <ButtonBase key={x.id} role="radio" aria-checked={x.id === s.template} className={cx('site-choice', x.id === s.template && 'on')} onClick={() => patch({ template: x.id as TemplateId })}>
            <span className="fw-medium">{x.label}</span>
            <span className="small muted">{x.hint}</span>
          </ButtonBase>
        ))}
        {LOCKED.map((x) => (
          <ButtonBase key={x.handler} className="site-choice locked" onClick={() => setLocked(x.handler)} aria-label={`${x.label} — locked, ${x.why}`}>
            <span className="fw-medium"><span aria-hidden="true">{I.lock}</span> {x.label}</span>
            <span className="small muted">{x.why} — how to enable</span>
          </ButtonBase>
        ))}
      </div>
      {s.template === 'spa-api' && (
        <Checkbox label="Show the app shell before sign-in" hint="The shell is public; the API still needs a session or a token." checked={s.shellPublic} onChange={(on) => patch({ shellPublic: on })} />
      )}

      <div className="site-kind-summary">
        <dl className="site-kv">
          <dt>Gates</dt><dd>{t.gates}</dd>
          <dt>Routes</dt><dd>{t.routes}</dd>
          <dt>Roles</dt><dd>admin · editor · viewer (standard)</dd>
          <dt>Errors</dt><dd>{t.errors}</dd>
        </dl>
        <ul className="site-list small" aria-label="Routes preview">
          {preview.routes.items.map((r) => (
            <li key={r.id} className="row gap-8 items-center"><span className="mono">{r.methods.slice(0, 2).join(' ')}{r.methods.length > 2 ? '…' : ''}</span><span className="mono">{displayPath(r.path)}</span><AccessBadge access={r.access} /></li>
          ))}
          <li className="row gap-8 items-center"><span className="mono">∗</span><span>everything else</span><AccessBadge access={preview.routes.catchAll.access} /></li>
        </ul>
      </div>

      <Drawer open={!!locked} onClose={() => setLocked(null)} title="Needs a platform change" footer={<Button onClick={() => { setLocked(null); patch({ template: 'api' }); }}>Use OAuth2 tokens instead</Button>}>
        {locked && <LockedCallout handler={locked} />}
      </Drawer>
    </div>
  );
}
