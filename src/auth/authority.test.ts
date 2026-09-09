import { describe, it, expect } from 'vitest';
import { emptyOrganisationsHint, organisationsSourceNote, readAuthorityName } from './authority';

// An empty list of organisations has two opposite meanings, and telling them apart is the whole
// point. Owned here, it means somebody must be added to a group — the reader can act. Read from the
// token, it means the authority said so, and sending the reader to ask an administrator on this
// screen is advice that cannot be followed.

describe('readAuthorityName', () => {
  it('reads the name the deployment gave', () => {
    expect(readAuthorityName({ __ORG_AUTHORITY__: 'UAM' })).toBe('UAM');
  });

  it('reads an unset variable as unnamed', () => {
    // envsubst leaves the placeholder in place, so this is what unset looks like in a browser.
    expect(readAuthorityName({ __ORG_AUTHORITY__: '${ORG_AUTHORITY}' })).toBe('');
    expect(readAuthorityName({ __ORG_AUTHORITY__: '  ' })).toBe('');
    expect(readAuthorityName({})).toBe('');
  });
});

describe('emptyOrganisationsHint', () => {
  it('when this console owns the model, tells the reader what to ask for', () => {
    const hint = emptyOrganisationsHint('delegated', 'UAM');

    expect(hint.actionable).toBe(true);
    expect(hint.message).toContain('org-admin group');
    // The name of an external directory has no business here: nothing outside decided this.
    expect(hint.message).not.toContain('UAM');
  });

  it('when the token decides, says so and names the directory', () => {
    const hint = emptyOrganisationsHint('claim', 'UAM');

    expect(hint.actionable).toBe(false);
    expect(hint.message).toContain('managed in UAM');
    // Never the advice that cannot be followed.
    expect(hint.message).not.toContain('super_admin');
  });

  it('falls back to a name anybody can read when the deployment gave none', () => {
    const hint = emptyOrganisationsHint('claim', '');

    expect(hint.message).toContain('identity provider');
    expect(hint.actionable).toBe(false);
  });
});

describe('organisationsSourceNote', () => {
  it('says nothing when this console owns the model', () => {
    expect(organisationsSourceNote('delegated', 'UAM')).toBeNull();
    expect(organisationsSourceNote('all', 'UAM')).toBeNull();
  });

  it('warns that a shown list is read-only here, and where it lives', () => {
    // Shown next to a NON-empty list: the reader has to know before trying to change it.
    expect(organisationsSourceNote('claim', 'UAM')).toBe('Managed in UAM — read-only here.');
  });

  it('warns without a name when the deployment gave none', () => {
    expect(organisationsSourceNote('claim', '')).toContain('identity provider');
  });
});
