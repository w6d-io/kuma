import { describe, it, expect } from 'vitest';
import { checkLines, checkText } from './format';

describe('checkText', () => {
  it('says where an organization feature sits while organizations are off', () => {
    expect(checkText({ level: 'error', code: 'organizations_off', message: 'x', path: 'routes.items.2.orgParam' })).toMatch(/^A route is scoped to an organization.*Access → Organizations/);
    expect(checkText({ level: 'error', code: 'organizations_off', message: 'x', path: 'signUp.orgs' })).toMatch(/Sign-up/);
    expect(checkText({ level: 'error', code: 'organizations_off', message: 'x', path: 'groups.orgGrantable' })).toMatch(/org roles/);
  });
  it('names the gate and the role the server message carries', () => {
    expect(checkText({ level: 'error', code: 'tokens_need_policy', message: "gate 'api' admits API tokens but…", path: 'gates.1.authorizer' })).toMatch(/^Gate “api” lets API keys in/);
    expect(checkText({ level: 'error', code: 'every_org_own_group', message: 'x', path: 'everyOrg.editor' })).toMatch(/^Role editor reaches into every organization/);
  });
  it('words the other new codes, and leaves the rest as jinbe says them', () => {
    for (const code of ['unknown_owner_role', 'upstream_path_unsupported', 'unknown_org', 'no_owner_role']) {
      expect(checkText({ level: 'error', code, message: 'raw' })).not.toBe('raw');
    }
    expect(checkLines([{ level: 'warn', code: 'something_else', message: 'as is' }])).toEqual([{ level: 'warn', text: 'as is' }]);
  });
});
