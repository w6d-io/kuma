import { describe, it, expect } from 'vitest';
import { membershipsOf } from './transforms';

// This one function decides what the screen that EDITS memberships starts from, and that screen
// saves what it shows. Reading the wrong field there does not display a wrong number — it writes one.

describe('membershipsOf', () => {
  it('takes the answer of the service that owns membership', () => {
    expect(
      membershipsOf({
        organizations: ['org-a', 'org-b', 'org-c'],
        metadata_admin: { organizations: ['stale'] },
      }),
    ).toEqual(['org-a', 'org-b', 'org-c']);
  });

  it('treats "belongs to nothing" as an answer, not as an absence', () => {
    // The whole hazard in one case: falling through here would resurrect a list the owner has
    // deleted, and the next save would write it back.
    expect(membershipsOf({ organizations: [], metadata_admin: { organizations: ['deleted'] } })).toEqual([]);
  });

  it('falls back to what was written on the identity when nobody owns membership', () => {
    expect(membershipsOf({ metadata_admin: { organizations: ['org-a'] } })).toEqual(['org-a']);
  });

  it('answers an empty list rather than undefined, so a caller can count without guarding', () => {
    expect(membershipsOf({})).toEqual([]);
    expect(membershipsOf({ metadata_admin: null })).toEqual([]);
  });
});
