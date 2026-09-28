import { describe, expect, it } from 'vitest';
import type { ImportPreview, ImportRow } from '../../api/siteImport';
import { choicesFor, commitBlockers, describeImportError, needsTick, pickChanged, rowRisk, rowState, toDecisions, type Picks } from './openapiImport';

const row = (over: Partial<ImportRow>): ImportRow => ({
  op: 'listInvoices', method: 'GET', specPath: '/invoices', status: 'added', source: 'derived',
  route: { id: 'list-invoices', path: '/invoices', gate: 'api', access: { kind: 'permission', permission: 'billing:read' } },
  current: null, reasons: [], risk: [], ...over,
});
const publicWrite = row({
  op: 'createInvoice', method: 'POST', needsConfirm: true,
  route: { id: 'create-invoice', path: '/invoices', gate: 'open', access: { kind: 'public' } },
  risk: [{ code: 'public_write', level: 'high', message: 'POST /invoices lets anyone write' }],
  blocking: { code: 'risk_unconfirmed', message: 'confirm it' },
});
const unmapped = row({ op: 'GET /misc', route: { id: 'misc', path: '/misc', gate: 'api', access: { kind: 'deny' } }, source: 'unmapped', blocking: { code: 'unmapped', message: 'decide' } });
const preview = (rows: ImportRow[], blocking: ImportPreview['blocking'] = []) => ({ rows, blocking } as unknown as ImportPreview);

describe('what a row offers', () => {
  it('offers nothing on a row it cannot import, remove on a route gone from the spec, the spec’s ask when it has one', () => {
    expect(choicesFor(row({ status: 'unsupported', route: null }))).toEqual([]);
    expect(choicesFor(row({ source: 'removed', status: 'removed' }))).toEqual(['proposed', 'remove']);
    expect(choicesFor(row({ suggestion: { access: { kind: 'public' }, from: 'security: []', needsConfirm: true, risk: [] } }))).toContain('suggested');
    expect(choicesFor(row({}))).not.toContain('suggested');
  });

  it('reads its highest risk', () => {
    expect(rowRisk(row({}))).toBeNull();
    expect(rowRisk(publicWrite)).toBe('high');
  });
});

describe('the confirm tick', () => {
  it('is needed on a high-risk row left as proposed, and on any pick that lowers protection', () => {
    expect(needsTick(publicWrite, undefined)).toBe(true);
    expect(needsTick(row({}), { choice: 'signed-in' })).toBe(true);
    expect(needsTick(row({}), { choice: 'permission', permission: 'billing:write' })).toBe(false);
  });

  it('is not needed once the row is refused or skipped', () => {
    expect(needsTick(publicWrite, { choice: 'deny' })).toBe(false);
    expect(needsTick(publicWrite, { choice: 'skip' })).toBe(false);
  });
});

describe('decisions sent to jinbe', () => {
  it('sends only rows acted on, with confirm only where a tick is due', () => {
    const picks: Picks = {
      createInvoice: { choice: 'proposed', confirm: true },
      listInvoices: { choice: 'permission', permission: ' billing:list ', confirm: true },
      'GET /misc': { choice: 'skip' },
    };
    expect(toDecisions([publicWrite, row({}), unmapped], picks)).toEqual([
      { op: 'createInvoice', confirm: true },
      { op: 'listInvoices', access: { kind: 'permission', permission: 'billing:list' } },
      { op: 'GET /misc', skip: true },
    ]);
  });

  it('carries the spec’s gate with its suggested access', () => {
    const r = row({ suggestion: { access: { kind: 'public' }, gate: 'open', from: 'x-w6d-gate', needsConfirm: true, risk: [] } });
    expect(toDecisions([r], { [r.op]: { choice: 'suggested', confirm: true } })).toEqual([{ op: r.op, access: { kind: 'public' }, gate: 'open', confirm: true }]);
  });
});

describe('what still blocks the commit', () => {
  it('holds every high-risk row until its own tick, then lets it through', () => {
    expect(rowState(publicWrite, undefined, false).kind).toBe('confirm');
    expect(rowState(publicWrite, { choice: 'proposed', confirm: true }, false).kind).toBe('ok');
  });

  it('asks for a decision on an unmapped operation unless they are all left refused', () => {
    expect(rowState(unmapped, undefined, false).kind).toBe('decide');
    expect(rowState(unmapped, undefined, true).kind).toBe('ok');
    expect(rowState(unmapped, { choice: 'permission', permission: 'misc:read' }, false).kind).toBe('ok');
  });

  it('refuses a malformed permission, and a conflict until it is checked again', () => {
    expect(rowState(row({}), { choice: 'permission', permission: 'nope' }, false).kind).toBe('invalid');
    const conflict = row({ blocking: { code: 'shape_conflict', message: 'skip one' } });
    expect(rowState(conflict, undefined, false)).toEqual({ kind: 'blocked', message: 'skip one' });
    expect(rowState(conflict, { choice: 'skip' }, false, true).kind).toBe('recheck');
  });

  it('counts blockers, import-wide refusals included', () => {
    const b = commitBlockers(preview([publicWrite, unmapped, row({})], [{ op: '*', code: 'too_many_routes', message: 'too many' }]), {}, false);
    expect(b).toMatchObject({ confirm: 1, decide: 1, total: 3 });
    expect(b.global.map((g) => g.code)).toEqual(['too_many_routes']);
    expect(commitBlockers(preview([publicWrite]), { createInvoice: { choice: 'proposed', confirm: true } }, false).total).toBe(0);
  });

  it('knows a pick changed since the check, the tick aside', () => {
    expect(pickChanged({ choice: 'proposed', confirm: true }, undefined)).toBe(false);
    expect(pickChanged({ choice: 'deny' }, undefined)).toBe(true);
    expect(pickChanged({ choice: 'permission', permission: 'a:b' }, { choice: 'permission', permission: 'a:b ' })).toBe(false);
  });
});

describe('refusals, in words', () => {
  it('says what to do for each code jinbe answers', () => {
    expect(describeImportError({ status: 409, code: 'stale_base' })).toMatch(/draft changed/);
    expect(describeImportError({ status: 409, code: 'spec_not_previewed' })).toMatch(/Preview it again/);
    expect(describeImportError({ status: 422, code: 'import_blocked', details: { checks: [{}, {}] } })).toMatch(/^2 rows still need a decision/);
    expect(describeImportError({ status: 429, code: 'import_busy' })).toMatch(/Other imports/);
    expect(describeImportError({ status: 429 })).toMatch(/10 at most/);
    expect(describeImportError({ status: 422, code: 'too_many_operations', message: 'more than 2000 operations' })).toBe('The document could not be read: more than 2000 operations');
  });

  it('tells a firewall block from a refusal, and says not to resend', () => {
    expect(describeImportError({ status: 403, edgeBlocked: true })).toMatch(/web firewall.*Do not send the same document again/);
    expect(describeImportError({ status: 403 })).toMatch(/super admin/);
  });
});
