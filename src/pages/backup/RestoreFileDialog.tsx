import { I, Button, Callout, Checkbox, Dialog } from '../../components/ui';
import { SECTIONS, availableSections, type PendingFile, type SectionId } from './snapshot';

/**
 * Restore from a file: every section the file carries is checked (a full restore: each one replaces
 * what is there); unchecking any makes it a sectioned import that only writes over and adds.
 */
export function RestoreFileDialog({ file, selected, onSelect, busy, onConfirm, onCancel }: {
  file: PendingFile | null;
  selected: SectionId[];
  onSelect: (next: SectionId[]) => void;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const available = file ? availableSections(file) : [];
  const full = !!file && selected.length === available.length;
  const rules = file?.rules ?? 0;
  const missing = file ? SECTIONS.filter((s) => file.counts[s.id] === undefined) : [];
  return (
    <Dialog
      open={!!file}
      onClose={() => { if (!busy) onCancel(); }}
      eyebrow="Backup & restore"
      title="Restore from this file?"
      footer={<>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={onConfirm} disabled={busy || selected.length === 0}>
          {busy ? 'Restoring…' : full ? 'Restore everything in the file' : `Import ${selected.length} section${selected.length === 1 ? '' : 's'}`}
        </Button>
      </>}
    >
      {file && (
        <div className="col gap-12 text-base">
          <Callout tone={full ? 'warning' : 'neutral'} icon={I.alert} title={full ? 'A full restore' : 'A sectioned import: nothing is removed'}>
            <div className="small">
              {full
                ? <>Each section in <span className="mono">{file.name}</span> replaces what is there now: what the file does not have in those sections is removed. Organizations the file has are restored exactly; any other organization is left untouched, never deleted. Sites that exist now are kept as they are; sites the file has and that are gone are written back. Every applied site is then published again.</>
                : <>Only the checked sections of <span className="mono">{file.name}</span> are written over or added. Nothing is removed, and unchecked sections are left as they are.</>}
            </div>
          </Callout>
          {(rules > 0 || missing.length > 0) && (
            <Callout tone="info" title={`An older file (format ${file.bundle.version})`}>
              <div className="small">
                {rules > 0 && <>Its {rules} gateway rule{rules === 1 ? '' : 's'} will not be restored: built-in rules come from the running release, site rules from the published sites. </>}
                {missing.length > 0 && <>It has no {missing.map((s) => s.label.toLowerCase()).join(', ')}: those are left as they are.</>}
              </div>
            </Callout>
          )}
          <div>
            <div className="small muted mb-4">Choose what to restore</div>
            <Checkbox
              className="settings-check all"
              disabled={busy}
              checked={full}
              indeterminate={selected.length > 0 && !full}
              onChange={(on) => onSelect(on ? available.map((s) => s.id) : [])}
              label="Everything in the file (full restore)"
            />
            {available.map((s) => (
              <Checkbox
                key={s.id}
                className="settings-check"
                disabled={busy}
                checked={selected.includes(s.id)}
                onChange={(on) => onSelect(on ? [...selected, s.id] : selected.filter((x) => x !== s.id))}
                label={<span className="row justify-between"><span>{s.label}</span><span className="mono muted text-xs">{file.counts[s.id]}</span></span>}
              />
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
