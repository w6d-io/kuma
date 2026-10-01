import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '../../components/ui/testing';

// What code defines (staff groups, super_admins) is read-only here, whoever asks: jinbe answers 409
// defined_in_code, and the editor shows no way to change it — from the list's flag, or from that 409.

const h = vi.hoisted(() => ({
  meta: {} as Record<string, { system?: boolean }>,
  save: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../contexts/AppContext', () => ({
  useApp: () => ({
    state: {
      groups: { staff_support: { jinbe: ['support'] }, payroll_editors: { payroll: ['editor'] } },
      groupsMeta: h.meta,
      services: [{ name: 'jinbe', system: true }, { name: 'payroll' }],
      roles: { jinbe: { support: ['users:read'] }, payroll: { editor: ['pay:write'], viewer: ['pay:read'] } },
    },
    pushToast: h.toast,
    pipeline: { run: vi.fn() },
    setPage: vi.fn(),
  }),
}));
vi.mock('../../api/rbacWrites', () => ({
  useSaveGroup: () => ({ mutateAsync: h.save, isPending: false }),
  useDeleteGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../api/twoFactor', () => ({ useGroupSecondFactors: () => () => undefined, useStepUpRules: () => ({ ruleOf: () => undefined }) }));
vi.mock('./GroupSecondFactor', () => ({ GroupSecondFactor: () => null }));

import { GroupEditor } from './GroupEditor';

const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;
const mount = (name: string) => render(<GroupEditor name={name} canEdit users={[]} onClose={() => {}} onCreated={() => {}} onDeleted={() => {}} />);
async function settle() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

beforeEach(() => { h.meta = {}; h.save.mockReset(); h.toast.mockReset(); });
afterEach(cleanup);

describe('GroupEditor and what code defines', () => {
  it('shows a code-defined group read-only: no delete, no review, every role box disabled', () => {
    h.meta = { staff_support: { system: true } };
    mount('staff_support');
    expect(document.body.textContent).toContain('is defined in code');
    expect(button('Delete')).toBeNull();
    expect(button('Review changes')).toBeNull();
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((b) => b.disabled)).toBe(true);
  });

  it('turns read-only when jinbe answers 409 defined_in_code to a save', async () => {
    h.save.mockRejectedValue(Object.assign(new Error("The group 'payroll_editors' is defined in code and cannot be changed here"), { status: 409, details: {} }));
    mount('payroll_editors');
    await act(async () => { [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((b) => !b.checked)!.click(); });
    act(() => { button('Review changes')!.click(); });
    await act(async () => { button('Save group')!.click(); });
    await settle();
    expect(h.toast).toHaveBeenCalledWith('The group payroll_editors is defined in code', expect.objectContaining({ err: true }));
    expect(document.body.textContent).toContain('is defined in code');
    expect(button('Review changes')).toBeNull();
  });

  it('never offers an "everything" role: each role is its permissions', () => {
    mount('payroll_editors');
    expect(document.body.textContent).not.toMatch(/everything/i);
    expect(document.body.textContent).toContain('pay:write');
  });
});
