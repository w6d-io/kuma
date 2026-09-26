import { describe, it, expect, vi } from 'vitest';
import { writeGroup, writeSiteRoles } from './rbacWrites';

function fakeApi(groups: { name: string; services: Record<string, string[]> }[], roles: Record<string, string[]> = { admin: ['*'] }) {
  const calls: string[] = [];
  return {
    calls,
    getRoles: vi.fn(async (site: string) => { calls.push(`read ${site}`); return { service: site, roles: Object.entries(roles).map(([name, permissions]) => ({ name, permissions })), meta: { fileSha: '' } }; }),
    getGroups: vi.fn(async () => { calls.push('getGroups'); return groups; }),
    updateGroup: vi.fn(async (name: string, services: Record<string, string[]>) => { calls.push(`group ${name} ${JSON.stringify(services)}`); return { commitId: '' }; }),
    setServiceRoles: vi.fn(async (site: string, roles: Record<string, string[]>) => { calls.push(`roles ${site} ${Object.keys(roles).sort().join(',')}`); return { success: true, message: '' }; }),
  };
}

describe('writeSiteRoles', () => {
  it('adds a role on top of what jinbe holds now, not on a stale copy', async () => {
    const f = fakeApi([], { admin: ['*'], added_elsewhere: ['x'] });
    await writeSiteRoles(f, { site: 'kuma', upsert: { name: 'qa', permissions: ['read'] } });
    expect(f.calls).toEqual(['read kuma', 'roles kuma added_elsewhere,admin,qa']);
  });

  it('writes nothing when the roles cannot be read', async () => {
    const f = fakeApi([]);
    f.getRoles.mockRejectedValueOnce(new Error('429'));
    await expect(writeSiteRoles(f, { site: 'kuma', upsert: { name: 'qa', permissions: [] } })).rejects.toThrow('429');
    expect(f.setServiceRoles).not.toHaveBeenCalled();
  });

  it('renames with the old name kept until the groups have moved', async () => {
    const f = fakeApi([{ name: 'ops', services: { kuma: ['old'], jinbe: ['viewer'] } }, { name: 'x', services: {} }], { admin: ['*'], old: ['read'] });
    await writeSiteRoles(f, { site: 'kuma', upsert: { name: 'new', permissions: ['read'] }, rename: { from: 'old', to: 'new' } });
    expect(f.setServiceRoles.mock.calls[0][1]).toEqual({ admin: ['*'], new: ['read'], old: ['read'] });
    expect(f.calls).toEqual([
      'read kuma',
      'getGroups',
      'roles kuma admin,new,old',
      'group ops {"kuma":["new"],"jinbe":["viewer"]}',
      'roles kuma admin,new',
    ]);
  });

  it('takes a deleted role out of the groups, read fresh, before dropping it', async () => {
    const f = fakeApi([{ name: 'fresh', services: { kuma: ['gone'] } }], { admin: ['*'], gone: [] });
    await writeSiteRoles(f, { site: 'kuma', remove: 'gone' });
    expect(f.calls).toEqual(['read kuma', 'getGroups', 'group fresh {}', 'roles kuma admin']);
  });
});

describe('writeGroup', () => {
  const client = (services: Record<string, string[]>) => ({
    getGroups: vi.fn(async () => [{ name: 'ops', services }]),
    createGroup: vi.fn(async () => ({ commitId: '' })),
    updateGroup: vi.fn(async () => ({ commitId: '' })),
  });

  it('applies the change to the group as it is now, keeping what someone else added', async () => {
    const c = client({ kuma: ['viewer'], global: ['admin'] });
    await writeGroup(c, { name: 'ops', create: false, changes: [{ site: 'kuma', added: ['admin'], removed: ['viewer'] }] });
    expect(c.updateGroup).toHaveBeenCalledWith('ops', { kuma: ['admin'], global: ['admin'] });
  });

  it('drops a site left with no role, and creates from nothing', async () => {
    const c = client({ kuma: ['viewer'] });
    await writeGroup(c, { name: 'ops', create: false, changes: [{ site: 'kuma', added: [], removed: ['viewer'] }] });
    expect(c.updateGroup).toHaveBeenCalledWith('ops', {});
    await writeGroup(c, { name: 'new_one', create: true, changes: [{ site: 'jinbe', added: ['viewer'], removed: [] }] });
    expect(c.createGroup).toHaveBeenCalledWith({ name: 'new_one', services: { jinbe: ['viewer'] } });
  });

  it('refuses when the group vanished meanwhile', async () => {
    const c = client({});
    await expect(writeGroup(c, { name: 'gone', create: false, changes: [] })).rejects.toThrow(/no longer exists/);
  });
});
