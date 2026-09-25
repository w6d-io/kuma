import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, click, render, type } from './testing';
import { Button } from './Button';
import { Field } from './Field';
import { Input, Select, Textarea } from './Input';
import { Checkbox, RadioGroup } from './Checkbox';
import { Switch } from './Switch';

afterEach(cleanup);

describe('Button', () => {
  it('never submits a form by accident', () => {
    const { container } = render(<Button>Save</Button>);
    expect(container.querySelector('button')!.getAttribute('type')).toBe('button');
  });

  it('submits when asked to', () => {
    const { container } = render(<Button type="submit">Save</Button>);
    expect(container.querySelector('button')!.getAttribute('type')).toBe('submit');
  });

  it('carries its variant and size as classes', () => {
    const { container } = render(<Button variant="danger" size="sm">Delete</Button>);
    const cls = container.querySelector('button')!.className;
    expect(cls).toContain('btn');
    expect(cls).toContain('danger');
    expect(cls).toContain('sm');
  });

  it('is busy and refuses clicks while loading, keeping its label for the width', () => {
    const onClick = vi.fn();
    const { container } = render(<Button loading onClick={onClick}>Save</Button>);
    const b = container.querySelector('button')!;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.textContent).toContain('Save');
    click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('draws an icon-only button square, named by its label', () => {
    const { container } = render(<Button icon={<i />} iconOnly aria-label="Close" />);
    const b = container.querySelector('button')!;
    expect(b.className).toContain('icon-only');
    expect(b.getAttribute('aria-label')).toBe('Close');
  });
});

describe('Field', () => {
  it('ties the label, hint and error to the control inside it', () => {
    const { container } = render(
      <Field label="Email" hint="We never share it" error="Required" required>
        <Input />
      </Field>,
    );
    const input = container.querySelector('input')!;
    const label = container.querySelector('label')!;
    expect(label.htmlFor).toBe(input.id);
    expect(label.textContent).toContain('Email');
    const described = input.getAttribute('aria-describedby')!.split(' ');
    const texts = described.map((id) => document.getElementById(id)!.textContent);
    expect(texts).toEqual(['We never share it', 'Required']);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.required).toBe(true);
  });

  it('shows a warning without marking the value invalid', () => {
    const { container } = render(<Field label="Host" warning="Shared with another site"><Input /></Field>);
    const input = container.querySelector('input')!;
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(container.querySelector('.field-warning')!.textContent).toBe('Shared with another site');
  });

  it('wires selects and textareas the same way', () => {
    const { container } = render(
      <>
        <Field label="Group"><Select><option>a</option></Select></Field>
        <Field label="Note"><Textarea /></Field>
      </>,
    );
    const [l1, l2] = container.querySelectorAll('label');
    expect(l1.htmlFor).toBe(container.querySelector('select')!.id);
    expect(l2.htmlFor).toBe(container.querySelector('textarea')!.id);
  });

  it('keeps an id the caller chose', () => {
    const { container } = render(<Field label="Name"><Input id="mine" /></Field>);
    expect(container.querySelector('label')!.htmlFor).toBe('mine');
  });
});

describe('Input', () => {
  it('passes typing through', () => {
    function Box() {
      const [v, setV] = useState('');
      return <><Input value={v} onChange={(e) => setV(e.target.value)} /><output>{v}</output></>;
    }
    const { container } = render(<Box />);
    type(container.querySelector('input'), 'abc');
    expect(container.querySelector('output')!.textContent).toBe('abc');
  });

  it('puts a leading icon inside the box', () => {
    const { container } = render(<Input leading={<i className="lead" />} />);
    expect(container.querySelector('.input-wrap .input-lead .lead')).not.toBeNull();
    expect(container.querySelector('input')!.className).toContain('has-lead');
  });
});

describe('Checkbox', () => {
  it('is a labelled native checkbox', () => {
    const onChange = vi.fn();
    const { container } = render(<Checkbox checked={false} onChange={onChange} label="Remember" />);
    const box = container.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(box.closest('label')!.textContent).toContain('Remember');
    click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Checkbox indeterminate', () => {
  it('shows a partial selection and still hands back the new state', () => {
    const onChange = vi.fn();
    const { container } = render(<Checkbox checked={false} indeterminate onChange={onChange} label="Select all" />);
    const box = container.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('RadioGroup', () => {
  it('is a labelled group of native radios sharing a name', () => {
    const onChange = vi.fn();
    const { container } = render(
      <RadioGroup label="On expiry" name="exp" value="flag" onChange={onChange}
        options={[{ value: 'flag', label: 'Flag', hint: 'mark it' }, { value: 'revoke', label: 'Revoke' }]} />,
    );
    const group = container.querySelector('[role=radiogroup]')!;
    expect(group.getAttribute('aria-label')).toBe('On expiry');
    const radios = container.querySelectorAll<HTMLInputElement>('input[type=radio]');
    expect([...radios].map((r) => [r.name, r.checked])).toEqual([['exp', true], ['exp', false]]);
    click(radios[1]);
    expect(onChange).toHaveBeenCalledWith('revoke');
  });
});

describe('Switch', () => {
  it('announces its state and flips it', () => {
    const onChange = vi.fn();
    const { container } = render(<Switch on={false} onChange={onChange} label="Registration" />);
    const s = container.querySelector('[role=switch]')!;
    expect(s.getAttribute('aria-checked')).toBe('false');
    expect(s.getAttribute('aria-label')).toBe('Registration');
    click(s);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does nothing when disabled', () => {
    const onChange = vi.fn();
    const { container } = render(<Switch on onChange={onChange} disabled />);
    click(container.querySelector('[role=switch]'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
