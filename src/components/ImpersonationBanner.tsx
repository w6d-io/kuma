import { useEffect, useRef } from 'react';
import type { ActiveImpersonation } from '../api/impersonation';
import { useApp } from '../contexts/AppContext';
import { useStopImpersonation, useViewingAs } from '../hooks/useImpersonation';
import { formatLeft, secondsLeft, targetLabel } from '../lib/impersonation';
import { formatHash } from '../lib/route';
import { Button, I } from './ui';

/**
 * Under the top bar of every page, and staying there while the page scrolls, for as long as the
 * caller is viewing the sites as somebody else: who, that it is read-only, how long is left, and
 * Stop — one click, nothing asked. This console keeps showing the caller's own account, so without
 * this strip nothing here would say the sites in the other tabs open as another person.
 *
 * The sentence is a status (read once when it appears); the countdown is a timer and is not read
 * out every second. When the time runs out the strip goes and a notice says it ended.
 */
export function ImpersonationBanner() {
  const { active, left } = useViewingAs();
  const { stop, stopping } = useStopImpersonation();
  const { pushToast } = useApp();

  const last = useRef<ActiveImpersonation | null>(null);
  useEffect(() => {
    const prev = last.current;
    last.current = active;
    // Gone because its time ran out — a Stop says so itself (useStopImpersonation).
    if (prev && !active && secondsLeft(prev.expiresAt) === 0) {
      pushToast(`Viewing as ${targetLabel(prev.target)} ended`, { sub: 'The time ran out. Sites open as you again.', ttl: 12000 });
    }
  }, [active, pushToast]);

  if (!active) return null;
  const who = targetLabel(active.target);
  return (
    <div className="viewer-banner viewing-as-banner" role="region" aria-label="Viewing as">
      <span aria-hidden="true">{I.users}</span>
      <span className="flex-1 min-w-0">
        <span role="status">
          Viewing sites as{' '}
          <a className="viewing-as-who" href={`#${formatHash('users', active.target.id)}`} title={`Open ${active.target.email}`}>{who}</a>
          {' '}— read-only
        </span>
        {' '}— <span role="timer" aria-live="off" className="viewing-as-left">{formatLeft(left)}</span> left
      </span>
      <Button size="sm" variant="primary" onClick={() => { void stop(); }} loading={stopping}>Stop</Button>
    </div>
  );
}
