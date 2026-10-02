import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '../components/ui/testing';

// After the role trim a viewer holds none of settings:read, zones:read or policy.bundle:read: the
// page shows their own account parts and says the rest is not for their access, instead of a page of
// 403s and "No zones defined in the cluster".

const s = vi.hoisted(() => ({ perms: [] as string[], authMethods: vi.fn(), history: vi.fn() }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pushToast: () => {}, refetch: () => {} }) }));
vi.mock('../api/hooks', () => ({
  useSession: () => ({ data: { effective_permissions: s.perms } }),
  useAuthMethods: (o: { enabled?: boolean }) => { s.authMethods(o); return { data: undefined, error: null }; },
  useSetAuthMethods: () => ({ mutate: () => {}, isPending: false }),
  useImportHistory: (o: { enabled?: boolean }) => { s.history(o); return { data: [] }; },
  useRollbackImport: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock('../components/ZonesSettings', () => ({ ZonesSettings: () => <div>zones card</div> }));
vi.mock('../components/SecondFactorSettings', () => ({ SecondFactorSettings: () => <div>second factor card</div> }));
vi.mock('../components/SignInProtectionSettings', () => ({ SignInProtectionSettings: () => <div>sign-in protection card</div> }));
vi.mock('../components/McpSettings', () => ({ McpSettings: () => <div>mcp card</div> }));
vi.mock('../components/OwnSecondFactor', () => ({ OwnSecondFactor: () => <div>own 2fa</div> }));
vi.mock('../components/ExportBundleModal', () => ({ ExportBundleModal: () => null }));

import { SettingsPage } from './Settings';

const text = () => document.body.textContent ?? '';
afterEach(() => { cleanup(); s.authMethods.mockClear(); s.history.mockClear(); });

describe('Settings for the access held', () => {
  it('a viewer sees their own parts and a short note, and nothing is asked', () => {
    s.perms = ['sites:read', 'stats:read'];
    render(<SettingsPage />);
    expect(text()).toContain('own 2fa');
    expect(text()).toContain('Nothing to administer here for your access');
    for (const card of ['zones card', 'second factor card', 'sign-in protection card', 'mcp card', 'Export bundle']) expect(text()).not.toContain(card);
    expect(s.authMethods).toHaveBeenCalledWith({ enabled: false });
    expect(s.history).toHaveBeenCalledWith({ enabled: false });
  });
  it('zones only with zones:read; settings cards only with settings:read', () => {
    s.perms = ['zones:read'];
    render(<SettingsPage />);
    expect(text()).toContain('zones card');
    expect(text()).not.toContain('mcp card');
    expect(text()).not.toContain('Nothing to administer');
    cleanup();
    s.perms = ['settings:read', 'policy.bundle:read'];
    render(<SettingsPage />);
    expect(text()).toContain('mcp card');
    expect(text()).toContain('Export bundle');
    expect(text()).not.toContain('zones card');
  });
});
