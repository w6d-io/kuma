import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { cleanup, click, render, type } from './testing';
import { TagList } from './Badge';
import { CopyField } from './CopyField';
import { ChecklistGroups, type ChecklistGroup } from './Checklist';
import { Field } from './Field';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TagList', () => {
  it('shows every tag when they fit', () => {
    const { container } = render(<TagList label="Scopes" items={['a:read', 'a:write']} />);
    expect(container.querySelector('[role=list]')!.getAttribute('aria-label')).toBe('Scopes');
    expect([...container.querySelectorAll('.badge.is-tag')].map((b) => b.textContent)).toEqual(['a:read', 'a:write']);
    expect(container.querySelector('.badge.is-count')).toBeNull();
  });

  it('folds the rest into a focusable +N whose tooltip names them', () => {
    const { container } = render(<TagList items={['a', 'b', 'c', 'd', 'e']} max={3} />);
    expect(container.querySelectorAll('.badge.is-tag').length).toBe(2);
    expect(container.querySelector('.badge.is-count')!.textContent).toBe('+3');
    const trigger = container.querySelector('.tooltip-trigger')!;
    expect(trigger.getAttribute('tabindex')).toBe('0');
    expect(document.getElementById(trigger.getAttribute('aria-describedby')!)!.textContent).toBe('c, d, e');
  });

  it('says so when there is none', () => {
    const { container } = render(<TagList items={[]} empty="No scopes" />);
    expect(container.textContent).toBe('No scopes');
  });
});

describe('CopyField', () => {
  it('copies the value and says so', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const onCopied = vi.fn();
    const { container } = render(<Field label="Secret"><CopyField value="s3cr3t" onCopied={onCopied} /></Field>);
    const input = container.querySelector('input')!;
    expect(input.readOnly).toBe(true);
    expect(container.querySelector('label')!.getAttribute('for')).toBe(input.id);
    await act(async () => { container.querySelector('button')!.click(); });
    expect(writeText).toHaveBeenCalledWith('s3cr3t');
    expect(onCopied).toHaveBeenCalled();
    expect(container.querySelector('button')!.textContent).toContain('Copied');
  });

  it('selects the text and says to copy it by hand when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    const onCopied = vi.fn();
    const { container } = render(<CopyField label="Key" value="k" onCopied={onCopied} />);
    await act(async () => { container.querySelector('button')!.click(); });
    expect(onCopied).not.toHaveBeenCalled();
    expect(container.querySelector('.copy-field-note')!.textContent).toMatch(/copy it with/);
    expect(document.activeElement).toBe(container.querySelector('input'));
  });
});

describe('ChecklistGroups', () => {
  const groups: ChecklistGroup[] = [
    { id: 'billing', label: 'billing', options: [{ value: 'billing:read', label: 'billing:read' }, { value: 'billing:write', label: 'billing:write' }] },
    { id: 'wiki', label: 'wiki', options: [{ value: 'wiki:read', label: 'wiki:read' }, { value: 'billing:read', label: 'billing:read' }] },
  ];
  function Controlled({ onChange, searchAt }: { onChange?: (v: string[]) => void; searchAt?: number }) {
    const [v, setV] = useState<string[]>(['billing:read']);
    return <ChecklistGroups label="Scopes" groups={groups} value={v} searchAt={searchAt} onChange={(n) => { setV(n); onChange?.(n); }} />;
  }
  const box = (c: HTMLElement, text: string) => [...c.querySelectorAll('label.checkbox')].filter((l) => l.textContent?.startsWith(text)).map((l) => l.querySelector('input')!);

  it('names each group, counts the choice, and partly ticks a partly chosen group', () => {
    const { container } = render(<Controlled />);
    expect(container.querySelector('[role=group]')!.getAttribute('aria-label')).toBe('Scopes');
    expect([...container.querySelectorAll('legend')].map((l) => l.textContent)).toEqual(['billing', 'wiki']);
    expect(container.querySelector('.checklist-count')!.textContent).toBe('1 of 3 selected');
    const [billingAll] = box(container, 'billing1 of 2');
    expect(billingAll.indeterminate).toBe(true);
  });

  it('ticks a whole group, and one value listed twice is one choice', () => {
    const onChange = vi.fn();
    const { container } = render(<Controlled onChange={onChange} />);
    click(box(container, 'wiki1 of 2')[0]);
    expect(onChange).toHaveBeenLastCalledWith(['billing:read', 'wiki:read']);
    // billing:read shows under both groups; clearing it once clears it in both.
    click(box(container, 'billing:read')[1]);
    expect(onChange).toHaveBeenLastCalledWith(['wiki:read']);
    expect(box(container, 'billing:read').every((b) => !b.checked)).toBe(true);
  });

  it('filters once long, keeping what is ticked', () => {
    const { container } = render(<Controlled searchAt={2} />);
    type(container.querySelector('input[aria-label="Filter scopes"]'), 'wiki');
    expect(container.textContent).not.toContain('billing:write');
    expect(container.querySelector('.checklist-count')!.textContent).toBe('1 of 3 selected');
  });
});
