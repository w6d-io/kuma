import { describe, it, expect } from 'vitest';
import { kratosToUser, membershipsOf } from './transforms';

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

describe('which memberships a row shows', () => {
  const identity = (extra: Record<string, unknown>) =>
    ({
      id: 'fd5346c0',
      traits: { email: 'jonathan@strada.eu' },
      state: 'active',
      ...extra,
    }) as never;

  it('shows what is enforced, not the copy Kratos keeps', () => {
    // Measured on a real account: `group_members` held `platform-operator` and the Kratos copy held
    // `users`. Reading the copy first made the enforced membership invisible on the screen that
    // edits it — and the drawer seeds from this row, so it offered to remove a group it never showed.
    const user = kratosToUser(identity({ groups: ['platform-operator'], metadata_admin: { groups: ['users'] } }));
    expect(user.groups).toEqual(['platform-operator']);
  });

  it('falls back to the copy when nothing enforced is reported', () => {
    // jinbe answers no `groups` when it could not resolve them. An identifier and a stale name beat
    // an empty list, which would read as "this person holds nothing".
    const user = kratosToUser(identity({ metadata_admin: { groups: ['users'] } }));
    expect(user.groups).toEqual(['users']);
  });

  it('answers an empty list when neither says anything', () => {
    expect(kratosToUser(identity({})).groups).toEqual([]);
  });
});
