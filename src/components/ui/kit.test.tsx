import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { cleanup, click, key, render, type } from './testing';
import { Tabs, Segmented } from './Tabs';
import { Table, Th, EmptyRow, LoadingRows, sortRows, nextSort } from './Table';
import { DiffView, diffFields } from './DiffView';
import { CodeView } from './CodeView';
import { Stepper } from './Stepper';
import { Timeline } from './Timeline';
import { Dialog, ConfirmDialog } from './Dialog';
import { Drawer } from './Drawer';
import { Badge } from './Badge';
import { EmptyState } from './EmptyState';
import { PageHeader } from './PageHeader';
import { Toasts } from './Toast';
import { Tooltip } from './Tooltip';

afterEach(cleanup);

describe('Tabs', () => {
  const items = [
    { value: 'a', label: 'Access' },
    { value: 'b', label: 'Sessions', count: 3 },
    { value: 'c', label: 'Danger' },
  ];

  function Controlled({ onChange }: { onChange?: (v: string) => void }) {
    const [v, setV] = useState('a');
    return <Tabs label="User" items={items} value={v} onChange={(n) => { setV(n); onChange?.(n); }} />;
  }

  it('is a tablist with one selected tab', () => {
    const { container } = render(<Controlled />);
    const tabs = container.querySelectorAll('[role=tab]');
    expect(container.querySelector('[role=tablist]')!.getAttribute('aria-label')).toBe('User');
    expect([...tabs].map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect([...tabs].map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(tabs[1].textContent).toContain('3');
  });

  it('moves with the arrow keys, wrapping at both ends, and Home/End', () => {
    const onChange = vi.fn();
    const { container } = render(<Controlled onChange={onChange} />);
    const list = container.querySelector('[role=tablist]')!;
    key(list.querySelector('[aria-selected=true]'), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('b');
    key(list.querySelector('[aria-selected=true]'), 'End');
    expect(onChange).toHaveBeenLastCalledWith('c');
    key(list.querySelector('[aria-selected=true]'), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('a');
    key(list.querySelector('[aria-selected=true]'), 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('c');
    key(list.querySelector('[aria-selected=true]'), 'Home');
    expect(onChange).toHaveBeenLastCalledWith('a');
    expect(document.activeElement).toBe(list.querySelector('[aria-selected=true]'));
  });

  it('selects on click', () => {
    const onChange = vi.fn();
    const { container } = render(<Controlled onChange={onChange} />);
    click(container.querySelectorAll('[role=tab]')[2]);
    expect(onChange).toHaveBeenCalledWith('c');
  });
});

describe('Segmented', () => {
  it('is a group of pressed/unpressed buttons', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Segmented label="Window" value="24h" onChange={onChange} options={[{ value: '1h', label: '1h' }, { value: '24h', label: '24h' }]} />,
    );
    const btns = container.querySelectorAll('button');
    expect(container.querySelector('[role=group]')!.getAttribute('aria-label')).toBe('Window');
    expect([...btns].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    click(btns[0]);
    expect(onChange).toHaveBeenCalledWith('1h');
  });
});

describe('sorting', () => {
  const rows = [{ n: 'b', v: 2 }, { n: 'a', v: 10 }, { n: 'c', v: 2 }];

  it('sorts numbers as numbers and strings by locale, keeping ties in order', () => {
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.n)).toEqual(['b', 'c', 'a']);
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.n)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, (r) => r.n, 'asc').map((r) => r.n)).toEqual(['a', 'b', 'c']);
  });

  it('does not reorder the array it was given', () => {
    sortRows(rows, (r) => r.n, 'asc');
    expect(rows.map((r) => r.n)).toEqual(['b', 'a', 'c']);
  });

  it('cycles a column ascending, descending, then back to ascending, and restarts on a new column', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort({ key: 'name', dir: 'desc' }, 'when')).toEqual({ key: 'when', dir: 'asc' });
  });
});

describe('Table', () => {
  it('announces the sorted column and asks to sort on click', () => {
    const onSort = vi.fn();
    const { container } = render(
      <Table>
        <thead><tr>
          <Th sortKey="name" sort={{ key: 'name', dir: 'desc' }} onSort={onSort}>Name</Th>
          <Th sortKey="when" sort={{ key: 'name', dir: 'desc' }} onSort={onSort}>When</Th>
          <Th>Plain</Th>
        </tr></thead>
        <tbody><EmptyRow colSpan={3}>No users.</EmptyRow></tbody>
      </Table>,
    );
    const ths = container.querySelectorAll('th');
    expect(ths[0].getAttribute('aria-sort')).toBe('descending');
    expect(ths[1].getAttribute('aria-sort')).toBe('none');
    expect(ths[2].hasAttribute('aria-sort')).toBe(false);
    click(ths[1].querySelector('button'));
    expect(onSort).toHaveBeenCalledWith('when');
    const td = container.querySelector('tbody td')!;
    expect(td.getAttribute('colspan')).toBe('3');
    expect(td.textContent).toBe('No users.');
  });

  it('holds the columns with placeholder rows while loading', () => {
    const { container } = render(<Table><tbody><LoadingRows cols={4} rows={2} /></tbody></Table>);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelectorAll('tbody tr:first-child td')).toHaveLength(4);
  });
});

describe('diffFields', () => {
  it('names every field as changed, added, removed or unchanged', () => {
    const d = diffFields(
      { host: 'a.example', upstream: 'http://a', roles: 'standard', gone: 'x' },
      { host: 'a.example', upstream: 'http://b', roles: 'standard', fresh: 'y' },
      { host: 'Address', upstream: 'Upstream' },
    );
    expect(d.map((f) => [f.key, f.kind])).toEqual([
      ['host', 'same'], ['upstream', 'changed'], ['roles', 'same'], ['gone', 'removed'], ['fresh', 'added'],
    ]);
    expect(d[1]).toMatchObject({ label: 'Upstream', before: 'http://a', after: 'http://b' });
    expect(d[2].label).toBe('roles');
  });

  it('compares lists and objects by value, not identity', () => {
    const d = diffFields({ m: ['GET', 'POST'], o: { a: 1 } }, { m: ['GET', 'POST'], o: { a: 2 } });
    expect(d.map((f) => f.kind)).toEqual(['same', 'changed']);
  });
});

describe('DiffView', () => {
  it('shows only what changed unless asked for everything', () => {
    const { container, rerender } = render(<DiffView before={{ a: '1', b: '2' }} after={{ a: '1', b: '3' }} />);
    expect(container.querySelectorAll('.diffview-row')).toHaveLength(1);
    expect(container.querySelector('.diffview-row.changed .diffview-before')!.textContent).toBe('2');
    expect(container.querySelector('.diffview-row.changed .diffview-after')!.textContent).toBe('3');
    rerender(<DiffView before={{ a: '1', b: '2' }} after={{ a: '1', b: '3' }} showUnchanged />);
    expect(container.querySelectorAll('.diffview-row')).toHaveLength(2);
  });

  it('says so when nothing changed', () => {
    const { container } = render(<DiffView before={{ a: '1' }} after={{ a: '1' }} />);
    expect(container.textContent).toContain('No changes');
  });
});

describe('CodeView', () => {
  it('copies the code and says it did', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = render(<CodeView code={'a: 1\nb: 2'} title="rule.yaml" />);
    expect(container.querySelector('pre')!.textContent).toBe('a: 1\nb: 2');
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label^="Copy"]')!.click(); });
    expect(writeText).toHaveBeenCalledWith('a: 1\nb: 2');
    expect(container.querySelector('button[aria-label^="Copy"]')!.textContent).toContain('Copied');
  });

  it('says so when the clipboard refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    const { container } = render(<CodeView code="x" />);
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label^="Copy"]')!.click(); });
    expect(container.querySelector('button[aria-label^="Copy"]')!.textContent).toContain('Copy failed');
  });
});

describe('Stepper', () => {
  it('marks steps before the current one done and the current one as the step', () => {
    const { container } = render(<Stepper current="probe" steps={[{ id: 'addr', label: 'Address' }, { id: 'probe', label: 'Probe' }, { id: 'review', label: 'Review' }]} />);
    const items = container.querySelectorAll('li');
    expect([...items].map((li) => li.className.match(/\b(done|current|upcoming)\b/)![1])).toEqual(['done', 'current', 'upcoming']);
    expect(items[1].getAttribute('aria-current')).toBe('step');
  });
});

describe('Timeline', () => {
  it('draws each event in its state, named in words as well as colour', () => {
    const { container } = render(
      <Timeline items={[
        { id: '1', label: 'Stored', state: 'done', meta: '12 ms' },
        { id: '2', label: 'Bundle', state: 'running' },
        { id: '3', label: 'Engine', state: 'failed', detail: 'timeout' },
        { id: '4', label: 'Live', state: 'pending' },
      ]} />,
    );
    const items = container.querySelectorAll('li');
    expect([...items].map((li) => li.dataset.state)).toEqual(['done', 'running', 'failed', 'pending']);
    expect(items[2].textContent).toContain('failed');
    expect(items[2].textContent).toContain('timeout');
    expect(items[1].getAttribute('aria-current')).toBe('step');
  });
});

describe('Dialog', () => {
  it('renders its title and body only while open, and closes from its button', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog open={false} onClose={onClose} title="Export">body</Dialog>);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    rerender(<Dialog open onClose={onClose} title="Export" footer={<span>foot</span>}>body</Dialog>);
    const dlg = document.querySelector('[role=dialog]')!;
    expect(dlg.textContent).toContain('Export');
    expect(dlg.textContent).toContain('body');
    expect(dlg.textContent).toContain('foot');
    click(dlg.querySelector('button[aria-label=Close]'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  it('holds the confirm button until the exact text is typed', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Delete org" requireText="acme" danger confirmLabel="Delete" onConfirm={onConfirm} onCancel={() => {}} />);
    const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete')!;
    expect(confirm.disabled).toBe(true);
    type(document.querySelector('[role=dialog] input'), 'acme');
    expect(confirm.disabled).toBe(false);
    expect(confirm.className).toContain('danger');
    click(confirm);
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('Drawer', () => {
  it('is a labelled dialog at the side of the screen', () => {
    render(<Drawer open onClose={() => {}} title="Grant access" eyebrow="People">x</Drawer>);
    const dlg = document.querySelector('[role=dialog]')!;
    expect(dlg.className).toContain('drawer');
    expect(dlg.textContent).toContain('Grant access');
    expect(dlg.textContent).toContain('People');
  });
});

describe('small pieces', () => {
  it('Badge carries its tone', () => {
    const { container } = render(<Badge tone="danger">off</Badge>);
    expect(container.querySelector('.badge')!.className).toContain('danger');
  });

  it('EmptyState says what is empty and offers the way out', () => {
    const { container } = render(<EmptyState title="No sites yet" action={<button>Plug a site</button>}>Plug one to start.</EmptyState>);
    expect(container.textContent).toContain('No sites yet');
    expect(container.textContent).toContain('Plug one to start.');
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('PageHeader renders a heading, subtitle and actions', () => {
    const { container } = render(<PageHeader title="Users" sub="12 identities" actions={<button>Create</button>} />);
    expect(container.querySelector('h1')!.textContent).toBe('Users');
    expect(container.textContent).toContain('12 identities');
    expect(container.querySelector('.page-actions button')).not.toBeNull();
  });

  it('Toasts announce politely and mark failures', () => {
    const { container } = render(<Toasts toasts={[{ id: '1', msg: 'Saved' }, { id: '2', msg: 'Failed', err: true }]} />);
    expect(container.querySelector('[aria-live=polite]')).not.toBeNull();
    expect(container.querySelectorAll('.toast.err')).toHaveLength(1);
  });

  it('Tooltip describes its trigger', () => {
    const { container } = render(<Tooltip content="Copies the id"><span>id</span></Tooltip>);
    const trigger = container.querySelector('.tooltip-trigger')!;
    const tip = document.getElementById(trigger.getAttribute('aria-describedby')!)!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toBe('Copies the id');
  });
});
