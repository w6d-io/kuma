import { useEffect, useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useOrgServiceMap, useSetOrgServiceBundle, useDeleteOrgServiceMapping } from '../api/hooks';
import { useOrgCatalog } from '../api/orgCatalog';
import { MultiSelectPills } from './ui/Primitives';
import { I, Badge, Button, Card, ConfirmDialog, Table, cx } from './ui';
import { OrgPicker } from './OrgPicker';
import { orgLabel } from '../lib/orgOptions';
import { toastFor } from '../lib/apiError';
import { stepUpOnRefusal, useResume } from '../lib/resume';

const RESUME = 'org-sites';
type SitesResume = { organizationId: string; services: string[]; was: string[] };
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));

/**
 * Settings · which sites each organization runs, for the org-scoped screens (org admins, delegated
 * group assignment). Organizations are picked by name; saving replaces that organization's list.
 */
export function OrgSitesSettings() {
  const { state, pushToast } = useApp();
  const { orgs } = useOrgCatalog();
  // ─── Org → Service bundle map (cached Query hook, PERF-4; optimistic PUT) ───
  const { data: fetchedMappings, isLoading: mapLoading } = useOrgServiceMap();
  const setBundle = useSetOrgServiceBundle();
  const deleteMapping = useDeleteOrgServiceMapping();
  const mappings: Record<string, string[]> = fetchedMappings ?? {};
  const [newOrgId, setNewOrgId] = useState('');
  const [newServices, setNewServices] = useState<string[]>([]);
  const [confirmOrg, setConfirmOrg] = useState<string | null>(null);
  const mapSaving = setBundle.isPending;
  const name = (id: string) => orgLabel(id, orgs);

  // Seed the editor from the org's current bundle whenever the target org id
  // changes (e.g. clicking "Edit" on a row), so a save is a deliberate REPLACE
  // — never an accidental clobber that narrows an existing bundle to a single
  // freshly-picked service. Keyed on `newOrgId` only so a background refetch
  // never resets an in-progress edit. `seed` puts a choice back instead (a
  // resumed save that could not run).
  const seed = useRef<string[] | null>(null);
  useEffect(() => {
    setNewServices(seed.current ?? (newOrgId && mappings[newOrgId] ? [...mappings[newOrgId]] : []));
    seed.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newOrgId]);

  // Back from the step-up the save needed: the same list saved again, once, if nobody changed the
  // organization's sites meanwhile; otherwise it is put back in the form to be checked and saved.
  useResume<SitesResume>(RESUME, !mapLoading, (r) => {
    if (sameSet(mappings[r.organizationId] ?? [], r.was)) { save(r.organizationId, r.services); return; }
    seed.current = r.services;
    setNewOrgId(r.organizationId);
    pushToast('The organization\'s sites changed meanwhile', { sub: 'Nothing was saved. Your choice is back in the form — check it and save.', ttl: 8000 });
  });

  const toggleService = (svc: string) =>
    setNewServices(prev => (prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]));

  function save(orgId: string, services: string[]) {
    const was = mappings[orgId] ?? [];
    setBundle.mutate(
      { organizationId: orgId, services },
      {
        onSuccess: () => {
          setNewOrgId('');
          setNewServices([]);
          pushToast('Sites saved', { sub: `${name(orgId)} → ${services.length} site${services.length === 1 ? '' : 's'}` });
        },
        onError: (e: Error) => {
          if (stepUpOnRefusal(e, pushToast, { resume: RESUME, data: { organizationId: orgId, services, was } satisfies SitesResume })) return;
          // jinbe names a refused site by its place in the list (services.3): said as the site.
          const field = (f: string) => { const m = /^services\.(\d+)$/.exec(f); return m && services[Number(m[1])] ? `Site ${services[Number(m[1])]}` : undefined; };
          pushToast(...toastFor(e, { field }));
        },
      },
    );
  }

  function handleSetBundle() {
    if (!newOrgId || newServices.length === 0) return;
    save(newOrgId, newServices);
  }

  function handleDeleteMapping(orgId: string) {
    deleteMapping.mutate(orgId, {
      onSuccess: () => pushToast('Sites removed', { sub: name(orgId) }),
      onError: (e: Error) => {
        if (stepUpOnRefusal(e, pushToast, { redo: `Remove the sites of ${name(orgId)} again: nothing was removed before the check.` })) return;
        pushToast(...toastFor(e));
      },
    });
  }

  const serviceNames = state.services.map(s => s.name).filter(n => n !== 'global');
  const mapEntries = Object.entries(mappings);
  const editingExisting = !!(newOrgId && mappings[newOrgId]);

  return (
    <Card
      title="Organization sites"
      sub={<>The sites each organization runs. Org admins can manage members only within these sites. Saving replaces an organization&apos;s whole list.</>}
    >

      {mapLoading ? (
        <div className="small muted">Loading…</div>
      ) : (
        <>
          {mapEntries.length > 0 && (
            <Table className="compact mb-12">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Sites</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {mapEntries.map(([orgId, svcs]) => (
                  <tr key={orgId}>
                    <td className={cx('settings-top', name(orgId) === orgId && 'mono')} title={orgId}>{name(orgId)}</td>
                    <td>
                      {svcs.length === 0
                        ? <span className="small muted">— none —</span>
                        : <span className="row wrap gap-4">{svcs.map(s => <Badge key={s}>{s}</Badge>)}</span>}
                    </td>
                    <td className="settings-top actions">
                      <Button variant="ghost" size="sm" onClick={() => setNewOrgId(orgId)} title="Edit sites">Edit</Button>
                      <Button variant="ghost" size="sm" iconOnly icon={I.trash} onClick={() => setConfirmOrg(orgId)} title="Remove sites" aria-label="Remove sites" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <div className="col gap-12">
            <div className="maxw-sm"><OrgPicker value={newOrgId} onChange={setNewOrgId} /></div>
            <div>
              <div className="input-label">Sites{editingExisting ? ' · replaces the current list' : ''}</div>
              <MultiSelectPills
                options={serviceNames}
                selected={newServices}
                onToggle={toggleService}
                empty="No sites defined yet."
              />
            </div>
            <div>
              <Button
                variant="primary"
                onClick={handleSetBundle}
                disabled={mapSaving || !newOrgId || newServices.length === 0}
              >
                {mapSaving ? 'Saving…' : (editingExisting ? 'Replace sites' : 'Save sites')}
              </Button>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!confirmOrg}
        title="Remove this organization's sites?"
        danger
        confirmLabel="Remove sites"
        body={<>Org admins of <b>{confirmOrg ? name(confirmOrg) : ''}</b> will lose the ability to manage its members, and group assignment by org admins will stop working for that organization.</>}
        onCancel={() => setConfirmOrg(null)}
        onConfirm={() => { if (confirmOrg) handleDeleteMapping(confirmOrg); setConfirmOrg(null); }}
      />
    </Card>
  );
}
