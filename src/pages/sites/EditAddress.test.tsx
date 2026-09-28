import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render, type } from '../../components/ui/testing';
import type { Check, Preview, Site } from '../../lib/sites/types';

const api = vi.hoisted(() => ({
  preview: vi.fn(),
  save: vi.fn(async () => ({ name: 'echo', version: 4, etag: 'e4', savedAt: 't' })),
  apply: vi.fn(async () => ({ applyId: 'a1', version: 4, rules: [], site: 'echo' })),
  toast: vi.fn(),
}));
vi.mock('../../contexts/AppContext', () => ({ useApp: () => ({ pushToast: api.toast }) }));
vi.mock('../../lib/stepUp', () => ({ bounceToStepUp: () => false }));
vi.mock('../../api/sites', () => ({
  sitesApi: { preview: api.preview, save: api.save, apply: api.apply },
  useZones: () => ({ data: [{ suffix: 'dev.example.com' }, { suffix: 'apps.stairfleet.com' }], isLoading: false }),
  useInvalidateSite: () => () => {},
  checksOf: (err: { details?: { checks?: Check[] } }) => err?.details?.checks ?? [],
  notAvailable: () => false,
}));

import { EditAddressDialog } from './EditAddress';
import type { SiteEditor } from './useSiteEditor';

const echo = (over: Partial<Site> = {}): Site => ({
  name: 'echo', displayName: 'Echo', address: { host: 'echo-sandbox.dev.example.com' },
  upstream: { service: 'echo', namespace: 'echo', port: 8080 }, exposure: { mode: 'zone' },
  gates: [], routes: { items: [], catchAll: { gate: 'web', access: { kind: 'signed-in' } } },
  roles: 'standard', groups: { platform: {}, orgGrantable: {} }, orgs: [], ...over,
} as Site);

const moveCheck: Check = {
  level: 'warn', code: 'address_changed', path: 'address', message: 'The address moves from https://echo-sandbox.dev.example.com/ to https://something-else.dev.example.com/.',
  address: { from: { host: 'echo-sandbox.dev.example.com', pathPrefix: null, zone: 'dev.example.com', url: 'https://echo-sandbox.dev.example.com/' }, to: { host: 'something-else.dev.example.com', pathPrefix: null, zone: 'dev.example.com', url: 'https://something-else.dev.example.com/' } },
};
const answer = (checks: Check[]): Preview => ({ artefacts: { routeMap: [], roles: {}, groups: { platform: {}, orgGrantable: {} }, orgServiceMap: {}, rules: [] }, checks, risk: { level: 'high', flags: [] }, words: [] });

function editor(site: Site, over: Partial<SiteEditor> = {}): SiteEditor {
  return {
    name: 'echo', site, saved: site, current: site, changes: [], update: vi.fn(), reset: vi.fn(), settle: vi.fn(async () => {}),
    detail: { data: { site, version: 3, etag: 'e3', status: 'live', applied: { version: 3 } } },
    ...over,
  } as unknown as SiteEditor;
}

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
}
function mount(ed: SiteEditor, canApply = true, onApplied = vi.fn()) {
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><EditAddressDialog ed={ed} open onClose={() => {}} canApply={canApply} onApplied={onApplied} /></QueryClientProvider>);
  return onApplied;
}
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
const button = (label: string) => [...dialog().querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const labelInput = () => dialog().querySelector('input') as HTMLInputElement;

beforeEach(() => { api.preview.mockReset(); api.save.mockClear(); api.apply.mockClear(); api.toast.mockClear(); });
afterEach(cleanup);

describe('Edit address', () => {
  it('prefills label and zone, previews the new host, groups the checks and spells out the move', async () => {
    api.preview.mockResolvedValue(answer([moveCheck, { level: 'error', code: 'host_taken', message: 'grafana/grafana serves something-else.dev.example.com' }]))
    mount(editor(echo()));
    expect(labelInput().value).toBe('echo-sandbox');
    expect((dialog().querySelector('select') as HTMLSelectElement).value).toBe('dev.example.com');
    expect(api.preview).not.toHaveBeenCalled();
    type(labelInput(), 'something-else');
    expect(dialog().textContent).toContain('New address: https://something-else.dev.example.com/');
    await settle();
    expect(api.preview).toHaveBeenCalledWith(expect.objectContaining({ address: { host: 'something-else.dev.example.com' } }));
    const text = dialog().textContent!;
    expect(text).toContain('Blocking — fix these first');
    expect(text).toContain('grafana/grafana serves');
    expect(text).toContain('Warnings');
    expect(text).toContain('The old address stops working');
    expect(text).toContain('OAuth redirect URIs registered for the old address break');
    expect(button('Save and apply').disabled).toBe(true);
  });

  it('warnings only: save and apply saves with the etag, applies that version, and reports back', async () => {
    api.preview.mockResolvedValue(answer([moveCheck]));
    const ed = editor(echo());
    const onApplied = mount(ed);
    type(labelInput(), 'something-else');
    await settle();
    expect(button('Save and apply').disabled).toBe(false);
    click(button('Save and apply'));
    await settle();
    expect(api.save).toHaveBeenCalledWith('echo', expect.objectContaining({ address: { host: 'something-else.dev.example.com' } }), expect.objectContaining({ etag: 'e3' }));
    expect(api.apply).toHaveBeenCalledWith('echo', 4);
    expect(ed.reset).toHaveBeenCalled();
    expect(onApplied).toHaveBeenCalled();
  });

  it('moves the landing page on the old host along, unless told not to', async () => {
    api.preview.mockResolvedValue(answer([moveCheck]));
    mount(editor(echo({ login: { twoFactor: { scope: 'none', clients: 'exempt' }, reach: 'granted', defaultReturnUrl: 'https://echo-sandbox.dev.example.com/home' } })));
    type(labelInput(), 'something-else');
    await settle();
    expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ login: expect.objectContaining({ defaultReturnUrl: 'https://something-else.dev.example.com/home' }) }));
    click(dialog().querySelector('input[type="checkbox"]'));
    await settle();
    expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ login: expect.objectContaining({ defaultReturnUrl: 'https://echo-sandbox.dev.example.com/home' }) }));
  });

  it('without apply rights: only a draft, written into the editor', async () => {
    api.preview.mockResolvedValue(answer([moveCheck]));
    const ed = editor(echo());
    mount(ed, false);
    type(labelInput(), 'something-else');
    await settle();
    expect(button('Save and apply')).toBeUndefined();
    click(button('Save as draft'));
    expect(ed.update).toHaveBeenCalled();
    const next = (ed.update as unknown as { mock: { calls: Array<[() => Site]> } }).mock.calls[0][0]();
    expect(next.address).toEqual({ host: 'something-else.dev.example.com' });
  });

  it('checks that cannot run say so, and nothing can be applied', async () => {
    api.preview.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    mount(editor(echo()));
    type(labelInput(), 'something-else');
    await settle();
    expect(dialog().textContent).toContain('Checks are unavailable');
    expect(button('Save and apply').disabled).toBe(true);
  });
});
