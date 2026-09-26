import { useEffect, useMemo, useState } from 'react';
import { Button, Callout, Card, I, PageHeader, Stepper } from '../../../components/ui';
import { useZones, sitesApi, useInvalidateSite, notAvailable } from '../../../api/sites';
import { goSites, sitesHref, WIZARD_STEPS, type WizardStep } from '../../../lib/sites/route';
import { addressProblems, loadWizard, siteFrom, WIZARD_STORE, type WizardState } from '../../../lib/sites/wizard';
import { useSitePerms } from '../usePerms';
import { useSiteAction } from '../useAction';
import { AddressStep } from './AddressStep';
import { KindStep } from './KindStep';
import { AccessStep } from './AccessStep';
import { WizardReview } from './WizardReview';

/**
 * Plug a site (site-ux.md §4): Address → Kind → Access → Review, aiming at a minute for the common
 * case. The answers live here while the steps change in the address bar (each step is a link); the
 * last step saves a server draft and hands over to the site's own Review, where it goes live.
 */

export function PlugWizard({ step }: { step: WizardStep; query: Record<string, string> }) {
  const perms = useSitePerms();
  const zones = useZones();
  const invalidate = useInvalidateSite();
  const { run, busy } = useSiteAction();
  const [s, setS] = useState<WizardState>(loadWizard);
  const patch = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));
  useEffect(() => { try { sessionStorage.setItem(WIZARD_STORE, JSON.stringify(s)); } catch { /* private mode */ } }, [s]);
  useEffect(() => {
    if (!s.zone && zones.data?.length) patch({ zone: zones.data[0].suffix });
  }, [zones.data, s.zone]);

  const problems = useMemo(() => addressProblems(s), [s]);
  const at = WIZARD_STEPS.indexOf(step);
  const to = (st: WizardStep) => goSites(sitesHref({ view: 'new', step: st }));
  // Never skip ahead past an unanswered address.
  useEffect(() => { if (at > 0 && problems.length > 0) to('address'); }, [at, problems.length]);

  if (!perms.canDraft) {
    return <Callout tone="info" icon={I.lock} title="Plugging a site needs a platform admin">You can look at sites; creating one needs admin:write.</Callout>;
  }

  const finish = async () => {
    const site = siteFrom(s);
    const out = await run('Save draft', () => sitesApi.putDraft(site.name, site, 0), `${site.displayName} saved as a draft`);
    if (out) {
      try { sessionStorage.removeItem(WIZARD_STORE); } catch { /* ignore */ }
      invalidate(site.name);
      goSites(sitesHref({ view: 'site', name: site.name, tab: 'review' }));
    }
  };

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow={<Button variant="ghost" size="sm" icon={I.caretLeft} onClick={() => goSites(sitesHref({ view: 'list' }))}>Sites</Button>}
        title="Plug a site"
        sub="Give it an address and tell us where it runs. Nothing goes live until you review it."
      />
      <Stepper
        className="mb-16"
        current={step}
        onStep={(id) => to(id as WizardStep)}
        steps={[{ id: 'address', label: 'Address' }, { id: 'kind', label: 'Kind' }, { id: 'access', label: 'Access' }, { id: 'review', label: 'Review' }]}
      />
      {zones.error ? (notAvailable(zones.error)
        ? <Callout tone="warning" icon={I.alert} className="mb-12">This server does not list zones yet; type the full zone below.</Callout>
        : <Callout tone="danger" icon={I.alert} className="mb-12">Zones could not be read.</Callout>) : null}
      <Card pad="md">
        {step === 'address' && <AddressStep s={s} patch={patch} zones={zones.data ?? []} problems={problems} />}
        {step === 'kind' && <KindStep s={s} patch={patch} />}
        {step === 'access' && <AccessStep s={s} patch={patch} />}
        {step === 'review' && <WizardReview site={siteFrom(s)} />}
        <div className="row gap-8 justify-end mt-16 wrap">
          {step === 'address' && problems.length === 0 && (
            <Button variant="ghost" onClick={() => { patch({ template: 'web-api' }); to('review'); }}>Use recommended setup → Review</Button>
          )}
          <Button onClick={() => (at === 0 ? goSites(sitesHref({ view: 'list' })) : to(WIZARD_STEPS[at - 1]))}>{at === 0 ? 'Cancel' : '← Back'}</Button>
          {step !== 'review'
            ? <Button variant="primary" disabled={problems.length > 0} onClick={() => to(WIZARD_STEPS[at + 1])}>Continue →</Button>
            : <Button variant="primary" loading={busy === 'Save draft'} onClick={() => void finish()}>Save draft &amp; review</Button>}
        </div>
      </Card>
    </div>
  );
}
