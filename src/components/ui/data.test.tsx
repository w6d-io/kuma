import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, key, render } from './testing';
import { BarSeries, Meter } from './Chart';
import { ActionTile, HealthItem, Kpi, QueueItem, RelativeTime, SourceState } from './Briefing';

afterEach(cleanup);

const buckets = Array.from({ length: 4 }, (_, i) => ({ t: new Date(Date.UTC(2026, 8, 26, i)).toISOString(), a: i * 10, b: i }));

describe('BarSeries', () => {
  it('is one labelled group with one bar in the tab order, moved by the arrow keys', () => {
    const { container } = render(<BarSeries buckets={buckets} labels={{ a: 'signed in', b: 'failed' }} summary="Sign-ins, last 24 h" />);
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Sign-ins, last 24 h');
    const bars = () => [...container.querySelectorAll('.bars-bar')];
    expect(bars().map((b) => b.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0']);
    key(bars()[3], 'Home');
    expect(bars()[0].getAttribute('tabindex')).toBe('0');
    expect(bars()[0].getAttribute('aria-label')).toContain('0 signed in, 0 failed');
    key(bars()[0], 'ArrowRight');
    expect(bars()[1].getAttribute('tabindex')).toBe('0');
  });

  it('makes each bar a link when given where to go', () => {
    const { container } = render(<BarSeries buckets={buckets} labels={{ a: 'allowed' }} summary="x" hrefOf={(t) => `#/audit?from=${t}`} />);
    expect(container.querySelectorAll('a.bars-bar')).toHaveLength(4);
  });

  it('gives the same figures as a table', () => {
    const { container } = render(<BarSeries buckets={buckets} labels={{ a: 'signed in', b: 'failed' }} summary="x" />);
    const toggle = container.querySelector('.bars-table-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    click(toggle);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(container.querySelector('thead')!.textContent).toContain('failed');
  });
});

describe('Meter', () => {
  it('is a meter with the figure in words beside the bar', () => {
    const { container } = render(<Meter value={292} of={412} label="Second factor" />);
    const m = container.querySelector('[role=meter]')!;
    expect(m.getAttribute('aria-valuetext')).toBe('71%, 292 of 412');
    expect(container.textContent).toContain('71%');
  });
});

describe('Kpi', () => {
  it('links to where the number came from and reads the change in words', () => {
    const { container } = render(<Kpi label="Signed in" value="342" sub="−8%" subLabel="down 8 percent" href="#/audit" />);
    expect(container.querySelector('a')!.getAttribute('href')).toBe('#/audit');
    expect(container.querySelector('.kpi-sub')!.getAttribute('aria-label')).toBe('down 8 percent');
  });
});

describe('SourceState', () => {
  it('names the setting and links the docs it can resolve', () => {
    const { container } = render(<SourceState title="Not connected" setting="PROMETHEUS_URL" docs="jinbe/docs/observability.md">Certificates</SourceState>);
    expect(container.querySelector('code')!.textContent).toBe('PROMETHEUS_URL');
    expect(container.querySelector('a')!.getAttribute('href')).toBe('https://github.com/w6d-io/jinbe/blob/develop/docs/observability.md');
  });

  it('keeps a docs path it cannot link on screen', () => {
    const { container } = render(<SourceState title="Not connected" docs="docs/OBSERVABILITY.md" />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('docs/OBSERVABILITY.md');
  });
});

describe('QueueItem', () => {
  it('is a link that says its severity in words', () => {
    const { container } = render(<QueueItem severity="critical" title="Apply request" href="#/sites" age="12 min" />);
    const a = container.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('#/sites');
    expect(a.classList.contains('is-critical')).toBe(true);
    expect(a.textContent).toContain('Critical:');
  });

  it('says who it waits for when the viewer cannot act', () => {
    const { container } = render(<QueueItem severity="warning" title="Apply request" href="#/sites" actionable={false} />);
    expect(container.textContent).toContain('Waiting for a super admin');
  });
});

describe('HealthItem', () => {
  it('says the state in words, with an outline square for not deployed', () => {
    const onClick = vi.fn();
    const { container } = render(<HealthItem label="Gateway" state="not_deployed" summary="CRD absent" onClick={onClick} />);
    expect(container.querySelector('.health-mark.is-not_deployed')).not.toBeNull();
    expect(container.textContent).toContain('not deployed');
    click(container.querySelector('button'));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('ActionTile', () => {
  it('is a link or a button, and announces its key', () => {
    const { container } = render(<><ActionTile icon="+" verb="Plug a site" kbd="n" href="#/sites/new" /><ActionTile icon="g" verb="Grant access" onClick={() => {}} /></>);
    expect(container.querySelector('a')!.getAttribute('aria-keyshortcuts')).toBe('n');
    expect(container.querySelector('button')!.textContent).toContain('Grant access');
  });
});

describe('RelativeTime', () => {
  it('is a <time> with the absolute moment, and a dash for no time', () => {
    const at = new Date(Date.now() - 12 * 60_000).toISOString();
    const { container } = render(<><RelativeTime at={at} /><RelativeTime at={null} /></>);
    expect(container.querySelector('time')!.textContent).toBe('12 min ago');
    expect(container.textContent).toContain('—');
  });
});
