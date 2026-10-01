import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, render } from '../../components/ui/testing';

// "Members must use 2FA": the badge follows each group's rule, a person who never enrolled cannot be
// ticked into such a group, and only groups.mfa:write flips the switch.

const h = vi.hoisted(() => ({
  rules: {} as Record<string, { required: boolean; enrolBeforeJoining?: boolean; source?: string | null }>,
  session: { permissions: ['groups.members:write', 'groups.mfa:write'] as string[] },
  setting: { data: { groups: ['super_admins'], defaultGroups: ['super_admins'] } as { groups: string[] } | undefined, isError: false },
  mutate: vi.fn(),
  setGroupRequired: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../api/twoFactor', () => ({ useGroupSecondFactors: () => (g: string) => h.rules[g], twoFactorApi: { setGroupRequired: h.setGroupRequired } }));
vi.mock('../../api/client', () => ({ api: { getSecondFactorGroups: async () => h.setting.data } }));
vi.mock('../../api/hooks', () => ({
  useSession: () => ({ data: h.session }),
  useSecondFactorGroups: () => h.setting,
  useSetSecondFactorGroups: () => ({ mutateAsync: h.mutate, isPending: false }),
}));
vi.mock('../../contexts/AppContext', () => ({ useApp: () => ({ pushToast: h.toast }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

import { SiteGroupRows } from '../users/SiteGroupRows';
import { GroupSecondFactor } from './GroupSecondFactor';

const rowOf = (name: string) => [...document.querySelectorAll('.people-sep')].find((r) => r.textContent?.startsWith(name)) as HTMLElement;

beforeEach(() => {
  h.rules = { ops: { required: true }, platform: { required: false, enrolBeforeJoining: true }, readers: { required: false } };
  h.session.permissions = ['groups.members:write', 'groups.mfa:write'];
  h.setting = { data: { groups: ['super_admins'] }, isError: false };
  h.mutate.mockReset().mockResolvedValue(undefined);
  h.setGroupRequired.mockReset().mockResolvedValue({ name: 'ops', secondFactor: { required: true } });
});
async function settle() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
afterEach(cleanup);

describe('group rows', () => {
  const mount = (targetMfa: boolean | undefined) => render(
    <SiteGroupRows checked={[]} toggle={() => {}} targetMfa={targetMfa} offered={['ops', 'platform', 'readers']} mayAssign privileged={(g) => g === 'platform'} describe={() => ''} />,
  );

  it('badges the groups whose members must use 2FA, and keeps them out of reach of somebody not enrolled', () => {
    mount(false);
    expect(rowOf('ops').textContent).toContain('2FA required');
    expect(rowOf('ops').textContent).toContain('needs 2FA enrolled');
    expect((rowOf('ops').querySelector('input') as HTMLInputElement).disabled).toBe(true);
    expect((rowOf('platform').querySelector('input') as HTMLInputElement).disabled).toBe(true);
    expect(rowOf('platform').textContent).toContain('platform');
    expect(rowOf('platform').textContent).not.toContain('2FA required');
    expect((rowOf('readers').querySelector('input') as HTMLInputElement).disabled).toBe(false);
  });

  it('lets an enrolled person be added', () => {
    mount(true);
    expect((rowOf('ops').querySelector('input') as HTMLInputElement).disabled).toBe(false);
    expect(rowOf('ops').textContent).not.toContain('needs 2FA enrolled');
  });
});

describe('Members must use 2FA', () => {
  const sw = () => document.querySelector('[aria-label="Members must use 2FA"]') as HTMLButtonElement;

  it('switches the group on through its own route for a groups.mfa:write holder, and explains both halves of the rule', async () => {
    render(<GroupSecondFactor name="ops" rule={{ required: false }} />);
    expect(document.body.textContent).toContain('enrolled a second factor before being added');
    expect(sw().getAttribute('aria-checked')).toBe('false');
    click(sw());
    await settle();
    expect(h.setGroupRequired).toHaveBeenCalledWith('ops', true);
    expect(h.mutate).not.toHaveBeenCalled();
    expect(sw().getAttribute('aria-checked')).toBe('true');
  });

  it('falls back to the settings list on a jinbe without the per-group route', async () => {
    h.setting = { data: { groups: ['ops', 'super_admins'] }, isError: false };
    h.setGroupRequired.mockRejectedValue(Object.assign(new Error('Route PUT:/api/admin/rbac/groups/ops/second-factor not found'), { status: 404 }));
    render(<GroupSecondFactor name="ops" rule={{ required: true, source: 'setting' }} />);
    expect(sw().getAttribute('aria-checked')).toBe('true');
    click(sw());
    await settle();
    expect(h.mutate).toHaveBeenCalledWith(['super_admins']);
  });

  it('is read-only without groups.mfa:write', () => {
    h.session.permissions = ['groups:write'];
    render(<GroupSecondFactor name="ops" rule={{ required: true }} />);
    expect(sw().disabled).toBe(true);
    expect(document.body.textContent).toContain('Changing it needs groups.mfa:write.');
    cleanup();
    h.session.permissions = ['groups.members:write', 'groups.mfa:write'];
    render(<GroupSecondFactor name="readers" rule={{ required: false, source: 'default', enrolBeforeJoining: false, defaultRequired: false }} />);
    expect(document.body.textContent).toContain('Not set yet: it follows the default for its roles. Default for this group: off.');
  });
});

describe('group rows under the holding rule', () => {
  it('keeps a group that gives what the caller does not hold out of reach, and says what', () => {
    render(<SiteGroupRows checked={[]} toggle={() => {}} targetMfa offered={['ops', 'readers']} mayAssign privileged={() => false} beyond={(g) => (g === 'ops' ? ['users:delete'] : [])} describe={() => ''} />);
    expect((rowOf('ops').querySelector('input') as HTMLInputElement).disabled).toBe(true);
    expect(rowOf('ops').getAttribute('title')).toContain('users:delete');
    expect((rowOf('readers').querySelector('input') as HTMLInputElement).disabled).toBe(false);
  });
});
