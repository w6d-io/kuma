import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Callout, Checkbox, Dialog, Field, FieldRow, FormGrid, I, Input, Select } from '../../components/ui';
import { useApp } from '../../contexts/AppContext';
import { sitesApi, checksOf, notAvailable, useInvalidateSite, useZones, type SiteError } from '../../api/sites';
import { addressOf, addressUrl, formOf, formProblems, groupChecks, linksToMove, sameAddress, withAddress, type AddressForm } from '../../lib/sites/address';
import type { Check, Preview } from '../../lib/sites/types';
import type { SiteEditor } from './useSiteEditor';
import { CheckList, RiskBadge, type CheckLine } from './parts';
import { describeSiteError, publishAction, useSiteAction } from './useAction';
import { stepUpAndResume } from '../../lib/resume';
import { goSites, sitesHref } from '../../lib/sites/route';

/**
 * Edit address (Settings, and the address in the site header): label, zone and path prefix of a site
 * that may already be live. Every check jinbe has runs against the NEW address before anything is
 * saved — rule overlaps with every live rule, other Ingresses and sites on that host, the zone, the
 * landing page — grouped by severity, with what the move costs said in words. Save as a draft, or
 * save and apply at once (super admin, recent second factor).
 */

type PreviewState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'ok'; preview: Preview }
  | { state: 'failed'; message: string };

const PREVIEW_MS = 300;

function lines(checks: readonly Check[], fix: (c: Check) => (() => void) | null): CheckLine[] {
  return checks.map((c) => {
    const onFix = fix(c);
    return {
      level: c.level === 'error' ? 'error' : 'warn',
      text: c.message,
      ...(onFix ? { action: <Button size="sm" onClick={onFix}>Move it</Button> } : {}),
    };
  });
}

export function EditAddressDialog({ ed, open, onClose, canApply, onApplied }: {
  ed: SiteEditor; open: boolean; onClose: () => void; canApply: boolean; onApplied?: () => void;
}) {
  const site = ed.site;
  const zonesQ = useZones();
  const zoneNames = useMemo(() => (zonesQ.data ?? []).map((z) => z.suffix), [zonesQ.data]);
  const { pushToast } = useApp();
  const invalidate = useInvalidateSite();
  const { run } = useSiteAction();
  const [applying, setApplying] = useState(false);
  const [form, setForm] = useState<AddressForm>({ label: '', zone: '', pathPrefix: '' });
  const [moveLinks, setMoveLinks] = useState(true);
  const [preview, setPreview] = useState<PreviewState>({ state: 'idle' });
  const [failure, setFailure] = useState<{ message: string; checks: Check[] } | null>(null);

  // Open: start from the address being edited now (a draft's, else the saved one).
  const start = site?.address;
  useEffect(() => {
    if (open && start) { setForm(formOf(start, zoneNames)); setMoveLinks(true); setFailure(null); setPreview({ state: 'idle' }); }
    // zoneNames arrive once; re-deriving the form on every keystroke of the host would undo typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, start?.host, start?.pathPrefix, zoneNames.join(',')]);

  const problems = formProblems(form);
  const valid = Object.keys(problems).length === 0;
  const to = addressOf(form);
  // Measured from the saved address (a draft may already hold part of the move); jinbe measures the
  // cost from the applied one, which address_changed carries.
  const live = !!ed.detail.data?.applied;
  const from = ed.saved?.address ?? start;
  const base = site && from ? { ...site, address: from } : null;
  const changed = !!base && valid && !sameAddress(base.address, to);
  const links = base ? linksToMove(base, to) : [];
  const candidate = base && valid ? withAddress(base, to, moveLinks) : null;
  const key = candidate ? JSON.stringify(candidate) : '';

  // Every check against the new address, debounced like the editor's own preview.
  useEffect(() => {
    if (!open || !candidate || !changed) { setPreview({ state: 'idle' }); return; }
    let cancelled = false;
    setPreview({ state: 'running' });
    const t = setTimeout(async () => {
      try {
        const out = await sitesApi.preview(candidate);
        if (!cancelled) setPreview({ state: 'ok', preview: out });
      } catch (err) {
        if (cancelled) return;
        const e = err as SiteError;
        setPreview({ state: 'failed', message: e.status === 503 ? 'Checks are unavailable (gatekit did not answer), so the address cannot change right now. Nothing was changed.' : notAvailable(err) ? 'This server has no preview yet.' : e.message });
      }
    }, PREVIEW_MS);
    return () => { cancelled = true; clearTimeout(t); };
    // key stands for the candidate by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, changed]);

  if (!site) return null;

  const checks = preview.state === 'ok' ? preview.preview.checks : [];
  const { blocking, warnings } = groupChecks(checks);
  const move = checks.find((c) => c.code === 'address_changed')?.address;
  const ready = changed && preview.state === 'ok' && blocking.length === 0;
  const others = ed.changes.filter((c) => c !== 'address');
  const fix = (c: Check) => (c.fix && !moveLinks && links.some((l) => `login.${l.field}` === c.fix!.path) ? () => setMoveLinks(true) : null);
  const zoneOptions = form.zone && !zoneNames.includes(form.zone) ? [form.zone, ...zoneNames] : zoneNames;

  function draft() {
    if (!candidate) return;
    ed.update(() => candidate);
    pushToast('Address change drafted', { sub: 'Review & apply it when you are ready; visitors still reach the old address.' });
    onClose();
  }

  // As Review's apply: save the version, then apply it. A missing second factor after the save leaves
  // that version saved and not live: Review says so, and publishes it by itself after the step-up.
  async function saveAndApply() {
    if (!candidate) return;
    setApplying(true);
    setFailure(null);
    let savedVersion: number | null = null;
    try {
      await ed.settle();
      const saved = await sitesApi.save(ed.name, candidate, { note: `address ${addressUrl(from ?? to)} → ${addressUrl(to)}`, etag: ed.detail.data?.etag });
      savedVersion = saved.version;
      ed.reset();
      await sitesApi.apply(ed.name, saved.version);
      pushToast(`Address changed to ${addressUrl(to)}`, { sub: 'The gateway moves the rules now; follow it on Status.' });
      onClose();
      onApplied?.();
    } catch (err) {
      if ((err as SiteError).code === 'reauth_required' && savedVersion != null) {
        onClose();
        goSites(sitesHref({ view: 'site', name: ed.name, tab: 'review' }));
        if (stepUpAndResume(publishAction(ed.name), { version: savedVersion })) {
          pushToast('Confirm it’s you', { err: true, sub: `v${savedVersion} (the new address) is saved but not live yet. Taking you to prove your second factor; back here it is published by itself.`, ttl: 4000 });
        }
      } else if ((err as SiteError).code === 'reauth_required') {
        await run('Apply', () => Promise.reject(err));
      }
      setFailure({ message: describeSiteError(err), checks: checksOf(err) });
    } finally {
      setApplying(false);
      invalidate(ed.name);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow={site.displayName}
      title="Edit address"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={!changed || !valid} onClick={draft}>Save as draft</Button>
        {canApply && <Button variant="primary" disabled={!ready} loading={applying} onClick={() => void saveAndApply()}>Save and apply</Button>}
      </>}
    >
      <div className="stack gap-16">
        <p className="m-0 small">
          Now: <span className="mono">{move?.from.url ?? (from ? addressUrl(from) : '—')}</span>{' '}
          {live ? <Badge tone="success" mono={false}>Live</Badge> : <Badge tone="neutral" mono={false}>Not live yet</Badge>}
        </p>
        <FormGrid>
          <FieldRow>
            <Field label="Label" span={2} error={form.label ? problems.label : undefined}>
              <Input mono autoFocus value={form.label} placeholder="payroll" onChange={(e) => setForm({ ...form, label: e.target.value.toLowerCase().trim() })} />
            </Field>
            <Field label="Zone" span={2} error={problems.zone} hint={zonesQ.isLoading ? 'Loading zones…' : undefined}>
              <Select mono value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}>
                {zoneOptions.map((z) => <option key={z} value={z}>.{z}</option>)}
              </Select>
            </Field>
            <Field label="Path prefix" hint="Only to share a host." error={problems.pathPrefix}>
              <Input mono value={form.pathPrefix} placeholder="/" onChange={(e) => setForm({ ...form, pathPrefix: e.target.value.trim() === '/' ? '' : e.target.value.trim() })} />
            </Field>
          </FieldRow>
          <p className="m-0 small" aria-live="polite">
            New address: <span className="mono fw-medium">{valid ? addressUrl(to) : '—'}</span>
            {valid && !changed && <span className="muted"> (unchanged)</span>}
          </p>
          {links.length > 0 && (
            <Checkbox
              checked={moveLinks}
              onChange={setMoveLinks}
              label="Move the site’s links to the new address"
              hint={links.map((l) => `${l.label}: ${l.from} → ${l.to}`).join(' · ')}
            />
          )}
        </FormGrid>

        {changed && move && (
          <Callout tone="warning" icon={I.alert} title="The old address stops working">
            Once applied, <span className="mono">{move.from.url}</span> no longer answers (404) and visitors reach the site at <span className="mono">{move.to.url}</span>
            {move.from.zone !== move.to.zone ? <> in zone <span className="mono">{move.to.zone ?? '—'}</span></> : null}.
            {' '}Bookmarks, links in emails and documents, and OAuth redirect URIs registered for the old address break — update them in the apps and identity providers that use it.
          </Callout>
        )}

        {changed && (
          <section aria-label="Checks" className="stack gap-8">
            {preview.state === 'running' || preview.state === 'idle' ? <CheckList lines={[{ level: 'pending', text: 'Checking the new address against every live rule, Ingress, site and zone…' }]} />
              : preview.state === 'failed' ? <Callout tone="danger" icon={I.alert}>{preview.message}</Callout>
              : <>
                <div className="row gap-8 items-center wrap">
                  <RiskBadge level={preview.preview.risk.level} />
                  <span className="small">{blocking.length} blocking · {warnings.length} warning{warnings.length === 1 ? '' : 's'}</span>
                </div>
                {blocking.length > 0 && <div><h3 className="small fw-medium m-0">Blocking — fix these first</h3><CheckList lines={lines(blocking, fix)} /></div>}
                {warnings.length > 0 && <div><h3 className="small fw-medium m-0">Warnings</h3><CheckList lines={lines(warnings, fix)} /></div>}
                {blocking.length === 0 && <CheckList lines={[{ level: 'ok', text: 'Patterns compile and overlap no live rule, before, during and after the move; no other Ingress or site holds the host; the zone covers it.' }]} />}
              </>}
          </section>
        )}

        {others.length > 0 && (
          <Callout tone="info" icon={I.info}>This draft has other unapplied changes ({others.join(', ')}); they are saved{canApply ? ' and applied' : ''} with the address.</Callout>
        )}
        {!canApply && changed && <p className="small muted m-0">Applying needs a super admin: save it as a draft, then request apply in Review.</p>}
        {failure && (
          <Callout tone="danger" icon={I.alert} title="The address was not changed">
            {failure.message}
            {failure.checks.length > 0 && <CheckList className="mt-8" lines={lines(failure.checks, () => null)} />}
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
