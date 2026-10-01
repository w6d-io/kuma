import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, render } from './ui/testing';

const h = vi.hoisted(() => ({
  map: { o1: ['echo'] } as Record<string, string[]>,
  mutate: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
  bounce: vi.fn(() => true),
}));
vi.mock('../api/hooks', () => ({
  useOrgServiceMap: () => ({ data: h.map, isLoading: false }),
  useSetOrgServiceBundle: () => ({ mutate: h.mutate, isPending: false }),
  useDeleteOrgServiceMapping: () => ({ mutate: h.remove, isPending: false }),
}));
vi.mock('../api/orgCatalog', () => ({ useOrgCatalog: () => ({ orgs: [{ id: 'o1', name: 'Test org' }], isLoading: false, error: null }) }));
vi.mock('../contexts/AppContext', () => ({
  useApp: () => ({ pushToast: h.toast, state: { services: [{ name: 'global' }, { name: 'echo' }, { name: 'echo-mfa' }] } }),
}));
vi.mock('../lib/stepUp', () => ({ bounceToStepUp: h.bounce }));

import { OrgSitesSettings } from './OrgSitesSettings';
import { rememberResume } from '../lib/resume';

type Opts = { onError: (e: unknown) => void; onSuccess: () => void };
const reauth = Object.assign(new Error('needs a recent second factor'), { status: 422, code: 'reauth_required' });
const byText = (root: HTMLElement, sel: string, text: RegExp) =>
  [...root.querySelectorAll<HTMLElement>(sel)].find((e) => text.test(e.textContent ?? ''))!;
const click = (el: HTMLElement) => act(() => { el.click(); });

beforeEach(() => { sessionStorage.clear(); h.map = { o1: ['echo'] }; });
afterEach(() => { cleanup(); h.mutate.mockReset(); h.remove.mockReset(); h.toast.mockReset(); h.bounce.mockClear(); });

function editAndSave(container: HTMLElement) {
  click(byText(container, 'button', /^Edit$/));
  click(byText(container, 'button', /echo-mfa/));
  click(byText(container, 'button', /^Replace sites$/));
}

describe('OrgSitesSettings', () => {
  it('sends a save refused for a stale second factor through the step-up, to be saved on the way back', () => {
    const { container } = render(<OrgSitesSettings />);
    editAndSave(container);
    expect(h.mutate).toHaveBeenCalledWith({ organizationId: 'o1', services: ['echo', 'echo-mfa'] }, expect.anything());
    act(() => { (h.mutate.mock.calls[0][1] as Opts).onError(reauth); });
    expect(h.bounce).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast.mock.calls[0][0]).toBe('Two-factor re-verification required');
    expect(JSON.parse(sessionStorage.getItem('kuma:resume:org-sites')!).data).toEqual({ organizationId: 'o1', services: ['echo', 'echo-mfa'], was: ['echo'] });
  });

  it('replays the remembered save once when it comes back', () => {
    rememberResume('org-sites', { organizationId: 'o1', services: ['echo', 'echo-mfa'], was: ['echo'] });
    render(<OrgSitesSettings />);
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0][0]).toEqual({ organizationId: 'o1', services: ['echo', 'echo-mfa'] });
    cleanup();
    render(<OrgSitesSettings />);
    expect(h.mutate).toHaveBeenCalledTimes(1);
  });

  it('puts the choice back in the form when the sites changed meanwhile', () => {
    rememberResume('org-sites', { organizationId: 'o1', services: ['echo-mfa'], was: [] });
    const { container } = render(<OrgSitesSettings />);
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.toast.mock.calls[0][0]).toMatch(/changed meanwhile/);
    expect(byText(container, 'button', /echo-mfa/).getAttribute('aria-pressed')).toBe('true');
    expect(byText(container, 'button', /^\s*echo$/).getAttribute('aria-pressed')).toBe('false');
  });

  it('names a refused site rather than its place in the list', () => {
    const { container } = render(<OrgSitesSettings />);
    editAndSave(container);
    const invalid = Object.assign(new Error('Validation failed'), {
      status: 400, code: 'Validation failed', details: { error: 'Validation failed', details: [{ path: 'services.1', message: 'Invalid' }] },
    });
    act(() => { (h.mutate.mock.calls[0][1] as Opts).onError(invalid); });
    expect(h.bounce).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith('Some values were not accepted', { err: true, sub: 'Site echo-mfa: Invalid' });
  });

  it('steps up a refused removal too, asking for it again afterwards', () => {
    const { container } = render(<OrgSitesSettings />);
    click(container.querySelector<HTMLElement>('[aria-label="Remove sites"]')!);
    click(byText(document.body, 'button', /^Remove sites$/));
    act(() => { (h.remove.mock.calls[0][1] as Opts).onError(reauth); });
    expect(h.bounce).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('kuma:resume-redo')).toContain('Remove the sites of Test org again');
  });
});
