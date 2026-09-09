import { describe, it, expect } from 'vitest';
import { rulesSourceOf, rulesAreEditable } from './source';

// The default is the load-bearing part. A session from an older service answers no such field, and a
// console that read that as "not editable" would disable the editors of every deployment where they
// still work.

describe('where the rules are enforced from', () => {
  it('assumes this console is the source when the service says nothing', () => {
    expect(rulesSourceOf(undefined)).toBe('service');
    expect(rulesSourceOf({})).toBe('service');
    expect(rulesAreEditable({})).toBe(true);
  });

  it('takes the service at its word when it says the rules come from Git', () => {
    expect(rulesSourceOf({ rules_source: 'gitops' })).toBe('gitops');
    expect(rulesAreEditable({ rules_source: 'gitops' })).toBe(false);
  });

  it('treats anything it does not recognise as this console being the source', () => {
    // Failing the other way would disable the editors on a typo — a console that stops working
    // because a value was misspelled is worse than one that keeps its original behaviour.
    expect(rulesSourceOf({ rules_source: 'git-ops' })).toBe('service');
    expect(rulesSourceOf({ rules_source: 42 })).toBe('service');
    expect(rulesSourceOf({ rules_source: null })).toBe('service');
  });
});
