import { describe, expect, it } from 'vitest';
import { signUpGroupsOffered } from './signup';

// The groups a sign-up may add newcomers to: site roles only, never a platform role, never the site's own.

describe('signUpGroupsOffered', () => {
  const groups = {
    driver_onboarding: { backend: ['user'], persons: ['user'] },
    'staff-ops': { jinbe: ['ops'] },
    mixed: { persons: ['user'], kuma: ['viewer'] },
    'enrollment-service-users': { 'enrollment-service': ['user'] },
    empty: {},
  };

  it('offers groups giving site roles only, not platform ones, empty ones or the site\'s own', () => {
    expect(signUpGroupsOffered(groups, 'enrollment-service').map(([g]) => g)).toEqual(['driver_onboarding']);
  });

  it('keeps a picked group listed so it can be unticked', () => {
    expect(signUpGroupsOffered(groups, 'enrollment-service', ['mixed']).map(([g]) => g)).toEqual(['driver_onboarding', 'mixed']);
  });
});
