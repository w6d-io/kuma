import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '../../components/ui/testing';
import { RestoreFileDialog } from './RestoreFileDialog';
import { availableSections, readSnapshot, type PendingFile } from './snapshot';

// A file is offered section by section, only the sections it carries; an older (format-1) file says
// its gateway rules are not restored and what it lacks is left as it is.

const text = () => document.body.textContent ?? '';
afterEach(cleanup);

const v1 = JSON.stringify({
  version: '1',
  rbac: { services: ['billing'], groups: { admins: {} }, roles: {}, routeMaps: {}, oathkeeperRules: [{ id: 'a' }, { id: 'b' }], orgSites: { acme: ['billing'] } },
});
const v2 = JSON.stringify({
  version: '2',
  rbac: {
    services: ['billing'], groups: {}, roles: {}, routeMaps: {}, orgSites: {}, orgAssignments: {}, directGrants: {},
    sites: { records: [{ site: { name: 'shop' } }], versions: {} }, settings: { mcp: '{}' },
    organizations: { registry: { acme: '{}' }, deployments: {} }, signup: { orgSites: {}, domains: {} }, metadata: { services: {}, groups: {} },
  },
});

describe('restore from a file', () => {
  it('refuses what is not a snapshot', () => {
    expect(readSnapshot('nope', 'x.json')).toBe('Not valid JSON');
    expect(readSnapshot('{"rbac":{}}', 'x.json')).toBe('Missing version or rbac fields');
  });

  it('offers only the sections the file carries, with their counts', () => {
    const old = readSnapshot(v1, 'old.json') as PendingFile;
    expect(availableSections(old).map((s) => s.id)).toEqual(['services', 'groups', 'roles', 'routeMaps', 'orgSites']);
    const now = readSnapshot(v2, 'now.json') as PendingFile;
    expect(availableSections(now)).toHaveLength(12);
    expect(now.counts.sites).toBe(1);
    expect(now.counts.organizations).toBe(1);
  });

  it('an older file: its gateway rules are not restored and what it lacks is left as it is', () => {
    const old = readSnapshot(v1, 'old.json') as PendingFile;
    render(<RestoreFileDialog file={old} selected={availableSections(old).map((s) => s.id)} onSelect={vi.fn()} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(text()).toContain('An older file (format 1)');
    expect(text()).toContain('Its 2 gateway rules will not be restored');
    expect(text()).toContain('site intents and their versions');
    expect(text()).toContain('A full restore');
    expect(text()).toContain('Restore everything in the file');
  });

  it('unchecking a section makes it an additive import', () => {
    const now = readSnapshot(v2, 'now.json') as PendingFile;
    render(<RestoreFileDialog file={now} selected={['groups', 'settings']} onSelect={vi.fn()} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(text()).toContain('A sectioned import: nothing is removed');
    expect(text()).toContain('Import 2 sections');
    expect(text()).not.toContain('An older file');
  });
});
