import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Callout, Card, ConfirmDialog, Field, I, Input, RadioGroup, Select, Textarea } from '../../../components/ui';
import { sitesApi, useInvalidateSite } from '../../../api/sites';
import { goSites, sitesHref } from '../../../lib/sites/route';
import { labelProblem, namespaceProblem, portProblem, serviceProblem } from '../../../lib/sites/validate';
import type { Site } from '../../../lib/sites/types';
import type { SiteEditor } from '../useSiteEditor';
import { useSiteAction } from '../useAction';

/**
 * Settings (site-ux.md §10.4–10.6): name, address and upstream (drafted like any change), then the
 * actions that change what the gateway serves at once — pause/resume and delete with its blast
 * radius — which need a super admin and a recent second factor.
 */

export function SettingsTab({ ed, readOnly, canApply }: { ed: SiteEditor; readOnly: boolean; canApply: boolean }) {
  const site = ed.site;
  const invalidate = useInvalidateSite();
  const { run, busy } = useSiteAction();
  const [confirm, setConfirm] = useState<'pause' | 'resume' | 'delete' | null>(null);
  const [clone, setClone] = useState<{ name: string; host: string } | null>(null);
  const blast = useQuery({ queryKey: ['sites', 'blast', ed.name], queryFn: () => sitesApi.blastRadius(ed.name), enabled: confirm === 'delete', retry: false });
  if (!site) return <Callout tone="warning" icon={I.alert}>This draft is incomplete.</Callout>;

  const set = (fn: (s: Site) => Site) => ed.update(fn);
  const paused = (ed.saved?.state ?? site.state) === 'paused';
  const applied = !!ed.detail.data?.applied;
  const [label, ...zoneParts] = site.address.host.split('.');
  const zone = zoneParts.join('.');
  const u = site.upstream;
  const br = blast.data;

  return (
    <div className="stack gap-16">
      <Card title="Site">
        <div className="site-form-grid">
          <Field label="Name" hint="Used in permissions (payroll:read …); cannot change."><Input mono value={site.name} disabled /></Field>
          <Field label="Display name"><Input value={site.displayName} disabled={readOnly} maxLength={80} onChange={(e) => set((s) => ({ ...s, displayName: e.target.value || s.displayName }))} /></Field>
          <Field label="Description" className="span-all"><Textarea rows={2} value={site.description ?? ''} disabled={readOnly} maxLength={500} onChange={(e) => set((s) => ({ ...s, description: e.target.value || undefined }))} /></Field>
        </div>
      </Card>

      <Card title="Address" sub="Changing the host is high risk in Review.">
        <div className="site-form-grid">
          <Field label="Host label" error={labelProblem(label) ?? undefined} hint={`under ${zone}`}>
            <Input mono value={label} disabled={readOnly} onChange={(e) => set((s) => ({ ...s, address: { ...s.address, host: `${e.target.value.toLowerCase()}.${zone}` } }))} />
          </Field>
          <Field label="Path prefix" hint="Only when sharing the host with another site, e.g. /payroll.">
            <Input mono value={site.address.pathPrefix ?? ''} disabled={readOnly} onChange={(e) => set((s) => ({ ...s, address: { host: s.address.host, ...(e.target.value ? { pathPrefix: e.target.value } : {}) } }))} />
          </Field>
          <RadioGroup<'zone' | 'vanity'> label="Exposure" name="exposure" value={site.exposure?.mode ?? 'zone'} disabled={readOnly} className="span-all" onChange={(mode) => set((s) => ({ ...s, exposure: { mode } }))} options={[
            { value: 'zone', label: 'Zone (default)', hint: 'the zone’s wildcard address and certificate already reach the gateway — live in seconds' },
            { value: 'vanity', label: 'Its own Ingress', hint: 'the operator creates one from a fixed template; a certificate when the zone has no wildcard' },
          ]} />
        </div>
      </Card>

      <Card title="Runs at" sub="An in-cluster Service. The operator builds the URL; platform-internal services are refused.">
        <div className="site-form-grid">
          <Field label="Service" error={serviceProblem(u.service) ?? undefined}><Input mono value={u.service} disabled={readOnly} onChange={(e) => set((s) => ({ ...s, upstream: { ...s.upstream, service: e.target.value.trim() } }))} /></Field>
          <Field label="Namespace" error={namespaceProblem(u.namespace) ?? undefined}><Input mono value={u.namespace} disabled={readOnly} onChange={(e) => set((s) => ({ ...s, upstream: { ...s.upstream, namespace: e.target.value.trim() } }))} /></Field>
          <Field label="Port" error={portProblem(String(u.port)) ?? undefined}><Input mono inputMode="numeric" value={String(u.port)} disabled={readOnly} onChange={(e) => set((s) => ({ ...s, upstream: { ...s.upstream, port: Number(e.target.value) || 0 } }))} /></Field>
          <Field label="Scheme" hint={u.scheme === 'https' ? 'Needs a publicly trusted certificate (no custom CA).' : undefined}>
            <Select value={u.scheme ?? 'http'} disabled={readOnly} onChange={(e) => set((s) => ({ ...s, upstream: { ...s.upstream, scheme: e.target.value === 'https' ? 'https' : undefined } }))}>
              <option value="http">http</option><option value="https">https</option>
            </Select>
          </Field>
        </div>
      </Card>

      {!readOnly && (
        <Card title="Clone" sub="Copies gates, routes, roles and login into a new draft — never live. People, organizations and host-bound overrides are not copied.">
          {clone ? (
            <div className="row gap-8 wrap items-end">
              <Field label="New name"><Input mono value={clone.name} onChange={(e) => setClone({ ...clone, name: e.target.value.toLowerCase() })} /></Field>
              <Field label="New host"><Input mono value={clone.host} onChange={(e) => setClone({ ...clone, host: e.target.value.toLowerCase() })} /></Field>
              <Button variant="primary" loading={busy === 'Clone'} onClick={async () => {
                const out = await run('Clone', () => sitesApi.clone(ed.name, clone), 'Cloned into a draft');
                if (out) goSites(sitesHref({ view: 'site', name: clone.name, tab: 'review' }));
              }}>Clone</Button>
              <Button onClick={() => setClone(null)}>Cancel</Button>
            </div>
          ) : <Button icon={I.copy} onClick={() => setClone({ name: `${site.name}-copy`, host: `${label}-copy.${zone}` })}>Clone…</Button>}
        </Card>
      )}

      {canApply && applied && (
        <Card title={paused ? 'Paused' : 'Pause'} sub={paused ? 'Everyone gets “paused” until you resume.' : 'Everyone gets “paused” until you resume. Routes, roles and access are kept.'}>
          <Button icon={paused ? I.sync : I.clock} onClick={() => setConfirm(paused ? 'resume' : 'pause')}>{paused ? 'Resume' : 'Pause site'}</Button>
        </Card>
      )}

      {canApply && (
        <Card title="Delete" sub="Removes the gateway rules first, then the permissions. A snapshot is kept for 30 days.">
          <Button variant="danger" icon={I.trash} onClick={() => setConfirm('delete')}>Delete site…</Button>
        </Card>
      )}

      <ConfirmDialog
        open={confirm === 'pause' || confirm === 'resume'}
        title={confirm === 'pause' ? `Pause ${site.displayName}?` : `Resume ${site.displayName}?`}
        body={confirm === 'pause' ? `Everyone gets “${site.displayName} is paused” until you resume. Nothing else changes.` : 'The live version is served again.'}
        confirmLabel={confirm === 'pause' ? 'Pause' : 'Resume'}
        busy={busy === 'Pause' || busy === 'Resume'}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const pausing = confirm === 'pause';
          await run(pausing ? 'Pause' : 'Resume', () => (pausing ? sitesApi.pause(ed.name) : sitesApi.resume(ed.name)), pausing ? `${site.displayName} is paused` : `${site.displayName} is live again`);
          setConfirm(null);
          invalidate(ed.name);
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title={`Delete ${site.displayName}?`}
        danger
        requireText={site.name}
        confirmLabel="Delete site"
        busy={busy === 'Delete'}
        body={<p className="m-0">This stops <span className="mono">{site.address.host}{site.address.pathPrefix ?? ''}</span> for everyone. Needs a recent second factor.</p>}
        blastRadius={blast.isLoading ? 'Counting what goes with it…' : br ? (
          <ul className="site-list m-0">
            <li>{br.people != null ? `${br.people} people lose access` : 'People with access lose it'}{br.groups.length ? ` (via ${br.groups.join(', ')})` : ''}</li>
            {br.orgs.length > 0 && <li>{br.orgs.length} organization{br.orgs.length === 1 ? '' : 's'} lose it ({br.orgs.reduce((n, o) => n + o.grants, 0)} grants)</li>}
            {br.orgGrantableGroups.length > 0 && <li>Org-grantable groups deleted: {br.orgGrantableGroups.join(', ')}</li>}
            <li>{br.rules} gateway rule{br.rules === 1 ? '' : 's'} and {br.routes} route{br.routes === 1 ? '' : 's'} removed</li>
            {br.apiKeys != null && <li>{br.apiKeys} API keys scoped to it stop working</li>}
            {br.requests24h != null && <li>{br.requests24h} requests in the last 24 h</li>}
          </ul>
        ) : 'What it takes with it could not be counted.'}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const out = await run('Delete', () => sitesApi.remove(ed.name), `${site.displayName} deleted — a snapshot is kept for 30 days`);
          setConfirm(null);
          if (out) { invalidate(); goSites(sitesHref({ view: 'list' })); }
        }}
      />
    </div>
  );
}
