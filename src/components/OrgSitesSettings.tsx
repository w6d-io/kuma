import { useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useOrgServiceMap, useSetOrgServiceBundle, useDeleteOrgServiceMapping } from '../api/hooks';
import { useOrgCatalog } from '../api/orgCatalog';
import { I } from './ui/Icons';
import { Chip, ConfirmDialog, MultiSelectPills } from './ui/Primitives';
import { OrgPicker } from './OrgPicker';
import { orgLabel } from '../lib/orgOptions';
import { toastFor } from '../lib/apiError';

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
  // never resets an in-progress edit.
  useEffect(() => {
    setNewServices(newOrgId && mappings[newOrgId] ? [...mappings[newOrgId]] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newOrgId]);

  const toggleService = (svc: string) =>
    setNewServices(prev => (prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]));

  function handleSetBundle() {
    const orgId = newOrgId;
    if (!orgId || newServices.length === 0) return;
    setBundle.mutate(
      { organizationId: orgId, services: newServices },
      {
        onSuccess: () => {
          setNewOrgId('');
          setNewServices([]);
          pushToast('Sites saved', { sub: `${name(orgId)} → ${newServices.length} site${newServices.length === 1 ? '' : 's'}` });
        },
        onError: (e: Error) => pushToast(...toastFor(e)),
      },
    );
  }

  function handleDeleteMapping(orgId: string) {
    deleteMapping.mutate(orgId, {
      onSuccess: () => pushToast('Sites removed', { sub: name(orgId) }),
      onError: (e: Error) => pushToast(...toastFor(e)),
    });
  }

  const serviceNames = state.services.map(s => s.name).filter(n => n !== 'global');
  const mapEntries = Object.entries(mappings);
  const editingExisting = !!(newOrgId && mappings[newOrgId]);

  return (
    <div className="panel" style={{ marginBottom: 14, padding: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Organization sites</div>
      <div className="small muted" style={{ marginBottom: 14 }}>
        The sites each organization runs. Org admins can manage members only within these sites. Saving replaces an organization&apos;s whole list.
      </div>

      {mapLoading ? (
        <div className="small muted">Loading…</div>
      ) : (
        <>
          {mapEntries.length > 0 && (
            <table style={{ width: '100%', fontSize: 12, marginBottom: 14, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px', fontWeight: 500, color: 'var(--ink-2)' }}>Organization</th>
                  <th style={{ padding: '6px 8px', fontWeight: 500, color: 'var(--ink-2)' }}>Sites</th>
                  <th style={{ padding: '6px 8px', width: 96 }} />
                </tr>
              </thead>
              <tbody>
                {mapEntries.map(([orgId, svcs]) => (
                  <tr key={orgId} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className={name(orgId) === orgId ? 'mono' : ''} style={{ padding: '6px 8px', verticalAlign: 'top' }} title={orgId}>{name(orgId)}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {svcs.length === 0
                        ? <span className="small muted">— none —</span>
                        : <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{svcs.map(s => <Chip key={s}>{s}</Chip>)}</span>}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      <button className="btn ghost sm" onClick={() => setNewOrgId(orgId)} title="Edit sites">Edit</button>
                      <button className="btn ghost sm" onClick={() => setConfirmOrg(orgId)} title="Remove sites" aria-label="Remove sites">
                        {I.trash}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <OrgPicker value={newOrgId} onChange={setNewOrgId} style={{ maxWidth: 360 }} />
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
              <button
                className="btn primary"
                onClick={handleSetBundle}
                disabled={mapSaving || !newOrgId || newServices.length === 0}
              >
                {mapSaving ? 'Saving…' : (editingExisting ? 'Replace sites' : 'Save sites')}
              </button>
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
    </div>
  );
}
