import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '../components/ui/testing';

// On auth-dev jinbe had backup on (and a nightly backup) while kuma's deploy flag said off, and the
// page said "Backup isn't set up". jinbe's answer decides; the flag only stands in when it fails.

const api = vi.hoisted(() => ({ listBackups: vi.fn(), toast: vi.fn() }));
vi.mock('../api/client', () => ({ api: { listBackups: api.listBackups } }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pushToast: api.toast, refetch: () => {} }) }));
vi.mock('../api/hooks', () => ({ useSession: () => ({ data: null }) }));
vi.mock('../policy/model', () => ({ holds: () => true }));
vi.mock('../components/ExportBundleModal', () => ({ ExportBundleModal: () => null }));

import { BackupPage } from './Backup';

const text = () => document.body.textContent ?? '';
async function settle() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const on = { enabled: true, bucket: 'auth-backups', prefix: 'auth-dev/', region: 'eu-west-3', backups: [{ key: 'auth-dev/2026-10-02.json', size: 2048, lastModified: '2026-10-02T02:00:00Z' }] };

beforeEach(() => { api.listBackups.mockReset(); api.toast.mockReset(); });
afterEach(() => { cleanup(); delete (window as { __BACKUP_ENABLED__?: string }).__BACKUP_ENABLED__; });

describe('Backup page', () => {
  it('jinbe on wins over a deploy flag that says off, and shows where backups go', async () => {
    (window as { __BACKUP_ENABLED__?: string }).__BACKUP_ENABLED__ = 'false';
    api.listBackups.mockResolvedValue(on);
    render(<BackupPage />);
    await settle();
    expect(text()).not.toContain("Backup isn't set up");
    expect(text()).toContain('S3 backup on');
    expect(text()).toContain('s3://auth-backups');
    expect(text()).toContain('prefix auth-dev/');
    expect(text()).toContain('eu-west-3');
    expect(text()).toContain('auth-dev/2026-10-02.json');
  });

  it('jinbe off shows the setup card, whatever the flag says', async () => {
    (window as { __BACKUP_ENABLED__?: string }).__BACKUP_ENABLED__ = 'true';
    api.listBackups.mockResolvedValue({ ...on, enabled: false, bucket: null, backups: [] });
    render(<BackupPage />);
    await settle();
    expect(text()).toContain("Backup isn't set up");
  });

  it('an older jinbe that fails the call falls back to the deploy flag', async () => {
    api.listBackups.mockRejectedValue(new Error('Route GET not found'));
    render(<BackupPage />);
    await settle();
    expect(text()).toContain("Backup isn't set up");
    expect(api.toast).not.toHaveBeenCalled();
    cleanup();
    (window as { __BACKUP_ENABLED__?: string }).__BACKUP_ENABLED__ = 'true';
    render(<BackupPage />);
    await settle();
    expect(text()).toContain('S3 backup on');
  });
});
