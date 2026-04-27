import type { AppState, User, RouteEntry } from '../api/types';

export function accessLevelOf(perms: string[]): string {
  if (!perms || perms.length === 0) return "none";
  if (perms.includes("*")) return "admin";
  const has = (re: RegExp) => perms.some(p => re.test(p));
  if (has(/:(delete|grant|revoke|admin|manage|destroy)\b/)) return "manage";
  if (has(/:(create|update|write|deploy|publish|edit|apply)\b/)) return "write";
  if (has(/:(read|list|get|view)\b/) || perms.length > 0) return "read";
  return "read";
}

export const LevelMeta: Record<string, { label: string; order: number; desc: string }> = {
  none:   { label: "none",   order: 0, desc: "no permissions" },
  read:   { label: "read",   order: 1, desc: "view-only access" },
  write:  { label: "write",  order: 2, desc: "create / update" },
  manage: { label: "manage", order: 3, desc: "destructive ops" },
  admin:  { label: "admin",  order: 4, desc: "wildcard \u00b7 full control" },
};

export const ROLE_LEVEL: Record<string, number> = {
  super_admin: 4, admin: 4,
  operator: 3,
  editor: 2, scheduler: 2,
  support: 1, auditor: 1, billing_reader: 1,
  viewer: 0,
};

export function resolvePerms(user: User, state: AppState) {
  const roles: Record<string, string[]> = {};
  const perms: Record<string, Set<string>> = {};
  const granters: Record<string, string[]> = {};
  user.groups.forEach(gName => {
    const g = state.groups[gName];
    if (!g) return;
    Object.entries(g).forEach(([svc, rs]) => {
      roles[svc] = roles[svc] || [];
      rs.forEach(r => {
        if (!roles[svc].includes(r)) roles[svc].push(r);
        const rolePerms = (state.roles[svc] || {})[r] || [];
        perms[svc] = perms[svc] || new Set();
        rolePerms.forEach(p => {
          perms[svc].add(p);
          const key = `${svc}:${p}`;
          granters[key] = granters[key] || [];
          granters[key].push(`${gName}/${svc}:${r}`);
        });
      });
    });
  });
  return { roles, perms, granters };
}

export function matchRoute(routes: RouteEntry[], method: string, path: string) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const re = "^" + r.path
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/:any\*/g, ".+")
      .replace(/:[a-zA-Z_]+/g, "[^/]+")
      + "$";
    if (new RegExp(re).test(path)) return r;
  }
  return null;
}
