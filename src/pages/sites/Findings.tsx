import { useEffect, useState, type ReactNode } from 'react';
import { Button, Checkbox, Dialog } from '../../components/ui';
import { findingsBlocker, groupFindings } from '../../lib/sites/verify';
import type { Finding } from '../../lib/sites/types';
import { CheckList } from './parts';

/**
 * Security findings before a publish (jinbe wave18): errors to fix (acknowledging does not help),
 * findings a person accepts by their code, and warnings that are only said. Nearly every site has
 * something to accept — a public /health, a signed-in catch-all — so this is the confirmation step
 * of every publish, not an exception.
 */
export function FindingsList({ findings, acknowledged, onChange, disabled, actionFor }: {
  findings: readonly Finding[]; acknowledged: ReadonlySet<string>; onChange: (next: Set<string>) => void; disabled?: boolean;
  /** A way to act on a warning or note where it is fixed (e.g. the site's Organizations). */
  actionFor?: (f: Finding) => ReactNode;
}) {
  const { errors, warnings, notes, confirm } = groupFindings(findings);
  const toggle = (code: string, on: boolean) => {
    const next = new Set(acknowledged);
    if (on) next.add(code); else next.delete(code);
    onChange(next);
  };
  return (
    <div className="stack gap-12">
      {errors.length > 0 && (
        <CheckList live={false} lines={errors.map((f) => ({ level: 'error', text: `${f.message} ${f.fix}` }))} />
      )}
      {confirm.length > 0 && (
        <div className="stack gap-8" role="group" aria-label="Findings to acknowledge">
          {confirm.map(({ code, items }) => (
            <Checkbox
              key={code}
              checked={acknowledged.has(code)}
              disabled={disabled}
              onChange={(on) => toggle(code, on)}
              label={items.length === 1 ? items[0].message : `${items[0].message} (+${items.length - 1} more like it)`}
              hint={<>
                {items.length > 1 && <ul className="site-list m-0">{items.slice(1).map((f, i) => <li key={i}>{f.message}</li>)}</ul>}
                <span>{items[0].fix}</span>
              </>}
            />
          ))}
        </div>
      )}
      {warnings.length > 0 && <CheckList live={false} lines={warnings.map((f) => ({ level: 'warn', text: f.fix ? `${f.message} ${f.fix}` : f.message, action: actionFor?.(f) }))} />}
      {notes.length > 0 && <CheckList live={false} lines={notes.map((f) => ({ level: 'info', text: f.fix ? `${f.message} ${f.fix}` : f.message, action: actionFor?.(f) }))} />}
    </div>
  );
}

/**
 * A publish refused for findings nobody acknowledged (422 unconfirmed_findings), from a screen with
 * no findings list of its own (History, an apply request): the findings, and the same publish again
 * with the acknowledged codes.
 */
export function FindingsDialog({ findings, what, onRetry, onClose }: {
  findings: Finding[] | null; what: string; onRetry: (acknowledge: string[]) => Promise<unknown>; onClose: () => void;
}) {
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAcked(new Set()); }, [findings]);
  const blocker = findings ? findingsBlocker(findings, acked) : null;
  return (
    <Dialog
      open={!!findings}
      onClose={onClose}
      title={`Before publishing ${what}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!!blocker} loading={busy} onClick={async () => {
          setBusy(true);
          try { await onRetry([...acked]); } finally { setBusy(false); }
        }}>Acknowledge &amp; publish</Button>
      </>}
    >
      <p className="small m-0 mb-12">The server found what this version exposes. Nothing was published.</p>
      {findings && <FindingsList findings={findings} acknowledged={acked} onChange={setAcked} />}
      {blocker && <p className="small text-danger mt-8 mb-0">{blocker}</p>}
    </Dialog>
  );
}
