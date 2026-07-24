import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { api } from '../api/client';
import { Modal } from './ui/Primitives';

const SECTIONS: { id: string; label: string }[] = [
  { id: 'services', label: 'Services' },
  { id: 'groups', label: 'Groups' },
  { id: 'roles', label: 'Roles' },
  { id: 'routeMaps', label: 'Route maps' },
  { id: 'oathkeeperRules', label: 'Oathkeeper rules' },
  { id: 'orgServiceMap', label: 'Org → service map' },
];

/** Choose-what-to-export dialog. All selected = full 1:1 snapshot; deselect to
 *  export a subset. Shared by Settings and the Backup tab. */
export function ExportBundleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pushToast } = useApp();
  const [selected, setSelected] = useState<string[]>(SECTIONS.map((s) => s.id));
  const [busy, setBusy] = useState(false);

  async function doExport() {
    setBusy(true);
    try {
      await api.exportBundle(selected.length === SECTIONS.length ? undefined : selected);
      pushToast('Export downloaded', { sub: `${selected.length}/${SECTIONS.length} sections` });
      onClose();
    } catch (e: any) {
      pushToast(e.message || 'Export failed', { err: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export bundle"
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={doExport} disabled={busy || selected.length === 0}>
          {busy ? 'Working…' : `Export ${selected.length}/${SECTIONS.length} sections`}
        </button>
      </>}
    >
      <p className="small muted" style={{ marginTop: 0 }}>All sections is a full 1:1 snapshot; deselect to export a subset.</p>
      <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={selected.length === SECTIONS.length}
          ref={(el) => { if (el) el.indeterminate = selected.length > 0 && selected.length < SECTIONS.length; }}
          onChange={(e) => setSelected(e.target.checked ? SECTIONS.map((s) => s.id) : [])}
        />
        Select all
      </label>
      {SECTIONS.map((s) => (
        <label key={s.id} className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
          <input
            type="checkbox"
            checked={selected.includes(s.id)}
            onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
          />
          {s.label}
        </label>
      ))}
    </Modal>
  );
}
