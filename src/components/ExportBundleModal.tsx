import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { api } from '../api/client';
import { Button, Checkbox, Dialog } from './ui';

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
    <Dialog
      open={open}
      onClose={onClose}
      title="Export bundle"
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={doExport} disabled={busy || selected.length === 0}>
          {busy ? 'Working…' : `Export ${selected.length}/${SECTIONS.length} sections`}
        </Button>
      </>}
    >
      <p className="small muted mt-0">All sections is a full 1:1 snapshot; deselect to export a subset.</p>
      <Checkbox
        className="settings-check all"
        checked={selected.length === SECTIONS.length}
        indeterminate={selected.length > 0 && selected.length < SECTIONS.length}
        onChange={(on) => setSelected(on ? SECTIONS.map((s) => s.id) : [])}
        label="Select all"
      />
      {SECTIONS.map((s) => (
        <Checkbox
          key={s.id}
          className="settings-check"
          checked={selected.includes(s.id)}
          onChange={(on) => setSelected((cur) => (on ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
          label={s.label}
        />
      ))}
    </Dialog>
  );
}
