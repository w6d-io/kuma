import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render } from '../../components/ui/testing';
import type { MigrationStatus } from '../../lib/sites/types';

// The migration banner on the Sites list and the cut-over step: built-in platform rules are never
// "to migrate", the banner says whether sites can be applied as jinbe says it, and a refused
// cut-over shows jinbe's own sentence.

const h = vi.hoisted(() => ({
  perms: { canRead: true, canDraft: true, canApply: true, canDelete: false, canRequest: true, email: 'sam@x' as string | null },
  api: { migration: vi.fn(), migrationDualRunStatus: vi.fn(), migrationCutover: vi.fn() },
  toast: vi.fn(),
}));
vi.mock('../../api/sites', () => ({ sitesApi: h.api, notAvailable: () => false }));
vi.mock('./usePerms', () => ({ useSitePerms: () => h.perms }));
vi.mock('../../contexts/AppContext', () => ({ useApp: () => ({ pushToast: h.toast }) }));

import { MigrationCallout } from './SitesList';
import { MigrationPage } from './Migration';

const status = (over: Partial<MigrationStatus> = {}): MigrationStatus => ({ state: 'not-started', legacyRules: 3, builtIn: 11, groups: [], ...over });
const mount = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const text = () => document.body.textContent ?? '';
const button = (label: RegExp) => [...document.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement | undefined;

beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockReset());
  h.toast.mockReset();
});
afterEach(cleanup);

describe('migration banner', () => {
  it('is not shown when the only legacy rules are the built-ins', () => {
    mount(<MigrationCallout migration={status({ legacyRules: 0 })} />);
    expect(text()).toBe('');
  });

  it('is not shown after the cut-over', () => {
    mount(<MigrationCallout migration={status({ state: 'cut-over' })} />);
    expect(text()).toBe('');
  });

  it('never says sites cannot be applied when the server allows it (mixed gateway)', () => {
    mount(<MigrationCallout migration={status({ mixedGateway: true, applyAllowed: true })} />);
    expect(text()).toContain('3 legacy rules to move to sites');
    expect(text()).toContain('New sites can be applied now');
    expect(text()).not.toContain('only after the cut-over');
  });

  it('says applying waits for the cut-over when the server says so', () => {
    mount(<MigrationCallout migration={status({ legacyRules: 1, applyAllowed: false, applyBlocked: { code: 'migration_pending', message: 'x' } })} />);
    expect(text()).toContain('1 legacy rule to move to sites');
    expect(text()).toContain('New sites can be applied only after the cut-over.');
  });

  it('says nothing about applying when an older server does not tell', () => {
    mount(<MigrationCallout migration={status()} />);
    expect(text()).not.toContain('can be applied');
  });
});

describe('cut-over step', () => {
  it('on a mixed gateway, explains the refusal and keeps the button off', async () => {
    h.api.migration.mockResolvedValue(status({ state: 'dual-run', mixedGateway: true, applyAllowed: true }));
    h.api.migrationDualRunStatus.mockResolvedValue({ compared: 0, same: 0, differs: [], regressions: [], minDurationSec: 0, eligible: true });
    mount(<MigrationPage step="cutover" />);
    await settle();
    expect(text()).toContain('the cut-over is refused here');
    expect(button(/^Cut over now$/)!.disabled).toBe(true);
  });

  it('shows the server’s sentence when it refuses the cut-over', async () => {
    h.api.migration.mockResolvedValue(status({ state: 'dual-run' }));
    h.api.migrationDualRunStatus.mockResolvedValue({ compared: 0, same: 0, differs: [], regressions: [], minDurationSec: 0, eligible: true });
    const message = '2 converted rule(s) match the same requests as a rule that stays in the legacy source: site-kuma-kuma-api and kuma-api (GET https://kuma.example.com/api/x)';
    h.api.migrationCutover.mockRejectedValue(Object.assign(new Error(message), { status: 409, code: 'cutover_overlap' }));
    mount(<MigrationPage step="cutover" />);
    await settle();
    click(document.querySelector('input[type="checkbox"]')!);
    click(button(/^Cut over now$/)!);
    await settle();
    expect(text()).toContain('The server refused the cut-over');
    expect(text()).toContain(message);
    expect(h.toast).toHaveBeenCalledWith('Cut over failed', expect.objectContaining({ err: true }));
  });
});
