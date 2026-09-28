import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, render, type } from '../../../components/ui/testing';
import type { ImportPreview, ImportRow } from '../../../api/siteImport';

// Import from OpenAPI: preview, then decide. Owner decision: every high-risk row is confirmed with
// its own tick before the import is possible — bulk actions refuse or skip, never confirm — and the
// import writes the draft only, landing on Review & apply with what it wrote.

const api = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn(), invalidate: vi.fn() }));
vi.mock('../../../api/siteImport', () => ({ importApi: { preview: api.preview, commit: api.commit } }));
vi.mock('../../../api/sites', () => ({
  checksOf: (err: { details?: { checks?: unknown[] } }) => err?.details?.checks ?? [],
  notAvailable: () => false,
  useInvalidateSite: () => api.invalidate,
}));

import { ImportFlow } from './ImportFlow';
import type { SiteEditor } from '../useSiteEditor';

const gates = [{ id: 'api', label: 'API' }, { id: 'open', label: 'Open' }];
const ed = { name: 'billing', site: { gates }, saveNow: vi.fn(async () => {}), settle: vi.fn(async () => {}), reset: vi.fn() } as unknown as SiteEditor;

const listRow: ImportRow = {
  op: 'listInvoices', operationId: 'listInvoices', method: 'GET', specPath: '/invoices', status: 'added', source: 'derived',
  route: { id: 'list-invoices', path: '/invoices', gate: 'api', access: { kind: 'permission', permission: 'billing:read' } },
  current: null, reasons: [], risk: [{ code: 'new_route', level: 'low', message: 'GET /invoices needs billing:read' }],
};
const riskyRow: ImportRow = {
  op: 'createInvoice', operationId: 'createInvoice', method: 'POST', specPath: '/invoices', status: 'added', source: 'derived',
  route: { id: 'create-invoice', path: '/invoices', gate: 'open', access: { kind: 'public' } },
  current: null, reasons: ['security: [] on the operation'], needsConfirm: true,
  risk: [{ code: 'public_write', level: 'high', message: 'POST /invoices lets anyone write' }],
  blocking: { code: 'risk_unconfirmed', message: 'createInvoice: confirm this high-risk route' },
};
const preview: ImportPreview = {
  spec: { title: 'Billing API', version: '2.4.0', format: 'yaml', sha256: 'a'.repeat(64), counts: { paths: 1, operations: 2, webhooks: 0, ignoredMethods: 0 } },
  base: { from: 'draft', etag: 'b'.repeat(16), complete: true },
  options: {}, previous: null, sameSpec: false,
  rows: [listRow, riskyRow],
  reimport: { added: 2, changed: 0, unchanged: 0, removed: 0, pinned: 0, manual: 0, skipped: 0, unsupported: 0, suggestions: 0, overrides: 0 },
  risk: { level: 'high', flags: riskyRow.risk }, caps: { maxRoutes: 200, routes: 2, maxEnumerated: 100, enumerated: 0, enumeratedBefore: 0 },
  checks: [], blocking: [{ op: 'createInvoice', code: 'risk_unconfirmed', message: 'confirm' }], notes: [],
};

async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const button = (label: RegExp) => [...document.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
const checkbox = (label: RegExp) => [...document.querySelectorAll('label.checkbox')].find((l) => label.test(l.textContent ?? ''))!.querySelector('input') as HTMLInputElement;
const text = () => document.body.textContent ?? '';

async function toMapping(go = vi.fn()) {
  render(<ImportFlow ed={ed} go={go} />);
  type(document.querySelector('textarea'), 'openapi: 3.1.0');
  click(button(/^Preview routes$/));
  await settle();
  return go;
}

beforeEach(() => { api.preview.mockReset().mockResolvedValue(preview); api.commit.mockReset(); api.invalidate.mockReset(); });
afterEach(cleanup);

describe('Import from OpenAPI', () => {
  it('previews the pasted document with the draft saved first', async () => {
    await toMapping();
    expect(ed.saveNow).toHaveBeenCalled();
    expect(api.preview).toHaveBeenCalledWith('billing', { source: { content: 'openapi: 3.1.0', format: 'auto' }, options: {}, decisions: [] });
    expect(text()).toContain('Billing API v2.4.0');
    expect(text()).toContain('1 high-risk route');
  });

  it('keeps the import off until the high-risk row has its own tick, then imports into the draft and lands on Review', async () => {
    api.commit.mockResolvedValue({ changed: true, counts: { added: 2, changed: 0, removed: 0 }, etag: 'c'.repeat(16) });
    const go = await toMapping();
    expect(button(/^Import into draft$/).disabled).toBe(true);
    expect(text()).toContain('1 to confirm');
    click(checkbox(/Confirm: anyone may call it \(high risk\)/));
    expect(button(/^Import into draft$/).disabled).toBe(false);
    click(button(/^Import into draft$/));
    await settle();
    expect(api.commit).toHaveBeenCalledWith('billing', {
      specSha256: 'a'.repeat(64), baseEtag: 'b'.repeat(16), options: {}, acceptDenied: false,
      decisions: [{ op: 'createInvoice', confirm: true }],
    });
    expect(ed.reset).toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith('review', { imported: '2.0.0' });
  });

  it('bulk actions can refuse a high-risk row but never confirm one', async () => {
    await toMapping();
    // "Select every row on this page", then refuse them.
    click(checkbox(/Select every row on this page/));
    expect(text()).toContain('High-risk rows are confirmed one by one.');
    const bulk = document.querySelector('select[aria-label="Set the selected operations to"]') as HTMLSelectElement;
    expect([...bulk.options].map((o) => o.textContent)).toEqual(['As proposed', 'Refused', 'Don’t import']);
    click(button(/^Apply to selected$/));
    // Refused: nothing left to confirm.
    expect(button(/^Import into draft$/).disabled).toBe(false);
  });

  it('says a stale draft in words and offers to preview again', async () => {
    api.commit.mockRejectedValue(Object.assign(new Error('the draft changed'), { status: 409, code: 'stale_base' }));
    await toMapping();
    click(checkbox(/Confirm: anyone may call it/));
    click(button(/^Import into draft$/));
    await settle();
    expect(text()).toContain('The draft changed since the preview');
  });

  it('marks the rows a commit refused, from its checks', async () => {
    api.commit.mockRejectedValue(Object.assign(new Error('blocked'), { status: 422, code: 'import_blocked', details: { checks: [{ level: 'error', code: 'shape_conflict', message: 'listInvoices and createInvoice clash', path: 'listInvoices' }] } }));
    await toMapping();
    click(checkbox(/Confirm: anyone may call it/));
    click(button(/^Import into draft$/));
    await settle();
    expect(text()).toContain('listInvoices and createInvoice clash');
    expect(button(/^Import into draft$/).disabled).toBe(true);
    expect(button(/^Check again$/)).toBeDefined();
  });
});
