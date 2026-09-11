import { describe, it, expect } from 'vitest';
import { sharedTables, splitByKind } from './edges';
import type { EnforcedDocument } from '../api/client';

const rule = (name: string, authorizesAs?: string): EnforcedDocument =>
  ({
    kind: 'Rule',
    name,
    namespace: 'ory',
    decides: 'which requests reach this API',
    yaml: '',
    ...(authorizesAs
      ? { edge: { methods: [], url: '', authenticators: [], authorizer: 'remote_json', authorizesAs } }
      : {}),
  }) as EnforcedDocument;

const configMap = (name: string): EnforcedDocument =>
  ({ kind: 'ConfigMap', name, namespace: 'ory', decides: 'policy data', yaml: '' }) as EnforcedDocument;

describe('rules decided against the same route table', () => {
  it('reports a table two rules both name', () => {
    // The failure worth naming: the service is in the engine's payload, not the rule, so rules that
    // carry no payload of their own all inherit one value.
    const shared = sharedTables([rule('demo-api', 'strada-demo-api'), rule('other-api', 'strada-demo-api')]);

    expect(shared).toEqual([{ table: 'strada-demo-api', rules: ['demo-api', 'other-api'] }]);
  });

  it('says nothing when each rule has its own table', () => {
    // One rule per table is the arrangement working; reporting it would bury the case that is not.
    expect(sharedTables([rule('a', 'table-a'), rule('b', 'table-b')])).toEqual([]);
  });

  it('says nothing for a single rule', () => {
    expect(sharedTables([rule('only', 'strada-demo-api')])).toEqual([]);
  });

  it('ignores a rule whose table could not be read', () => {
    // An unreadable edge configuration leaves the field absent. Counting those together would invent
    // a collision out of two unknowns.
    expect(sharedTables([rule('a'), rule('b')])).toEqual([]);
  });

  it('reports each shared table separately', () => {
    const shared = sharedTables([
      rule('a1', 'table-a'),
      rule('a2', 'table-a'),
      rule('b1', 'table-b'),
      rule('b2', 'table-b'),
      rule('c', 'table-c'),
    ]);

    expect(shared.map(s => s.table).sort()).toEqual(['table-a', 'table-b']);
  });
});

describe('separating the APIs from the model', () => {
  it('keeps rules and everything else apart', () => {
    const { edges, model } = splitByKind([rule('demo-api', 'x'), configMap('authz'), configMap('strada-demo-api')]);

    expect(edges.map(d => d.name)).toEqual(['demo-api']);
    expect(model.map(d => d.name)).toEqual(['authz', 'strada-demo-api']);
  });

  it('answers two empty halves for nothing at all', () => {
    expect(splitByKind([])).toEqual({ edges: [], model: [] });
  });
});
