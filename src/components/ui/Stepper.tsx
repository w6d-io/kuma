import type { ReactNode } from 'react';
import { cx } from './cx';
import { I } from './Icons';

/**
 * Where a multi-step flow is: the steps behind (done), the one in front (current), the ones ahead.
 * An ordered list with `aria-current="step"`, so "step 2 of 4" is read, not just drawn.
 *
 * With `onStep`, the done steps become buttons back to themselves — a wizard lets you revisit what
 * you already answered, never skip ahead.
 */
export interface Step { id: string; label: ReactNode; description?: ReactNode }

export function Stepper({ steps, current, onStep, orientation = 'horizontal', className }: {
  steps: Step[];
  current: string;
  onStep?: (id: string) => void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  const at = steps.findIndex((s) => s.id === current);
  return (
    <ol className={cx('stepper', orientation, className)}>
      {steps.map((s, i) => {
        const state = i < at ? 'done' : i === at ? 'current' : 'upcoming';
        const marker = <span className="step-marker" aria-hidden="true">{state === 'done' ? I.check : i + 1}</span>;
        const text = (
          <span className="step-text">
            <span className="step-label">{s.label}</span>
            {s.description && <span className="step-desc">{s.description}</span>}
          </span>
        );
        return (
          <li key={s.id} className={cx('step', state)} aria-current={state === 'current' ? 'step' : undefined}>
            {state === 'done' && onStep
              ? <button type="button" className="step-btn" onClick={() => onStep(s.id)}>{marker}{text}</button>
              : <span className="step-btn">{marker}{text}</span>}
          </li>
        );
      })}
    </ol>
  );
}
