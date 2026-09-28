import { useState, type ReactNode } from 'react';
import { Button, Callout, ConfirmDialog, CopyField, Drawer, Field, FormGrid, I } from '../../components/ui';

/**
 * The step after a key is created: its secret, shown once. The secret is the first thing in the
 * drawer, with Copy beside it; closing before it was copied asks first, because nothing can show it
 * again — the only way back is to revoke the key and make a new one.
 */
export function SecretDrawer({ eyebrow, title, secretLabel, secret, details, children, onClose }: {
  eyebrow: ReactNode;
  title: ReactNode;
  secretLabel: string;
  secret: string;
  /** Other values, copied as they are (client id…). */
  details?: Array<{ label: string; value: string }>;
  /** What follows the values: how to use the key. */
  children?: ReactNode;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const close = () => (copied ? onClose() : setAsking(true));

  return (
    <Drawer
      open
      onClose={close}
      eyebrow={eyebrow}
      title={title}
      footer={<>
        <span className="small muted">{copied ? 'Copied. Store it somewhere safe before you close.' : 'The secret is not shown again.'}</span>
        <Button variant="primary" onClick={close}>Done</Button>
      </>}
    >
      <div className="stack gap-16">
        <Callout tone="warning" icon={I.lock} title="Copy the secret now">
          It is shown this once and cannot be read again. If it is lost, revoke this key and create a new one.
        </Callout>
        <FormGrid>
          <Field label={secretLabel}>
            <CopyField value={secret} onCopied={() => setCopied(true)} />
          </Field>
          {details?.map((d) => (
            <Field key={d.label} label={d.label}>
              <CopyField value={d.value} size="sm" />
            </Field>
          ))}
        </FormGrid>
        {children}
      </div>
      <ConfirmDialog
        open={asking}
        title="Close without copying the secret?"
        body="You have not copied it, and it cannot be shown again. A program needs it to use this key."
        confirmLabel="Close anyway"
        danger
        onCancel={() => setAsking(false)}
        onConfirm={() => { setAsking(false); onClose(); }}
      />
    </Drawer>
  );
}
