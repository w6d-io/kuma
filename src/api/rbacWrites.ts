import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { GroupMapping } from './types';
import { jinbeGroupsToMap } from './transforms';
import { removeRoleFromGroups, renameRoleInGroups } from '../lib/rbacEdit';

/**
 * Writes to the site layer — roles per site, groups — and the member list they are judged against.
 *
 * Each write invalidates what it changes and what is derived from it: the per-site catalogues, the
 * group map, the permission list jinbe computes from roles, and the directory counts.
 */
const ROLE_KEYS = [['all-roles'], ['services'], ['service-permissions']] as const;
const GROUP_KEYS = [['groups'], ['groups-map'], ['stats'], ['rbac-users'], ['users']] as const;

function useInvalidate() {
  const qc = useQueryClient();
  return (keys: readonly (readonly string[])[]) => {
    for (const key of [...keys, ['audit']]) qc.invalidateQueries({ queryKey: key as string[] });
  };
}

export function useRbacUsers() {
  return useQuery({ queryKey: ['rbac-users'], queryFn: () => api.getRbacUsers(), staleTime: 30_000 });
}

/**
 * One change to one role, as a delta. Applied to the roles and groups read from jinbe at the moment
 * of the write — never to the screen's copy, which a refused or late refetch can leave stale or
 * empty, and a replace built on it would wipe what it did not know about.
 */
export interface SiteRolesWrite {
  site: string;
  /** Create or overwrite one role (under `rename.to` when renaming). */
  upsert?: { name: string; permissions: string[] };
  /** The old name stays defined until every group points at the new one, so nobody loses access in between. */
  rename?: { from: string; to: string };
  remove?: string;
}

type RolesApi = Pick<typeof api, 'getRoles' | 'getGroups' | 'updateGroup' | 'setServiceRoles'>;

export async function writeSiteRoles(client: RolesApi, { site, upsert, rename, remove }: SiteRolesWrite) {
  const current: Record<string, string[]> = {};
  for (const r of (await client.getRoles(site)).roles) current[r.name] = r.permissions;
  const next = { ...current };
  if (rename) delete next[rename.from];
  if (remove) delete next[remove];
  if (upsert) next[upsert.name] = upsert.permissions;
  if (!rename && !remove) return client.setServiceRoles(site, next);

  const groups = jinbeGroupsToMap(await client.getGroups());
  const moved = rename ? renameRoleInGroups(groups, site, rename.from, rename.to) : removeRoleFromGroups(groups, site, remove!);
  const changed = Object.entries(moved);
  if (rename && changed.length) await client.setServiceRoles(site, { ...next, [rename.from]: current[rename.from] ?? [] });
  // Groups move before the roles are replaced, so no group is left naming a role that is gone.
  for (const [name, services] of changed) await client.updateGroup(name, services);
  return client.setServiceRoles(site, next);
}

/**
 * Replace a site's roles, and move the groups a rename or a delete touches.
 *
 * Roles and groups are read fresh from jinbe right before the write (see SiteRolesWrite).
 */
export function useSaveSiteRoles() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: SiteRolesWrite) => writeSiteRoles(api, input),
    onSettled: () => invalidate([...ROLE_KEYS, ...GROUP_KEYS]),
  });
}

export interface GroupWrite {
  name: string;
  create: boolean;
  /** Roles gained and lost per site — applied to the group as jinbe holds it at the moment of the write. */
  changes: { site: string; added: string[]; removed: string[] }[];
}

export async function writeGroup(client: Pick<typeof api, 'getGroups' | 'createGroup' | 'updateGroup'>, { name, create, changes }: GroupWrite) {
  const base: GroupMapping = {};
  if (!create) {
    const current = (await client.getGroups()).find(g => g.name === name);
    if (!current) throw new Error(`The group ${name} no longer exists.`);
    Object.assign(base, current.services);
  }
  const next: GroupMapping = { ...base };
  for (const { site, added, removed } of changes) {
    const roles = [...new Set([...(next[site] ?? []).filter(r => !removed.includes(r)), ...added])];
    if (roles.length) next[site] = roles; else delete next[site];
  }
  return create ? client.createGroup({ name, services: next }) : client.updateGroup(name, next);
}

export function useSaveGroup() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: GroupWrite) => writeGroup(api, input),
    onSettled: () => invalidate(GROUP_KEYS),
  });
}

export function useDeleteGroup() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => api.deleteGroup(name),
    onSettled: () => invalidate(GROUP_KEYS),
  });
}
