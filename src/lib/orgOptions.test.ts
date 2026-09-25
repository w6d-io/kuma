import { describe, it, expect } from 'vitest';
import { orgOptions, orgLabel } from './orgOptions';

const cat = [{ id: 'u2', name: 'Beta' }, { id: 'u1', name: 'Acme' }, { id: 'u3' }];

describe('orgOptions', () => {
  it('sorts by name and falls back to the id', () => {
    expect(orgOptions(cat).map((o) => o.label)).toEqual(['Acme', 'Beta', 'u3']);
  });

  it('keeps a value the catalogue does not know, last', () => {
    const opts = orgOptions(cat, ['zz-unknown', 'u1', undefined]);
    expect(opts.at(-1)).toEqual({ id: 'zz-unknown', label: 'zz-unknown', known: false });
    expect(opts.filter((o) => o.id === 'u1')).toHaveLength(1);
  });
});

describe('orgLabel', () => {
  it('names a known org and echoes an unknown id', () => {
    expect(orgLabel('u1', cat)).toBe('Acme');
    expect(orgLabel('nope', cat)).toBe('nope');
  });
});
