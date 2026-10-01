import { useSyncExternalStore, type ReactNode } from 'react';
import { ButtonBase } from './Button';
import { Badge, Kbd } from './Badge';
import { I } from './Icons';
import { cx } from './cx';

/**
 * The pieces a briefing is built from (home-design §6.1): a time that keeps itself current, a
 * figure with its change, the honest "not connected" block, a queue row, a health item and an
 * action tile. Status is always a square or an icon WITH words, never a colour alone.
 */

// ── RelativeTime ────────────────────────────────────────────────────────────

// One ticker for every RelativeTime on screen, started by the first and stopped with the last.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) timer = setInterval(() => { now = Date.now(); listeners.forEach((l) => l()); }, 30_000);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}
const snapshot = () => now;

/** "12 min ago" in a `<time>`, the absolute time on hover, kept current every 30 s. */
export function RelativeTime({ at, suffix = ' ago', className }: { at: string | null | undefined; suffix?: string; className?: string }) {
  const t = useSyncExternalStore(subscribe, snapshot, snapshot);
  const ms = at ? Date.parse(at) : NaN;
  if (Number.isNaN(ms)) return <span className={className}>—</span>;
  const s = Math.max(0, Math.round((Math.max(t, Date.now()) - ms) / 1000));
  const text = s < 10 ? 'just now'
    : `${s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86_400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86_400)} d`}${suffix}`;
  const d = new Date(ms);
  return <time className={cx('reltime', className)} dateTime={d.toISOString()} title={d.toLocaleString()}>{text}</time>;
}

// ── Kpi ─────────────────────────────────────────────────────────────────────

/**
 * A figure somebody reads: label, value in tabular figures, and one line under it — the change, or
 * what the number counts. The whole tile links to where the number came from. `tone` colours the
 * line only when a rule fired, and the words say so too.
 */
export function Kpi({ label, value, sub, subLabel, tone, icon, href, title }: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Read instead of `sub` when the visible line is a glyph ("▲ 3× usual"). */
  subLabel?: string;
  tone?: 'warning' | 'danger';
  icon?: ReactNode;
  href?: string;
  title?: string;
}) {
  const inner = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub != null && (
        <span className={cx('kpi-sub', tone && `tone-${tone}`)} aria-label={subLabel}>
          {icon && <span className="kpi-ico" aria-hidden="true">{icon}</span>}
          {sub}
        </span>
      )}
    </>
  );
  return href
    ? <a className="kpi is-link" href={href} title={title}>{inner}</a>
    : <div className="kpi" title={title}>{inner}</div>;
}

// ── SourceState ─────────────────────────────────────────────────────────────

/** A docs path as a link when it can be one; the path itself stays on screen either way. */
function docsLink(docs: string): string | null {
  if (/^https?:\/\//.test(docs)) return docs;
  const m = /^(jinbe|kuma|charts|gatekit|site-operator)\/(.+)$/.exec(docs);
  return m ? `https://github.com/w6d-io/${m[1]}/blob/develop/${m[2]}` : null;
}

/**
 * The honest "not connected": the neutral status square, what isn't there, one sentence on what it will
 * show, and the setting that connects it with its docs. Never a zero, never a fake chart. `compact`
 * collapses it to one row for a module with nothing else to show.
 */
export function SourceState({ title, children, setting, docs, compact }: {
  title: ReactNode;
  children?: ReactNode;
  setting?: string;
  docs?: string;
  compact?: boolean;
}) {
  const href = docs ? docsLink(docs) : null;
  return (
    <div className={cx('source-state', compact && 'compact')}>
      <span className="source-state-mark" aria-hidden="true" />
      <div className="source-state-body">
        <div className="source-state-title">{title}</div>
        {children && <div className="source-state-what">{children}</div>}
        {(setting || docs) && (
          <div className="source-state-how">
            {setting && <>Set <code>{setting}</code>{docs ? ' · ' : ''}</>}
            {docs && (href
              ? <a href={href} target="_blank" rel="noreferrer">How to connect <span className="sr-only">(opens {docs})</span><span aria-hidden="true">→</span></a>
              : <>How to connect: <code>{docs}</code></>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── QueueItem ───────────────────────────────────────────────────────────────

export type QueueSeverity = 'critical' | 'warning' | 'info';

const SEVERITY: Record<QueueSeverity, { icon: ReactNode; word: string }> = {
  critical: { icon: I.alert, word: 'Critical' },
  warning: { icon: I.alert, word: 'Warning' },
  info: { icon: I.info, word: 'Info' },
};

/**
 * One thing that needs a human: a real link to where it is handled. Critical and warning rows carry
 * the 3px accent bar; the severity is also in words for a reader. `actionable: false` keeps the row
 * (the viewer should know it is waiting) and says who it waits for.
 */
export function QueueItem({ severity, icon, title, detail, age, ageTitle, href, actionable = true, waitingFor = 'Waiting for an approver' }: {
  severity: QueueSeverity;
  /** The kind's own icon, for an info row that is better recognised by what it is about. Critical and warning keep the alert. */
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  age?: ReactNode;
  ageTitle?: string;
  href: string;
  actionable?: boolean;
  waitingFor?: string;
}) {
  const s = SEVERITY[severity];
  return (
    <a className={cx('queue-item', `is-${severity}`)} href={href}>
      <span className="queue-ico" aria-hidden="true">{severity === 'info' && icon ? icon : s.icon}</span>
      <span className="sr-only">{s.word}: </span>
      <span className="queue-text">
        <span className="queue-title">{title}</span>
        {detail && <span className="queue-detail">{detail}</span>}
        {!actionable && <Badge tone="plain" mono={false}>{waitingFor}</Badge>}
      </span>
      {age != null && <span className="queue-age" title={ageTitle}>{age}</span>}
      <span className="queue-chev" aria-hidden="true">{I.caretRight}</span>
    </a>
  );
}

// ── HealthItem ──────────────────────────────────────────────────────────────

export type HealthItemState = 'ok' | 'degraded' | 'down' | 'unknown' | 'not_deployed';

/**
 * One component of the platform: a square (its state's colour; the neutral grey for unknown or not
 * deployed, with the words), its name and a short summary. As a button it opens the status detail.
 */
export function HealthItem({ label, state, summary, tip, onClick }: {
  label: string;
  state: HealthItemState;
  summary: string;
  tip?: string;
  onClick?: () => void;
}) {
  const word = state === 'not_deployed' ? 'not deployed' : state;
  const inner = (
    <>
      <span className={cx('health-mark', `is-${state}`)} aria-hidden="true" />
      <span className="health-label">{label}</span>
      <span className="health-summary">{summary}</span>
      {state !== 'ok' && !summary.toLowerCase().includes(word) && <span className="health-word">{word}</span>}
      <span className="sr-only">, {word}</span>
    </>
  );
  return onClick
    ? <ButtonBase className={cx('health-item', `is-${state}`)} onClick={onClick} title={tip}>{inner}</ButtonBase>
    : <span className={cx('health-item', `is-${state}`)} title={tip}>{inner}</span>;
}

// ── ActionTile ──────────────────────────────────────────────────────────────

/** A verb that opens its flow: icon, words, an optional hint and its key. */
export function ActionTile({ icon, verb, hint, kbd, href, onClick }: {
  icon: ReactNode;
  verb: ReactNode;
  hint?: ReactNode;
  kbd?: string;
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="action-tile-ico" aria-hidden="true">{icon}</span>
      <span className="action-tile-text">
        <span className="action-tile-verb">{verb}</span>
        {hint && <span className="action-tile-hint">{hint}</span>}
      </span>
      {kbd && <span className="action-tile-kbd" aria-hidden="true"><Kbd>{kbd}</Kbd></span>}
    </>
  );
  const shortcut = kbd ? { 'aria-keyshortcuts': kbd } : {};
  return href
    ? <a className="action-tile" href={href} {...shortcut}>{inner}</a>
    : <ButtonBase className="action-tile" onClick={onClick} {...shortcut}>{inner}</ButtonBase>;
}
