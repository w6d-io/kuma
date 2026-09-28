import type { ReactNode } from 'react';
import type { Module } from '../../api/home';
import { Button, I, RelativeTime, Skeleton, SourceState, cx } from '../../components/ui';
import { sourceWords } from './moduleKit';

/**
 * One Home module: its section, its header, and the mapping from the envelope to what the viewer
 * sees (home-design §4, the common states table), so no module re-implements loading, not
 * connected, stale or failed. A forbidden module is not drawn at all.
 */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The sources that did not answer, in words; none named → "the server". */
function failedSources(m: Module<unknown> | undefined, states: string[]): string[] {
  return Object.entries(m?.sources ?? {}).filter(([, v]) => states.includes(v.state)).map(([k]) => sourceWords(k));
}

export interface FrameProps<T> {
  id: string;
  title: ReactNode;
  count?: number;
  /** Right side of the header: a window switch, "All sites →". */
  aside?: ReactNode;
  module: Module<T> | undefined;
  loading: boolean;
  /** The module's own refetch failed (network, 5xx). */
  error?: Error | null;
  onRetry: () => void;
  /** Placeholder in the shape of the content. */
  skeleton: ReactNode;
  /** What this module shows, for the error line: "sign-ins", "sites". */
  thing: string;
  /** The not-connected block's words for this module. */
  notConnected: { title: ReactNode; what: ReactNode };
  children: (data: T, m: Module<T>) => ReactNode;
  className?: string;
}

export function ModuleFrame<T>({ id, title, count, aside, module: m, loading, error, onRetry, skeleton, thing, notConnected, children, className }: FrameProps<T>) {
  if (m?.status === 'forbidden') return null;
  const headId = `${id}-title`;
  const unavailable = m?.status === 'unavailable';
  const disconnected = unavailable && (m.reason === 'not_configured' || m.reason === 'not_deployed');

  let body: ReactNode;
  let busy = false;
  if (!m) {
    if (error) body = <FrameError text={`Couldn't load ${thing}.`} onRetry={onRetry} />;
    else { body = skeleton; busy = loading; }
  } else if (unavailable && m.reason === 'warming') {
    busy = true;
    body = (
      <div className="home-warming">
        <p className="home-note">Collecting — first figures in about a minute.</p>
        <div className="home-warming-shape">{skeleton}</div>
      </div>
    );
  } else if (disconnected) {
    body = (
      <SourceState title={notConnected.title} setting={m.connect?.setting} docs={m.connect?.docs} compact>
        {notConnected.what}
      </SourceState>
    );
  } else if (unavailable) {
    const who = failedSources(m, ['down', 'timeout']);
    body = <FrameError text={`Couldn't load ${thing} — ${who.length ? who.join(', ') : 'the server'} didn't answer.`} onRetry={onRetry} />;
  } else if (m.data !== undefined) {
    const partial = failedSources(m, ['down', 'timeout']);
    // One source of several not connected: say which, and the setting that connects it.
    const notSet = Object.entries(m.sources ?? {}).filter(([, v]) => (v.state === 'not_configured' || v.state === 'not_deployed') && v.connect);
    body = (
      <>
        {children(m.data, m)}
        {partial.length > 0 && <p className="home-foot muted">Partial — {partial.join(', ')} didn't answer.</p>}
        {notSet.map(([k, v]) => (
          <p key={k} className="home-foot muted">{cap(sourceWords(k))} isn't connected — set <code>{v.connect!.setting}</code> ({v.connect!.docs}).</p>
        ))}
        {(m.stale || error) && (
          <p className="home-foot is-stale">
            <span className="home-foot-ico" aria-hidden="true">{I.clock}</span>
            {error ? "Couldn't refresh · " : ''}Updated <RelativeTime at={m.asOf} />
            {error && <Button size="sm" variant="ghost" onClick={onRetry}>Retry</Button>}
          </p>
        )}
      </>
    );
  } else {
    body = <FrameError text={`Couldn't load ${thing}.`} onRetry={onRetry} />;
  }

  return (
    <section id={id} className={cx('panel', 'home-module', disconnected && 'is-disconnected', className)} aria-labelledby={headId} aria-busy={busy || undefined} tabIndex={-1}>
      <header className="home-module-head">
        <h2 id={headId}>{title}{count != null && <span className="home-count">{count.toLocaleString()}</span>}</h2>
        {aside && !disconnected && <div className="home-module-aside">{aside}</div>}
      </header>
      <div className="home-module-body">{body}</div>
    </section>
  );
}

function FrameError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="home-error" role="status">
      <span className="home-error-ico" aria-hidden="true">{I.alert}</span>
      <span className="flex-1">{text}</span>
      <Button size="sm" onClick={onRetry}>Retry</Button>
    </div>
  );
}

/** Rows of the right height, for a list module. */
export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="home-rows-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={16} w={i % 2 ? '70%' : '85%'} />)}
    </div>
  );
}
