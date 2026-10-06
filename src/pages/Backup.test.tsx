import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '../components/ui/testing';

// One Backup & restore page: download and restore from a file work with S3 off, S3 snapshots list
// where jinbe has backup on (jinbe's answer decides; the deploy flag only stands in when it fails),
// the import history rolls back, and reading needs only policy.bundle:read.

const api = vi.hoisted(() => ({
  listBackups: vi.fn(), downloadSnapshot: vi.fn(), downloadBackup: vi.fn(), importBundle: vi.fn(), toast: vi.fn(),
  perms: ['policy.bundle:read', 'policy.bundle:write'] as string[],
  history: [] as unknown[],
}));
vi.mock('../api/client', () => ({
  api: { listBackups: api.listBackups, downloadSnapshot: api.downloadSnapshot, downloadBackup: api.downloadBackup, importBundle: api.importBundle },
}));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pushToast: api.toast, refetch: () => {} }) }));
vi.mock('../api/hooks', () => ({
  useSession: () => ({ data: null }),
  useImportHistory: () => ({ data: api.history, refetch: () => {} }),
  useRollbackImport: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock('../policy/model', () => ({ holds: (_s: unknown, p: string) => api.perms.includes(p) }));

import { BackupPage } from './Backup';

const text = () => document.body.textContent ?? '';
async function settle() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const on = { enabled: true, bucket: 'auth-backups', prefix: 'auth-dev/', region: 'eu-west-3', backups: [{ key: 'auth-dev/2026-10-02.json', size: 2048, lastModified: '2026-10-02T02:00:00Z' }] };
const off = { ...on, enabled: false, bucket: null, backups: [] };
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

beforeEach(() => {
  for (const f of [api.listBackups, api.downloadSnapshot, api.downloadBackup, api.importBundle, api.toast]) f.mockReset();
  api.perms = ['policy.bundle:read', 'policy.bundle:write'];
  api.history = [];
});
afterEach(() => { cleanup(); delete (window as { __BACKUP_ENABLED__?: string }).__BACKUP_ENABLED__; });

describe('Backup & restore page', () => {
  it('jinbe on wins over a deploy flag that says off, and shows where backups go', async () => {
    (window as { __BACKUP_ENABLED__?: string }).__BACKUP_ENABLED__ = 'false';
    api.listBackups.mockResolvedValue(on);
    render(<BackupPage />);
    await settle();
    expect(text()).not.toContain('Scheduled backups to S3 are off');
    expect(text()).toContain('S3 backup on');
    expect(text()).toContain('s3://auth-backups');
    expect(text()).toContain('prefix auth-dev/');
    expect(text()).toContain('eu-west-3');
    expect(text()).toContain('auth-dev/2026-10-02.json');
  });

  it('jinbe off: the setup card, and download and restore from a file still offered', async () => {
    (window as { __BACKUP_ENABLED__?: string }).__BACKUP_ENABLED__ = 'true';
    api.listBackups.mockResolvedValue(off);
    render(<BackupPage />);
    await settle();
    expect(text()).toContain('Scheduled backups to S3 are off');
    expect(button('Download snapshot')?.disabled).toBe(false);
    expect(button('Restore from file')?.disabled).toBe(false);
    expect(button('Back up now')).toBeUndefined();
    await act(async () => { button('Download snapshot')!.click(); });
    expect(api.downloadSnapshot).toHaveBeenCalled();
  });

  it('an older jinbe that fails the call falls back to the deploy flag', async () => {
    api.listBackups.mockRejectedValue(new Error('Route GET not found'));
    render(<BackupPage />);
    await settle();
    expect(text()).toContain('Scheduled backups to S3 are off');
    expect(api.toast).not.toHaveBeenCalled();
    cleanup();
    (window as { __BACKUP_ENABLED__?: string }).__BACKUP_ENABLED__ = 'true';
    render(<BackupPage />);
    await settle();
    expect(text()).toContain('S3 backup on');
  });

  it('policy.bundle:read alone: downloads, no restore', async () => {
    api.perms = ['policy.bundle:read'];
    api.listBackups.mockResolvedValue(on);
    render(<BackupPage />);
    await settle();
    expect(button('Download snapshot')?.disabled).toBe(false);
    expect(button('Download')?.disabled).toBe(false);
    expect(button('Restore from file')?.disabled).toBe(true);
    expect(button('Restore')?.disabled).toBe(true);
    expect(button('Back up now')?.disabled).toBe(true);
    await act(async () => { button('Download')!.click(); });
    expect(api.downloadBackup).toHaveBeenCalledWith('auth-dev/2026-10-02.json');
  });

  it('says what a snapshot holds and what it does not', async () => {
    api.listBackups.mockResolvedValue(off);
    render(<BackupPage />);
    await settle();
    expect(text()).toContain('Site intents and every saved version');
    expect(text()).toContain('Accounts');
    expect(text()).toContain('OAuth clients: they need a backup of the identity database');
    expect(text()).toContain('A restore never deletes an organization');
  });

  it('lists the import history with a roll back', async () => {
    api.history = [{ id: 'h1', takenAt: '2026-10-03T10:00:00Z', actor: 'ops@example.com', reason: 'pre-restore', counts: { services: 3, groups: 4, roles: 3, routeMaps: 3, sites: 2 } }];
    api.listBackups.mockResolvedValue(off);
    render(<BackupPage />);
    await settle();
    expect(text()).toContain('ops@example.com');
    expect(text()).toContain('3 services · 4 groups · 3 roles · 2 sites');
    expect(button('Roll back')?.disabled).toBe(false);
  });
});
