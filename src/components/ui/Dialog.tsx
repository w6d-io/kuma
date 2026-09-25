import { useEffect, useState, type ReactNode } from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import { cx } from './cx';
import { I } from './Icons';
import { Button } from './Button';
import { Input } from './Input';
import { Field } from './Field';

/**
 * A modal dialog, on the Radix primitive the rail sheet already uses: focus moves in and is trapped
 * while it is open and returned afterwards, Escape and the scrim close it, the page behind stops
 * scrolling, and only the TOP dialog closes when two are stacked — a confirm over a drawer.
 *
 * `size="lg"` for a dialog that holds a table or a diff.
 */
export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: '' | 'lg';
  className?: string;
}

export function Dialog({ open, onClose, title, eyebrow, children, footer, size = '', className }: DialogProps) {
  return (
    <Primitive.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Primitive.Portal>
        <Primitive.Overlay className="modal-wrap">
          <Primitive.Content className={cx('modal', size, className)} aria-describedby={undefined}>
            <OverlayHead title={title} eyebrow={eyebrow} className="modal-head" />
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-foot">{footer}</div>}
          </Primitive.Content>
        </Primitive.Overlay>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

export function OverlayHead({ title, eyebrow, className }: { title: ReactNode; eyebrow?: ReactNode; className: string }) {
  return (
    <div className={className}>
      <div className="overlay-title">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <Primitive.Title asChild><h2>{title}</h2></Primitive.Title>
      </div>
      <Primitive.Close asChild>
        <Button variant="ghost" size="sm" iconOnly icon={I.close} aria-label="Close" />
      </Primitive.Close>
    </div>
  );
}

/**
 * The confirmation every destructive action goes through. Optional blast radius ("affects 12
 * users") and, for the actions that cannot be taken back, a word to type before the button wakes.
 */
export function ConfirmDialog({
  open, title, body, blastRadius, confirmLabel = 'Confirm', danger = false,
  requireText, onConfirm, onCancel, busy = false,
}: {
  open: boolean; title: string; body?: ReactNode; blastRadius?: ReactNode;
  confirmLabel?: string; danger?: boolean; requireText?: string;
  onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) setTyped(''); }, [open]);
  const ready = !requireText || typed.trim() === requireText;
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={<>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={!ready} loading={busy}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </>}
    >
      {body && <div className="confirm-body">{body}</div>}
      {blastRadius && (
        <div className="confirm-blast">
          <span className="confirm-blast-ico" aria-hidden="true">{I.alert}</span>
          <span>{blastRadius}</span>
        </div>
      )}
      {requireText && (
        <Field label={<>Type <span className="mono">{requireText}</span> to confirm</>} className="mt-12">
          <Input
            mono
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ready && !busy) onConfirm(); }}
          />
        </Field>
      )}
    </Dialog>
  );
}
