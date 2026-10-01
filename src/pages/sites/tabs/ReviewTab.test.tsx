import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render } from '../../../components/ui/testing';
import type { Finding, Site } from '../../../lib/sites/types';

// Save and publish are two calls, and only publish needs a recent second factor: a save that lands
// and a publish refused for the step-up must say "saved, not live yet" and publish by itself on the
// way back — the operator used to be left believing it was live.

const api = vi.hoisted(() => ({
  save: vi.fn(async () => ({ name: 'echo', version: 17, etag: 'e17', savedAt: 't' })),
  apply: vi.fn(),
  toast: vi.fn(),
  bounce: vi.fn(() => true),
}));
vi.mock('../../../contexts/AppContext', () => ({ useApp: () => ({ pushToast: api.toast }) }));
vi.mock('../../../lib/stepUp', () => ({ bounceToStepUp: api.bounce }));
vi.mock('../../../api/sites', () => ({
  sitesApi: {
    save: api.save, apply: api.apply,
    diff: vi.fn(async () => ({ artefacts: [], risk: { level: 'low', flags: [] }, words: [] })),
    applyProgress: vi.fn(async () => ({ stages: [] })),
  },
  checksOf: () => [],
  findingsOf: (err: { code?: string; details?: { findings?: unknown[] } }) => (err.code === 'unconfirmed_findings' ? err.details?.findings ?? [] : null),
  notAvailable: () => false,
  useInvalidateSite: () => () => {},
  useSitesPlatform: () => ({ data: { production: false } }),
  useSiteStatus: () => ({ data: null, error: null }),
}));

import { ReviewTab } from './ReviewTab';
import type { SiteEditor } from '../useSiteEditor';

const site = { name: 'echo', displayName: 'Echo', address: { host: 'echo.dev.example.com' }, upstream: { service: 'echo', namespace: 'echo', port: 80 }, exposure: { mode: 'zone' }, gates: [], routes: { items: [], catchAll: { gate: 'web', access: { kind: 'signed-in' } } }, roles: 'standard', groups: { platform: {}, orgGrantable: {} }, orgs: [] } as unknown as Site;
const ok = { state: 'ok', preview: { artefacts: {}, checks: [], risk: { level: 'low', flags: [] }, words: [] } };

function editor(over: { version: number; applied: number | null; hasDraft: boolean; findings?: Finding[] }): SiteEditor {
  const preview = over.findings ? { state: 'ok', preview: { ...ok.preview, findings: over.findings, publish: { blocked: false, acknowledge: [] } } } : ok;
  return {
    name: 'echo', site, saved: site, current: site, hasDraft: over.hasDraft, changes: [], preview,
    reset: vi.fn(), settle: vi.fn(async () => {}),
    detail: { data: { site, version: over.version, etag: `e${over.version}`, status: 'live', applied: over.applied == null ? null : { version: over.applied, at: 't', by: 'x', rules: [] } } },
  } as unknown as SiteEditor;
}
const mount = (ed: SiteEditor) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ReviewTab ed={ed} canApply go={() => {}} /></QueryClientProvider>);
const button = (label: RegExp) => [...document.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
const text = () => document.body.textContent ?? '';
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => { sessionStorage.clear(); api.save.mockClear(); api.apply.mockReset(); api.toast.mockClear(); api.bounce.mockClear(); });
afterEach(cleanup);

describe('Review · save, then publish', () => {
  it('a publish refused for the step-up says the version is saved but not live, and remembers it', async () => {
    api.apply.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 422, code: 'reauth_required' }));
    mount(editor({ version: 16, applied: 16, hasDraft: true }));
    await settle();
    await click(button(/^Apply changes/));
    await settle();
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.apply).toHaveBeenCalledWith('echo', 17, []);
    expect(text()).toContain('v17 saved, not live yet');
    expect(api.bounce).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem('kuma:resume:site-apply:echo') ?? '{}').data).toEqual({ version: 17, acknowledge: [] });
  });

  it('back from the step-up, publishes that saved version by itself — once, without saving again', async () => {
    sessionStorage.setItem('kuma:resume:site-apply:echo', JSON.stringify({ data: { version: 17 }, at: Date.now() }));
    api.apply.mockResolvedValue({ applyId: 'a1', version: 17, rules: [], site: 'echo' });
    mount(editor({ version: 17, applied: 16, hasDraft: false }));
    await settle();
    expect(api.apply).toHaveBeenCalledTimes(1);
    expect(api.apply).toHaveBeenCalledWith('echo', 17, []);
    expect(api.save).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('kuma:resume:site-apply:echo')).toBeNull();
  });

  it('does not publish a remembered version somebody has since superseded', async () => {
    sessionStorage.setItem('kuma:resume:site-apply:echo', JSON.stringify({ data: { version: 17 }, at: Date.now() }));
    mount(editor({ version: 18, applied: 16, hasDraft: false }));
    await settle();
    expect(api.apply).not.toHaveBeenCalled();
    expect(api.toast).toHaveBeenCalledWith('v17 was not published', expect.anything());
  });

  it('a saved version that is not live offers Publish instead of saving a copy', async () => {
    api.apply.mockResolvedValue({ applyId: 'a1', version: 17, rules: [], site: 'echo' });
    mount(editor({ version: 17, applied: 16, hasDraft: false }));
    await settle();
    expect(text()).toContain('v17 saved, not live yet');
    await click(button(/^Publish v17$/));
    await settle();
    expect(api.save).not.toHaveBeenCalled();
    expect(api.apply).toHaveBeenCalledWith('echo', 17, []);
  });

  it('back from an OpenAPI import, says what it wrote and that nothing is live until published', async () => {
    const go = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ReviewTab ed={editor({ version: 16, applied: 16, hasDraft: true })} canApply go={go} query={{ imported: '12.3.1' }} /></QueryClientProvider>);
    await settle();
    expect(text()).toContain('Imported 16 routes into the draft');
    expect(text()).toContain('12 added, 3 changed, 1 refused (gone from the spec). Nothing is live yet');
    await click(button(/^Dismiss$/));
    expect(go).toHaveBeenCalledWith('review');
  });
});

// Security findings are the confirmation step of every publish: errors block, confirm codes are
// ticked, and the publish carries exactly the ticked codes.
describe('Review · security findings', () => {
  const pub: Finding = { code: 'public_route', level: 'confirm', message: 'GET /health is public.', fix: 'Keep it only if it leaks nothing.', path: 'routes.items.0' };
  const catchAll: Finding = { code: 'signed_in_catch_all', level: 'confirm', message: 'Everything else only needs a sign-in.', fix: 'Give it a permission.' };

  it('publish waits until every finding is acknowledged, then sends the codes', async () => {
    api.apply.mockResolvedValue({ applyId: 'a1', version: 17, rules: [], site: 'echo' });
    mount(editor({ version: 16, applied: 16, hasDraft: true, findings: [pub, catchAll] }));
    await settle();
    expect(text()).toContain('Acknowledge 2 findings first.');
    expect(button(/^Apply changes/).disabled).toBe(true);
    for (const box of document.querySelectorAll<HTMLInputElement>('[aria-label="Findings to acknowledge"] input[type="checkbox"]')) await click(box);
    expect(button(/^Apply changes/).disabled).toBe(false);
    await click(button(/^Apply changes/));
    await settle();
    expect(api.apply).toHaveBeenCalledWith('echo', 17, ['public_route', 'signed_in_catch_all']);
  });

  it('an error finding blocks whatever is acknowledged', async () => {
    mount(editor({ version: 16, applied: 16, hasDraft: true, findings: [{ code: 'gate_without_authenticator', level: 'error', message: 'Gate web has no sign-in method.', fix: 'Add one.' }] }));
    await settle();
    expect(text()).toContain('1 security error must be fixed first.');
    expect(button(/^Apply changes/).disabled).toBe(true);
  });

  it('a publish refused for unconfirmed findings lists them and publishes that version once they are ticked', async () => {
    api.apply.mockRejectedValueOnce(Object.assign(new Error('Not published'), { status: 422, code: 'unconfirmed_findings', details: { findings: [pub] } }));
    mount(editor({ version: 17, applied: 16, hasDraft: false }));
    await settle();
    await click(button(/^Publish v17$/));
    await settle();
    expect(text()).toContain('GET /health is public.');
    expect(button(/^Publish v17$/).disabled).toBe(true);
    await click(document.querySelector<HTMLInputElement>('[aria-label="Findings to acknowledge"] input[type="checkbox"]')!);
    api.apply.mockResolvedValueOnce({ applyId: 'a1', version: 17, rules: [], site: 'echo' });
    await click(button(/^Publish v17$/));
    await settle();
    expect(api.apply).toHaveBeenLastCalledWith('echo', 17, ['public_route']);
  });

  it('says which organizations a publish takes the site from, and where to keep them, without blocking', async () => {
    const go = vi.fn();
    const removes: Finding = { code: 'publish_removes_orgs', level: 'warn', message: 'publishing removes this site from: Test org (o1)', fix: 'Add them to the site before publishing to keep their access', path: 'orgs' };
    const host: Finding = { code: 'preserve_host_off', level: 'info', message: 'the service sees the internal host name (echo.echo.svc.cluster.local), not echo.dev.example.com', fix: 'Turn on Preserve host', path: 'upstream.preserveHost' };
    render(<QueryClientProvider client={new QueryClient()}><ReviewTab ed={editor({ version: 16, applied: 16, hasDraft: true, findings: [removes, host] })} canApply go={go} /></QueryClientProvider>);
    await settle();
    expect(text()).toContain('publishing removes this site from: Test org (o1)');
    expect(text()).toContain('internal host name');
    expect(text()).toContain('Nothing to acknowledge — ready to publish');
    await click(button(/^Site organizations$/));
    expect(go).toHaveBeenCalledWith('access', { view: 'orgs' });
  });
});

