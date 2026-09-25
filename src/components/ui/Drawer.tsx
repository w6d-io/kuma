import type { ReactNode } from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import { cx } from './cx';
import { OverlayHead } from './Dialog';

/**
 * A panel from the right edge for working on one thing without leaving the list behind it —
 * a person, a key, an organisation. Same primitive as `Dialog`, so the same focus, Escape and
 * stacking behaviour; full width on a phone.
 */
export function Drawer({ open, onClose, title, eyebrow, children, footer, size = '', className }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: '' | 'lg';
  className?: string;
}) {
  return (
    <Primitive.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Primitive.Portal>
        <Primitive.Overlay className="drawer-wrap">
          <Primitive.Content className={cx('drawer', size, className)} aria-describedby={undefined}>
            <OverlayHead title={title} eyebrow={eyebrow} className="drawer-head" />
            <div className="drawer-body">{children}</div>
            {footer && <div className="drawer-foot">{footer}</div>}
          </Primitive.Content>
        </Primitive.Overlay>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
