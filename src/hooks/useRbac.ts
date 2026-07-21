import type { AppState, User } from '../api/types';

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

/**
 * A group is "privileged" when its RESOLVED permissions grant admin power: the
 * global super_admin role, a global role resolving to "*", or any service role
 * resolving to "*". Derived purely from resolved perms — NOT the `system`
 * metadata flag (finding K8): a non-system group that grants "*" is still
 * privileged and must be gated. jinbe enforces this as 422 regardless; this is
 * the frontend mirror used to disable the control up front and explain why.
 */
/**
 * The single service-agnostic org-admin flag group. Assigning it makes a user an
 * admin of the org(s) they belong to, scoped to each org's service bundle —
 * enforced entirely in policy (rbac.is_org_admin + rbac.delegation.manageable_orgs).
 * Name is in lock-step with the rego constant `rbac.org_admin_group` and jinbe's
 * `ORG_ADMIN_FLAG_GROUP`.
 */
export const ORG_ADMIN_FLAG_GROUP = "org_admins";

export function isPrivilegedGroup(g: string, state: AppState): boolean {
  // The org-admin flag confers NO resolved permissions (its authority is
  // positional, granted in policy), so the perm-based checks below would miss
  // it. Assigning it is a privileged, super_admin-only action — gate it by name,
  // mirroring jinbe's userGroupsService guard.
  if (g === ORG_ADMIN_FLAG_GROUP) return true;
  const map = state.groups[g] || {};
  const globalRoles = map.global ?? [];
  if (globalRoles.includes("super_admin")) return true;
  const globalDefs = state.roles.global || {};
  for (const r of globalRoles) {
    if ((globalDefs[r] ?? []).includes("*")) return true;
  }
  for (const [svc, roles] of Object.entries(map)) {
    if (svc === "global" || !roles?.length) continue;
    const allRoles = state.roles[svc] || {};
    for (const r of roles) {
      if ((allRoles[r] ?? []).includes("*")) return true;
    }
  }
  return false;
}
