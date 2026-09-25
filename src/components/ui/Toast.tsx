import { cx } from './cx';

/**
 * What just happened, in the corner, for a few seconds. A live region, so a reader hears it without
 * losing their place; failures are marked in words by the message and in colour by the dot.
 */
export interface ToastItem {
  id: string;
  msg: string;
  err?: boolean;
  sub?: string;
}

export function Toasts({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toasts" aria-live="polite" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', t.err && 'err')}>
          <span className="d" aria-hidden="true" />
          <div>
            <div>{t.msg}</div>
            {t.sub && <div className="lbl">{t.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
