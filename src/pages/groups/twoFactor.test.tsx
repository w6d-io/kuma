import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, render } from '../../components/ui/testing';

// "Members must use 2FA": the badge follows each group's rule, a person who never enrolled cannot be
// ticked into such a group, and only a super admin flips the switch.

const h = vi.hoisted(() => ({
  rules: {} as Record<string, { required: boolean; enrolBeforeJoining?: boolean; source?: string | null }>,
  session: { permissions: ['*'] as string[] },
  setting: { data: { groups: ['super_admins'], defaultGroups: ['super_admins'] } as { groups: string[] } | undefined, isError: false },
  mutate: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../api/twoFactor', () => ({ useGroupSecondFactors: () => (g: string) => h.rules[g] }));
vi.mock('../../api/hooks', () => ({
  useSession: () => ({ data: h.session }),
  useSecondFactorGroups: () => h.setting,
  useSetSecondFactorGroups: () => ({ mutate: h.mutate, isPending: false }),
}));
vi.mock('../../contexts/AppContext', () => ({ useApp: () => ({ pushToast: h.toast }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

import { SiteGroupRows } from '../users/SiteGroupRows';
import { GroupSecondFactor } from './GroupSecondFactor';

const rowOf = (name: string) => [...document.querySelectorAll('.people-sep')].find((r) => r.textContent?.startsWith(name)) as HTMLElement;

beforeEach(() => {
  h.rules = { ops: { required: true }, platform: { required: false, enrolBeforeJoining: true }, readers: { required: false } };
  h.session.permissions = ['*'];
  h.setting = { data: { groups: ['super_admins'] }, isError: false };
  h.mutate.mockReset();
});
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
    expect(rowOf('platform').textContent).toContain('platform admin');
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

  it('adds the group to the list for a super admin, and explains both halves of the rule', () => {
    render(<GroupSecondFactor name="ops" rule={{ required: false }} />);
    expect(document.body.textContent).toContain('enrolled a second factor before being added');
    expect(sw().getAttribute('aria-checked')).toBe('false');
    click(sw());
    expect(h.mutate).toHaveBeenCalledWith(['ops', 'super_admins'], expect.anything());
  });

  it('removes it again', () => {
    h.setting = { data: { groups: ['ops', 'super_admins'] }, isError: false };
    render(<GroupSecondFactor name="ops" rule={{ required: true, source: 'setting' }} />);
    expect(sw().getAttribute('aria-checked')).toBe('true');
    act(() => { sw().click(); });
    expect(h.mutate).toHaveBeenCalledWith(['super_admins'], expect.anything());
  });

  it('is read-only for anybody but a super admin', () => {
    h.session.permissions = ['admin:write'];
    render(<GroupSecondFactor name="ops" rule={{ required: true }} />);
    expect(sw().disabled).toBe(true);
    expect(document.body.textContent).toContain('Only a super admin can change it.');
  });
});
