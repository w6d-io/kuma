import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render, type } from '../../components/ui/testing';
import type { DeletionRequest } from '../../lib/sites/types';

// Deletion requests: asked by somebody without sites:delete, decided by somebody else (four-eyes).

const h = vi.hoisted(() => ({
  perms: { canRead: true, canDraft: false, canApply: false, canDelete: true, canRequest: true, email: 'bob@x' as string | null },
  api: { deletionRequests: vi.fn(), pendingDeletions: vi.fn(), approveDeletion: vi.fn(), rejectDeletion: vi.fn(), requestDeletion: vi.fn() },
  toast: vi.fn(),
}));
vi.mock('../../api/sites', () => ({ sitesApi: h.api, notAvailable: () => false, siteKeys: { deletions: () => ['sites', 'deletions'], list: () => ['sites', 'list'] } }));
vi.mock('./usePerms', () => ({ useSitePerms: () => h.perms }));
vi.mock('../../contexts/AppContext', () => ({ useApp: () => ({ pushToast: h.toast }) }));
vi.mock('../../api/hooks', () => ({ useSession: () => ({ data: { groups: ['g'] } }) }));

import { DeletionInbox, DeletionRequestsCard, SiteDeletionPending } from './Deletions';

const req = (over: Partial<DeletionRequest> = {}): DeletionRequest => ({
  id: 'r1', site: 'demo', requestedBy: 'ann@x', requestedAt: new Date(Date.now() - 3_600_000).toISOString(), state: 'pending', reason: 'demo over', ...over,
});
const mount = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const text = () => document.body.textContent ?? '';
const button = (label: RegExp, root: ParentNode = document) => [...root.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement | undefined;
const modal = () => document.querySelector('.modal') as HTMLElement;

beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockReset());
  h.toast.mockReset();
  Object.assign(h.perms, { canDelete: true, canRequest: true, email: 'bob@x' });
});
afterEach(cleanup);

describe('deletion requests', () => {
  it('lets somebody else approve, after typing the site name', async () => {
    h.api.deletionRequests.mockResolvedValue([req()]);
    h.api.approveDeletion.mockResolvedValue({ request: req({ state: 'approved' }), deleted: true });
    const onDeleted = vi.fn();
    mount(<SiteDeletionPending name="demo" onDeleted={onDeleted} />);
    await settle();
    expect(text()).toContain('ann@x asks to delete this site');
    expect(text()).toContain('“demo over”');
    click(button(/^Approve & delete$/)!);
    const confirm = button(/^Approve & delete$/, modal())!;
    expect(confirm.disabled).toBe(true);
    type(modal().querySelector('input'), 'demo');
    click(confirm);
    await settle();
    expect(h.api.approveDeletion).toHaveBeenCalledWith('r1');
    expect(onDeleted).toHaveBeenCalled();
  });

  it('hides the decision from the requester (four-eyes) and from anybody without sites:delete', async () => {
    h.api.pendingDeletions.mockResolvedValue([req({ requestedByYou: true }), req({ id: 'r2', site: 'other', requestedBy: 'cy@x', requestedByYou: false })]);
    mount(<DeletionInbox />);
    await settle();
    const cards = [...document.querySelectorAll('.panel')];
    expect(cards[0].textContent).toContain('You asked — someone else decides.');
    expect(button(/^Approve/, cards[0])).toBeUndefined();
    expect(button(/^Approve/, cards[1])).toBeDefined();
    cleanup();

    h.perms.canDelete = false;
    h.api.deletionRequests.mockResolvedValue([req()]);
    mount(<SiteDeletionPending name="demo" onDeleted={() => {}} />);
    await settle();
    expect(text()).toContain('asks to delete this site');
    expect(button(/^Approve|^Reject/)).toBeUndefined();
  });

  it('rejects with a reason', async () => {
    h.api.deletionRequests.mockResolvedValue([req()]);
    h.api.rejectDeletion.mockResolvedValue(req({ state: 'rejected' }));
    mount(<SiteDeletionPending name="demo" onDeleted={() => {}} />);
    await settle();
    click(button(/^Reject$/)!);
    type(modal().querySelector('textarea'), 'still used');
    click(button(/^Reject$/, modal())!);
    await settle();
    expect(h.api.rejectDeletion).toHaveBeenCalledWith('r1', 'still used');
  });

  it('asks for a deletion without sites:delete, once, and shows the trail', async () => {
    h.perms.canDelete = false;
    h.api.deletionRequests.mockResolvedValue([req({ state: 'rejected', decidedBy: 'bob@x', decisionReason: 'still used' })]);
    h.api.requestDeletion.mockResolvedValue(req());
    mount(<DeletionRequestsCard name="demo" displayName="Demo" />);
    await settle();
    expect(text()).toContain('Rejected by bob@x');
    click(button(/^Request deletion…$/)!);
    type(modal().querySelector('textarea'), 'demo over');
    click(button(/^Request deletion$/, modal())!);
    await settle();
    expect(h.api.requestDeletion).toHaveBeenCalledWith('demo', 'demo over');
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Deletion requested'));
  });

  it('says why a requester cannot approve their own, from the server’s code', async () => {
    h.api.deletionRequests.mockResolvedValue([req({ requestedBy: 'someone@x' })]);
    h.api.approveDeletion.mockRejectedValue(Object.assign(new Error('Four-eyes'), { status: 403, code: 'second_approver_required' }));
    mount(<SiteDeletionPending name="demo" onDeleted={() => {}} />);
    await settle();
    click(button(/^Approve & delete$/)!);
    type(modal().querySelector('input'), 'demo');
    click(button(/^Approve & delete$/, modal())!);
    await settle();
    expect(h.toast).toHaveBeenCalledWith('Approve failed', expect.objectContaining({ sub: expect.stringContaining('someone else holding sites:delete') }));
  });
});
