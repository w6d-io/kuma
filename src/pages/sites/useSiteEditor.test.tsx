import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '../../components/ui/testing';
import type { Site, SiteDraft } from '../../lib/sites/types';

// Two people editing one site's draft: every autosave names the draft it started from, and a draft
// somebody else saved since is never overwritten without the person choosing to.

const site = { name: 'echo', displayName: 'Echo', address: { host: 'echo.dev.example.com' }, upstream: { service: 'echo', namespace: 'echo', port: 80 }, exposure: { mode: 'zone' }, gates: [{ id: 'web' }], routes: { items: [], catchAll: { gate: 'web', access: { kind: 'signed-in' } } }, roles: 'standard', groups: { platform: {}, orgGrantable: {} }, orgs: [] } as unknown as Site;

const draftSite = site as unknown as SiteDraft['site'];

const h = vi.hoisted(() => ({
  draft: null as SiteDraft | null,
  putDraft: vi.fn(),
}));
vi.mock('../../api/sites', async (orig) => {
  const real = await orig<typeof import('../../api/sites')>();
  return {
    ...real,
    sitesApi: { putDraft: h.putDraft, preview: vi.fn(() => new Promise(() => {})), deleteDraft: vi.fn(async () => {}) },
    useSite: () => ({ data: { site, version: 3 }, isLoading: false, error: null }),
    useSiteDraft: () => ({ data: h.draft, isLoading: false }),
  };
});

import { useSiteEditor, type SiteEditor } from './useSiteEditor';

let ed: SiteEditor;
function Probe() { ed = useSiteEditor('echo'); return null; }
const mount = () => render(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>);
const rename = (displayName: string) => act(() => { ed.update((s) => ({ ...s, displayName })); });
async function autosave() { await act(async () => { await vi.advanceTimersByTimeAsync(900); }); }
const stale = () => Object.assign(new Error('ana@x.io saved this draft since you loaded it'), {
  status: 412, code: 'stale_draft', details: { error: 'stale_draft', current: { etag: 'theirs', updatedBy: 'ana@x.io', updatedAt: '2026-10-01T11:00:00Z', baseVersion: 3 } },
});

beforeEach(() => { vi.useFakeTimers(); h.putDraft.mockReset(); h.draft = null; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('draft autosave · If-Match', () => {
  it('names the loaded draft, then each answer', async () => {
    h.draft = { site: draftSite, baseVersion: 3, updatedBy: 'me', etag: 'd1' };
    h.putDraft.mockResolvedValueOnce({ site: draftSite, baseVersion: 3, updatedBy: 'me', etag: 'd2' }).mockResolvedValueOnce({ site: draftSite, baseVersion: 3, updatedBy: 'me', etag: 'd3' });
    mount();
    rename('One');
    await autosave();
    expect(h.putDraft.mock.calls[0][3]).toBe('d1');
    rename('Two');
    await autosave();
    expect(h.putDraft.mock.calls[1][3]).toBe('d2');
  });

  it('sends none when there was no draft (the client then asks that none appeared)', async () => {
    h.putDraft.mockResolvedValueOnce({ site: draftSite, baseVersion: 3, updatedBy: 'me', etag: 'd1' });
    mount();
    rename('One');
    await autosave();
    expect(h.putDraft.mock.calls[0][3]).toBeUndefined();
  });

  it('on 412 says who saved, stops autosaving, and overwrites only when asked, with their etag', async () => {
    h.draft = { site: draftSite, baseVersion: 3, updatedBy: 'me', etag: 'd1' };
    h.putDraft.mockRejectedValueOnce(stale()).mockResolvedValueOnce({ site: draftSite, baseVersion: 3, updatedBy: 'me', etag: 'd9' });
    mount();
    rename('Mine');
    await autosave();
    expect(ed.saving).toBe('conflict');
    expect(ed.conflict).toEqual({ etag: 'theirs', updatedBy: 'ana@x.io', updatedAt: '2026-10-01T11:00:00Z', baseVersion: 3 });
    rename('Mine, more');
    await autosave();
    expect(h.putDraft).toHaveBeenCalledTimes(1);
    await act(async () => { await ed.overwriteDraft(); });
    expect(h.putDraft).toHaveBeenCalledTimes(2);
    expect(h.putDraft.mock.calls[1][1]).toMatchObject({ displayName: 'Mine, more' });
    expect(h.putDraft.mock.calls[1][3]).toBe('theirs');
    expect(ed.conflict).toBeNull();
    expect(ed.saving).toBe('saved');
  });

  it('reload drops my edits and writes nothing', async () => {
    h.draft = { site: draftSite, baseVersion: 3, updatedBy: 'me', etag: 'd1' };
    h.putDraft.mockRejectedValueOnce(stale());
    mount();
    rename('Mine');
    await autosave();
    await act(async () => { await ed.reloadDraft(); });
    expect(ed.conflict).toBeNull();
    expect(ed.current?.displayName).toBe('Echo');
    expect(h.putDraft).toHaveBeenCalledTimes(1);
  });
});
