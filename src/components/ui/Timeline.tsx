import type { ReactNode } from 'react';
import { cx } from './cx';
import { I } from './Icons';
import { Spinner } from './Button';

/**
 * What happened, in order, and how far it got: a change being applied, a deployment, a check run.
 * Each event is pending, running, done or failed — said in words beside the marker, because a red
 * dot alone tells a colour-blind reader nothing.
 *
 * The running event is `aria-current="step"`; wrap the list in a live region when it updates while
 * somebody watches.
 */
export type TimelineState = 'pending' | 'running' | 'done' | 'failed';

export interface TimelineItem {
  id: string;
  label: ReactNode;
  state: TimelineState;
  /** Right-aligned and quiet: a time, a duration, who did it. */
  meta?: ReactNode;
  /** A line under the label — the error, the output, a link. */
  detail?: ReactNode;
}

const WORD: Record<TimelineState, string> = { pending: 'waiting', running: 'running', done: 'done', failed: 'failed' };

function marker(state: TimelineState) {
  if (state === 'done') return I.check;
  if (state === 'failed') return I.close;
  if (state === 'running') return <Spinner />;
  return null;
}

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cx('timeline', className)}>
      {items.map((it) => (
        <li key={it.id} className={cx('tl-item', it.state)} data-state={it.state} aria-current={it.state === 'running' ? 'step' : undefined}>
          <span className="tl-marker" aria-hidden="true">{marker(it.state)}</span>
          <div className="tl-body">
            <div className="tl-head">
              <span className="tl-label">{it.label}</span>
              <span className="tl-state">{WORD[it.state]}</span>
              {it.meta != null && <span className="tl-meta">{it.meta}</span>}
            </div>
            {it.detail != null && <div className="tl-detail">{it.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
